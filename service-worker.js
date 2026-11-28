/* MovieStream BD Background Download Service Worker */
"use strict";

const DB_NAME = "moviestreambd_offline_v1";
const DB_VERSION = 1;
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB balanced chunks: fast resume without saturating page requests
const READ_IDLE_TIMEOUT_MS = 28000;
const MAX_RETRIES = 15;
const MAX_CONCURRENT_DOWNLOADS = 1;
const INTER_CHUNK_YIELD_MS = 160;
const CLIENT_BUSY_YIELD_MS = 450;
const CHANNEL_NAME = "cv-downloads-v1";

const activeJobs = new Map(); // id -> { abortController, promise, startedAt }
const queuedJobs = new Map(); // id -> jobPayload
const liveProgress = new Map(); // id -> { id, status, downloadedBytes, totalBytes, speedBps, updatedAt, mode }
let queueRunning = false;
let dbPromise = null;
let bc = null;
let bootReconcilePromise = null;
let queueIdleResolve = null;
let queueIdlePromise = null;
let clientBusyUntil = 0;

function sleepWithAbort(ms, signal) {
  const wait = Math.max(0, Number(ms) || 0);
  if (!wait) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException("Download aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, wait);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Download aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getQueueDrainPromise() {
  if (activeJobs.size === 0 && queuedJobs.size === 0) {
    return Promise.resolve();
  }
  if (!queueIdlePromise) {
    queueIdlePromise = new Promise(resolve => {
      queueIdleResolve = resolve;
    });
  }
  return queueIdlePromise;
}

function resolveQueueDrainIfIdle() {
  if (activeJobs.size === 0 && queuedJobs.size === 0 && queueIdleResolve) {
    const resFn = queueIdleResolve;
    queueIdleResolve = null;
    queueIdlePromise = null;
    resFn();
  }
}

function ensureBootReconciled() {
  if (!bootReconcilePromise) {
    bootReconcilePromise = reconcileOrphanedRecords().catch(() => {});
  }
  return bootReconcilePromise;
}

try {
  if (typeof BroadcastChannel !== "undefined") {
    bc = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {}

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await ensureBootReconciled();
    })()
  );
});

function broadcastEvent(payload) {
  try {
    bc?.postMessage(payload);
  } catch {}
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(clients => {
      for (const client of clients) {
        try {
          client.postMessage(payload);
        } catch {}
      }
    })
    .catch(() => {});
}

function emitProgressChange(detail) {
  if (detail?.id) {
    if (detail.deleted) {
      liveProgress.delete(detail.id);
    } else if (detail.status === "complete" || detail.status === "paused" || detail.status === "error") {
      liveProgress.set(detail.id, {
        ...detail,
        updatedAt: Date.now()
      });
    } else {
      liveProgress.set(detail.id, {
        ...detail,
        updatedAt: Date.now()
      });
    }
  }
  broadcastEvent({ type: "CV_DL_EVENT", detail });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable in Service Worker"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("videos")) {
        const vs = db.createObjectStore("videos", { keyPath: "id" });
        vs.createIndex("updatedAt", "updatedAt", { unique: false });
        vs.createIndex("path", "path", { unique: false });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const cs = db.createObjectStore("chunks", { keyPath: "key" });
        cs.createIndex("videoId", "videoId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}

function formatBytes(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function getVideoRecord(id) {
  if (!id) return null;
  try {
    const db = await openDb();
    const tx = db.transaction("videos", "readonly");
    return (await reqToPromise(tx.objectStore("videos").get(id))) || null;
  } catch {
    return null;
  }
}

async function listVideoRecords() {
  try {
    const db = await openDb();
    const tx = db.transaction("videos", "readonly");
    const all = await reqToPromise(tx.objectStore("videos").getAll());
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

async function putVideoRecord(rec) {
  const db = await openDb();
  const tx = db.transaction("videos", "readwrite");
  tx.objectStore("videos").put(rec);
  await txDone(tx);
}

async function putChunkAndUpdateRecord(videoId, index, uint8, record) {
  const db = await openDb();
  const tx = db.transaction(["chunks", "videos"], "readwrite");
  tx.objectStore("chunks").put({
    key: `${videoId}::${index}`,
    videoId,
    index,
    size: uint8.byteLength,
    data: uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)
  });
  if (record) {
    tx.objectStore("videos").put(record);
  }
  await txDone(tx);
}

async function deleteDownloadRecord(id) {
  const active = activeJobs.get(id);
  if (active) {
    try { active.abortController.abort(); } catch {}
    activeJobs.delete(id);
  }
  queuedJobs.delete(id);
  liveProgress.delete(id);
  resolveQueueDrainIfIdle();

  try {
    if (self.registration?.backgroundFetch) {
      const bgReg = await self.registration.backgroundFetch.get(id).catch(() => null);
      if (bgReg) await bgReg.abort().catch(() => {});
    }
  } catch {}

  const db = await openDb();
  const tx = db.transaction(["videos", "chunks"], "readwrite");
  tx.objectStore("videos").delete(id);
  const idx = tx.objectStore("chunks").index("videoId");
  const keys = await reqToPromise(idx.getAllKeys(id));
  for (const k of Array.isArray(keys) ? keys : []) {
    tx.objectStore("chunks").delete(k);
  }
  await txDone(tx);
  emitProgressChange({ id, deleted: true });
}

async function loadExistingChunksTail(db, id, existingRecord = null) {
  const tx = db.transaction("chunks", "readonly");
  const idx = tx.objectStore("chunks").index("videoId");
  const count = Number(await reqToPromise(idx.count(id))) || 0;
  if (count === 0) {
    return { count: 0, bytes: 0 };
  }
  if (
    existingRecord &&
    Number(existingRecord.chunkCount) === count &&
    Number(existingRecord.downloadedBytes) > 0
  ) {
    return { count, bytes: Number(existingRecord.downloadedBytes) };
  }

  // Recovery fallback: iterate cursor one chunk at a time so RAM stays < 4 MiB
  let totalSavedBytes = 0;
  let maxIndex = -1;
  await new Promise((resolve, reject) => {
    const req = idx.openCursor(id);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      const val = cursor.value;
      totalSavedBytes += Number(val?.size || val?.data?.byteLength || 0);
      if (Number.isFinite(Number(val?.index)) && Number(val.index) > maxIndex) {
        maxIndex = Number(val.index);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error || new Error("Chunk cursor failed"));
  });
  return { count: Math.max(count, maxIndex + 1), bytes: totalSavedBytes };
}

async function reconcileOrphanedRecords() {
  try {
    const items = await listVideoRecords();
    const bgIds = new Set();
    try {
      if (self.registration?.backgroundFetch?.getIds) {
        const ids = await self.registration.backgroundFetch.getIds();
        for (const bid of Array.isArray(ids) ? ids : []) bgIds.add(bid);
      }
    } catch {}

    for (const item of items) {
      if (!item?.id) continue;
      if ((item.status === "downloading" || item.status === "queued") && !activeJobs.has(item.id) && !queuedJobs.has(item.id) && !bgIds.has(item.id)) {
        item.status = "paused";
        item.updatedAt = Date.now();
        await putVideoRecord(item).catch(() => {});
      }
    }
  } catch {}
}

function resolveWorkerUrl(targetUrl) {
  const raw = String(targetUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, self.location.origin).href;
  } catch {
    return raw;
  }
}

function fetchInitForUrl(targetUrl, extra = {}) {
  const resolved = resolveWorkerUrl(targetUrl);
  const isSameOrigin = resolved.startsWith(self.location.origin);
  return {
    resolvedUrl: resolved,
    init: {
      priority: extra.priority ?? "low",
      ...extra,
      credentials: isSameOrigin ? "same-origin" : "omit",
      referrerPolicy: "no-referrer"
    }
  };
}

function parseTotalFromContentRange(headerVal) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(headerVal || "").trim());
  if (!m) return null;
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === "*" ? 0 : Number(m[3])
  };
}

async function readWithIdleTimeout(reader, timeoutMs, signal) {
  if (signal?.aborted) throw new DOMException("Download aborted", "AbortError");
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new DOMException("Stream stalled", "TimeoutError"));
        }, timeoutMs);
      }),
      ...(signal
        ? [
            new Promise((_, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("Download aborted", "AbortError")),
                { once: true }
              );
            })
          ]
        : [])
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeTotalLength(url, signal) {
  try {
    const { resolvedUrl, init } = fetchInitForUrl(url, { method: "HEAD", cache: "no-store", signal });
    const headRes = await fetch(resolvedUrl, init);
    const cl = Number(headRes.headers.get("content-length") || 0);
    if (headRes.ok && cl > 0) return cl;
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }
  try {
    const { resolvedUrl, init } = fetchInitForUrl(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      signal
    });
    const rangeRes = await fetch(resolvedUrl, init);
    const cr = parseTotalFromContentRange(rangeRes.headers.get("content-range"));
    try { await rangeRes.body?.cancel(); } catch {}
    if (cr?.total > 0) return cr.total;
    const cl = Number(rangeRes.headers.get("content-length") || 0);
    if (rangeRes.ok && cl > 1) return cl;
  } catch (err) {
    if (err?.name === "AbortError") throw err;
  }
  return 0;
}

function linkAbortSignals(outerSignal, innerCtrl) {
  if (!outerSignal) return () => {};
  if (outerSignal.aborted) {
    try { innerCtrl.abort(outerSignal.reason || new DOMException("Download aborted", "AbortError")); } catch {}
    return () => {};
  }
  const onAbort = () => {
    try { innerCtrl.abort(outerSignal.reason || new DOMException("Download aborted", "AbortError")); } catch {}
  };
  outerSignal.addEventListener("abort", onAbort, { once: true });
  return () => outerSignal.removeEventListener("abort", onAbort);
}

async function resumableRangeDownload({
  url,
  fallbackUrl = "",
  startOffset = 0,
  knownTotal = 0,
  signal,
  onBytes,
  onProgress,
  onUrlSwitch = null,
  onRefreshSource = null
}) {
  let activeUrl = url;
  let activeFallback = fallbackUrl;
  let switchedToFallback = false;
  let refreshedSourceOnce = false;
  let offset = Math.max(0, Number(startOffset) || 0);
  let totalBytes = Math.max(0, Number(knownTotal) || 0);
  if (!totalBytes) {
    totalBytes = await probeTotalLength(activeUrl, signal);
    if (!totalBytes && activeFallback && activeFallback !== activeUrl) {
      const fbTotal = await probeTotalLength(activeFallback, signal);
      if (fbTotal > 0) totalBytes = fbTotal;
    }
  }

  const startedAt = Date.now();
  const initialOffset = offset;
  let consecutiveErrors = 0;

  while (totalBytes === 0 || offset < totalBytes) {
    if (signal?.aborted) throw new DOMException("Download aborted", "AbortError");
    if (offset > initialOffset) {
      const pauseMs = Date.now() < clientBusyUntil ? CLIENT_BUSY_YIELD_MS : INTER_CHUNK_YIELD_MS;
      await sleepWithAbort(pauseMs, signal);
    }
    const reqEnd = totalBytes > 0 ? Math.min(totalBytes - 1, offset + CHUNK_SIZE - 1) : offset + CHUNK_SIZE - 1;
    const connectCtrl = new AbortController();
    const unlinkSignal = linkAbortSignals(signal, connectCtrl);
    const connectTimer = setTimeout(() => {
      connectCtrl.abort(new DOMException("Connection timed out", "TimeoutError"));
    }, 30000);
    const reqSignal = connectCtrl.signal;

    let res = null;
    let reader = null;
    let progressInAttempt = 0;
    let serverIgnoredRange = false;

    try {
      const { resolvedUrl, init } = fetchInitForUrl(activeUrl, {
        headers: { Range: `bytes=${offset}-${reqEnd}` },
        cache: "no-store",
        signal: reqSignal
      });
      res = await fetch(resolvedUrl, init);
      clearTimeout(connectTimer);
      unlinkSignal();

      if (res.status === 416) {
        const cr = parseTotalFromContentRange(res.headers.get("content-range"));
        try { await res.body?.cancel(); } catch {}
        if (cr?.total > 0 && offset >= cr.total) {
          totalBytes = cr.total;
          break;
        }
        throw Object.assign(new Error("HTTP 416 Range not satisfiable"), { httpStatus: 416 });
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after") || 0);
        try { await res.body?.cancel(); } catch {}
        throw Object.assign(new Error(`Server busy (HTTP ${res.status})`), { retryAfterMs: retryAfter * 1000, httpStatus: res.status });
      }

      if (!res.ok && res.status !== 206) {
        try { await res.body?.cancel(); } catch {}
        throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("json") || ct.includes("text/html")) {
        try { await res.body?.cancel(); } catch {}
        throw new Error("Server returned an error page instead of video");
      }

      const cr = parseTotalFromContentRange(res.headers.get("content-range"));
      if (cr?.total > 0 && (totalBytes === 0 || cr.total > totalBytes)) {
        totalBytes = cr.total;
      } else if (res.status === 200) {
        serverIgnoredRange = true;
        const cl = Number(res.headers.get("content-length") || 0);
        if (cl > 0 && totalBytes === 0) totalBytes = cl;
      }

      let skipBytes = 0;
      if (res.status === 200 && offset > 0) {
        skipBytes = offset;
      } else if (res.status === 206 && cr && cr.start < offset) {
        skipBytes = offset - cr.start;
      }

      if (!res.body) {
        const ab = await res.arrayBuffer();
        let view = new Uint8Array(ab);
        if (skipBytes > 0) {
          view = skipBytes < view.byteLength ? view.subarray(skipBytes) : new Uint8Array(0);
        }
        if (view.byteLength > 0) {
          await onBytes(view, totalBytes);
          offset += view.byteLength;
          progressInAttempt += view.byteLength;
        }
      } else {
        reader = res.body.getReader();
        while (true) {
          const { done, value } = await readWithIdleTimeout(reader, READ_IDLE_TIMEOUT_MS, signal);
          if (done) break;
          if (!value || !value.byteLength) continue;
          let chunk = value;
          if (skipBytes > 0) {
            if (skipBytes >= chunk.byteLength) {
              skipBytes -= chunk.byteLength;
              continue;
            }
            chunk = chunk.subarray(skipBytes);
            skipBytes = 0;
          }
          if (totalBytes > 0 && offset + chunk.byteLength > totalBytes) {
            chunk = chunk.subarray(0, totalBytes - offset);
          }
          if (chunk.byteLength > 0) {
            await onBytes(chunk, totalBytes);
            offset += chunk.byteLength;
            progressInAttempt += chunk.byteLength;
            consecutiveErrors = 0;
            const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
            const speedBps = (offset - initialOffset) / elapsedSec;
            onProgress?.(offset, totalBytes, speedBps);
          }
          if (totalBytes > 0 && offset >= totalBytes) break;
        }
      }

      if (progressInAttempt > 0) {
        const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
        const speedBps = (offset - initialOffset) / elapsedSec;
        onProgress?.(offset, totalBytes, speedBps);
      }

      if (serverIgnoredRange && totalBytes === 0 && progressInAttempt > 0) {
        totalBytes = offset;
        break;
      }
      if (progressInAttempt === 0 && totalBytes === 0) break;
      if (totalBytes > 0 && offset >= totalBytes) break;
    } catch (err) {
      clearTimeout(connectTimer);
      unlinkSignal();
      try { await reader?.cancel(); } catch {}
      if (signal?.aborted || err?.name === "AbortError") {
        throw new DOMException("Download aborted", "AbortError");
      }
      if (err?.name === "QuotaExceededError") {
        throw new Error("Device browser storage full — delete old offline videos or use Direct Browser Save.");
      }
      consecutiveErrors++;
      const st = Number(err?.httpStatus || 0);
      const immediateSwitch = err instanceof TypeError || st === 400 || st === 401 || st === 403 || st === 404 || st === 416;
      if (activeFallback && !switchedToFallback && activeFallback !== activeUrl && (immediateSwitch || consecutiveErrors >= 2)) {
        activeUrl = activeFallback;
        switchedToFallback = true;
        consecutiveErrors = 0;
        onUrlSwitch?.(activeUrl);
        continue;
      }
      if ((st === 400 || st === 401 || st === 403 || st === 410 || err instanceof TypeError) && !refreshedSourceOnce && typeof onRefreshSource === "function") {
        refreshedSourceOnce = true;
        try {
          const fresh = await onRefreshSource();
          if (fresh?.url) {
            activeUrl = fresh.url;
            activeFallback = fresh.fallbackUrl || "";
            switchedToFallback = false;
            consecutiveErrors = 0;
            onUrlSwitch?.(activeUrl);
            continue;
          }
        } catch {}
      }
      if (consecutiveErrors > MAX_RETRIES) throw err;
      const waitMs = Math.min(12000, Math.max(Number(err?.retryAfterMs) || 0, 750 * consecutiveErrors));
      await new Promise(r => setTimeout(r, waitMs));
    } finally {
      clearTimeout(connectTimer);
      unlinkSignal();
      try { reader?.releaseLock(); } catch {}
    }
  }

  if (totalBytes > 0 && offset < totalBytes) {
    throw new Error(`Incomplete download (${formatBytes(offset)} / ${formatBytes(totalBytes)})`);
  }

  return { downloadedBytes: offset, totalBytes: totalBytes || offset };
}

async function fetchPosterDataUrlInSw(posterUrl, posterFallbackUrl = "") {
  const candidates = [posterUrl, posterFallbackUrl].filter((u, i, a) => u && a.indexOf(u) === i);
  for (const candidate of candidates) {
    try {
      const { resolvedUrl, init } = fetchInitForUrl(candidate, {
        cache: "force-cache",
        signal: AbortSignal.timeout(8000)
      });
      const res = await fetch(resolvedUrl, init);
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      if (!mime.startsWith("image/")) continue;
      const ab = await res.arrayBuffer();
      if (!ab || ab.byteLength > 512 * 1024) continue;
      const bytes = new Uint8Array(ab);
      let bin = "";
      const step = 8192;
      for (let i = 0; i < bytes.length; i += step) {
        bin += String.fromCharCode(...bytes.subarray(i, i + step));
      }
      return `data:${mime};base64,${btoa(bin)}`;
    } catch {}
  }
  return "";
}

async function fetchOfflineSubtitlesInSw(subtitles = []) {
  const out = [];
  const list = (Array.isArray(subtitles) ? subtitles : []).slice(0, 6);
  await Promise.allSettled(
    list.map(async s => {
      if (!s?.url) return;
      try {
        const { resolvedUrl, init } = fetchInitForUrl(s.url, {
          cache: "force-cache",
          signal: AbortSignal.timeout(8000)
        });
        const r = await fetch(resolvedUrl, init);
        if (!r.ok) return;
        const vttText = await r.text();
        if (vttText) {
          out.push({
            label: s.label || s.language || "Subtitle",
            language: s.language || "und",
            vttText
          });
        }
      } catch {}
    })
  );
  return out;
}

function buildExportUrl(record) {
  const cleanTitle = String(record?.title || "MovieStreamBD").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "MovieStreamBD";
  const ep = record?.episodeLabel ? ` - ${String(record.episodeLabel).replace(/[\\/:*?"<>|]+/g, " ").trim()}` : "";
  const fname = record?.exportFilename || `${cleanTitle}${ep} - ${record?.quality || "HD"}.mp4`;
  return `/sw-download-export/${encodeURIComponent(record.id)}?filename=${encodeURIComponent(fname)}`;
}

async function refreshExpiredSourceInSw(record) {
  if (!record?.path) return null;
  try {
    const qs = new URLSearchParams({
      path: String(record.path),
      title: String(record.title || ""),
      se: String(record.se || 0),
      ep: String(record.ep || 1)
    });
    const r = await fetch(`/api/movie-api/stream?${qs.toString()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const list = Array.isArray(data?.sources) ? data.sources : [];
    const mp4s = list.filter(s => s?.url && !/\.m3u8(?:$|[?#])/i.test(s.url) && !/\/api\/mlbd-hls\.m3u8/i.test(s.url));
    if (!mp4s.length) return null;
    const match = mp4s.find(s => record.quality && s.quality === record.quality) || mp4s[0];
    const decorate = raw => {
      const u = new URL(raw, self.location.origin);
      if (u.origin === self.location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4")) {
        u.searchParams.set("download", "1");
        return u.pathname + u.search;
      }
      return u.href;
    };
    const nextUrl = decorate(match.url);
    const nextFb = match.proxyUrl && match.proxyUrl !== match.url ? decorate(match.proxyUrl) : "";
    return { url: nextUrl, fallbackUrl: nextFb };
  } catch {
    return null;
  }
}

async function showCompletionNotification(record) {
  const titleLabel = record?.episodeLabel ? `${record.title} (${record.episodeLabel})` : record?.title || "MovieStream BD";
  const sizeText = formatBytes(record?.downloadedBytes || record?.totalBytes || 0);
  const body = record?.saveToDevice
    ? `Saved to Device (${record?.quality || "HD"}${sizeText ? ` · ${sizeText}` : ""}). Ready in Downloads & Offline Library.`
    : `Download complete (${record?.quality || "HD"}${sizeText ? ` · ${sizeText}` : ""}). Tap to watch offline.`;

  broadcastEvent({
    type: "CV_DL_COMPLETE_NOTICE",
    detail: {
      id: record.id,
      title: record.title,
      episodeLabel: record.episodeLabel || "",
      quality: record.quality || "HD",
      totalBytes: record.downloadedBytes || record.totalBytes || 0,
      posterDataUrl: record.posterDataUrl || "",
      posterFallbackUrl: record.posterFallbackUrl || "",
      saveToDevice: Boolean(record.saveToDevice),
      exportFilename: record.exportFilename || "",
      exportUrl: buildExportUrl(record)
    }
  });

  try {
    if (typeof self.Notification !== "undefined" && self.Notification.permission === "granted" && self.registration?.showNotification) {
      await self.registration.showNotification(record?.saveToDevice ? `Download Complete: ${titleLabel}` : `Ready Offline: ${titleLabel}`, {
        body,
        icon: "/favicon.svg",
        badge: "/favicon.svg",
        tag: `cv-dl-${record.id}`,
        data: {
          id: record.id,
          url: `/watch.html?offline=${encodeURIComponent(record.id)}`
        }
      });
    }
  } catch {}
}

async function runSingleSwDownload(opts) {
  const id = opts.id;
  const abortController = new AbortController();
  const startedAt = Date.now();

  const promise = (async () => {
    const db = await openDb();
    const existing = await getVideoRecord(id);
    const { count: existingCount, bytes: existingBytes } = await loadExistingChunksTail(db, id, existing);

    if (existing && existing.status === "complete" && existing.totalBytes > 0 && existingBytes >= existing.totalBytes) {
      if (opts.saveToDevice && !existing.pendingDeviceExport) {
        existing.saveToDevice = true;
        existing.pendingDeviceExport = true;
        if (opts.exportFilename) existing.exportFilename = String(opts.exportFilename);
        await putVideoRecord(existing).catch(() => {});
        await showCompletionNotification(existing);
      }
      emitProgressChange({ id, status: "complete", downloadedBytes: existingBytes, totalBytes: existing.totalBytes, speedBps: 0, saveToDevice: Boolean(existing.saveToDevice) });
      return existing;
    }

    const now = Date.now();
    const record = {
      id,
      path: String(opts.path || existing?.path || ""),
      title: String(opts.title || existing?.title || "MovieStream BD Video"),
      episodeLabel: String(opts.episodeLabel || existing?.episodeLabel || ""),
      se: Number(opts.se ?? existing?.se ?? 0) || 0,
      ep: Number(opts.ep ?? existing?.ep ?? 1) || 1,
      quality: String(opts.quality || existing?.quality || "HD"),
      sourceUrl: String(opts.url || existing?.sourceUrl || ""),
      fallbackUrl: String(opts.fallbackUrl || existing?.fallbackUrl || ""),
      mimeType: "video/mp4",
      totalBytes: Number(existing?.totalBytes || opts.totalBytes || 0),
      downloadedBytes: existingBytes,
      chunkCount: existingCount,
      chunkSize: CHUNK_SIZE,
      posterDataUrl: existing?.posterDataUrl || opts.posterDataUrl || "",
      posterFallbackUrl: String(opts.posterFallbackUrl || existing?.posterFallbackUrl || ""),
      subtitles: Array.isArray(existing?.subtitles) ? existing.subtitles : [],
      saveToDevice: Boolean(opts.saveToDevice ?? existing?.saveToDevice),
      exportFilename: String(opts.exportFilename || existing?.exportFilename || ""),
      pendingDeviceExport: false,
      status: "downloading",
      error: "",
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await putVideoRecord(record);
    emitProgressChange({ id, status: "downloading", downloadedBytes: existingBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "sw", saveToDevice: record.saveToDevice });

    // Non-blocking poster & subtitle fetch
    Promise.all([
      !record.posterDataUrl && (opts.posterUrl || record.posterFallbackUrl)
        ? fetchPosterDataUrlInSw(opts.posterUrl || record.posterFallbackUrl, record.posterFallbackUrl)
        : Promise.resolve(""),
      (!record.subtitles || !record.subtitles.length) && Array.isArray(opts.subtitles)
        ? fetchOfflineSubtitlesInSw(opts.subtitles)
        : Promise.resolve([])
    ]).then(async ([pData, subData]) => {
      let changed = false;
      if (pData) {
        record.posterDataUrl = pData;
        changed = true;
      }
      if (subData.length) {
        record.subtitles = subData;
        changed = true;
      }
      if (changed) {
        record.updatedAt = Date.now();
        await putVideoRecord(record).catch(() => {});
        emitProgressChange({ id, status: record.status, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes });
      }
    });

    let nextChunkIndex = existingCount;
    let pendingParts = [];
    let pendingBytes = 0;
    let flushedTotal = 0;
    let lastUiTick = 0;

    const flushPending = async () => {
      if (!pendingBytes) return;
      const merged = new Uint8Array(pendingBytes);
      let pos = 0;
      for (const p of pendingParts) {
        merged.set(p, pos);
        pos += p.byteLength;
      }
      pendingParts = [];
      pendingBytes = 0;
      const idxToWrite = nextChunkIndex;
      nextChunkIndex++;
      record.chunkCount = nextChunkIndex;
      record.downloadedBytes = existingBytes + flushedTotal;
      record.updatedAt = Date.now();
      await putChunkAndUpdateRecord(id, idxToWrite, merged, record);
    };

    try {
      const res = await resumableRangeDownload({
        url: record.sourceUrl,
        fallbackUrl: record.fallbackUrl,
        startOffset: existingBytes,
        knownTotal: record.totalBytes,
        signal: abortController.signal,
        onUrlSwitch: nextUrl => {
          record.sourceUrl = nextUrl;
        },
        onRefreshSource: () => refreshExpiredSourceInSw(record),
        onBytes: async (chunk, detectedTotal) => {
          if (detectedTotal > 0 && detectedTotal !== record.totalBytes) {
            record.totalBytes = detectedTotal;
          }
          pendingParts.push(chunk.slice());
          pendingBytes += chunk.byteLength;
          flushedTotal += chunk.byteLength;
          if (pendingBytes >= CHUNK_SIZE) {
            await flushPending();
          }
        },
        onProgress: (done, total, speedBps) => {
          if (total > 0) record.totalBytes = total;
          record.downloadedBytes = done;
          const nowMs = Date.now();
          if (nowMs - lastUiTick >= 800) {
            lastUiTick = nowMs;
            emitProgressChange({ id, status: "downloading", downloadedBytes: done, totalBytes: total, speedBps, mode: "sw", saveToDevice: record.saveToDevice });
          }
        }
      });

      await flushPending();
      record.totalBytes = res.totalBytes || res.downloadedBytes;
      record.downloadedBytes = res.downloadedBytes;
      record.status = "complete";
      record.pendingDeviceExport = Boolean(record.saveToDevice);
      record.error = "";
      record.updatedAt = Date.now();
      await putVideoRecord(record);
      emitProgressChange({
        id,
        status: "complete",
        downloadedBytes: record.downloadedBytes,
        totalBytes: record.totalBytes,
        speedBps: 0,
        mode: "sw",
        saveToDevice: record.saveToDevice,
        pendingDeviceExport: record.pendingDeviceExport
      });
      await showCompletionNotification(record);
      return record;
    } catch (err) {
      try { await flushPending(); } catch {}
      if (err?.name === "AbortError") {
        record.status = "paused";
        record.error = "";
        record.updatedAt = Date.now();
        await putVideoRecord(record).catch(() => {});
        emitProgressChange({ id, status: "paused", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "sw", saveToDevice: record.saveToDevice });
        return record;
      }
      record.status = "error";
      record.error = err?.message || "Download interrupted";
      record.updatedAt = Date.now();
      await putVideoRecord(record).catch(() => {});
      emitProgressChange({
        id,
        status: "error",
        downloadedBytes: record.downloadedBytes,
        totalBytes: record.totalBytes,
        speedBps: 0,
        error: record.error,
        mode: "sw",
        saveToDevice: record.saveToDevice
      });
      return record;
    } finally {
      activeJobs.delete(id);
      processQueue();
      resolveQueueDrainIfIdle();
    }
  })();

  activeJobs.set(id, { abortController, promise, startedAt });
  return promise;
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (activeJobs.size < MAX_CONCURRENT_DOWNLOADS && queuedJobs.size > 0) {
      const nextEntry = queuedJobs.entries().next().value;
      if (!nextEntry) break;
      const [id, jobOpts] = nextEntry;
      queuedJobs.delete(id);
      runSingleSwDownload(jobOpts).catch(() => {});
    }
  } finally {
    queueRunning = false;
    resolveQueueDrainIfIdle();
  }
}

async function enqueueSwDownload(opts) {
  const id = opts?.id;
  if (!id || !opts?.url) return;
  if (activeJobs.has(id) || queuedJobs.has(id)) return;

  const existing = await getVideoRecord(id);
  const db = await openDb();
  const { count: existingCount, bytes: existingBytes } = await loadExistingChunksTail(db, id, existing);
  if (existing && existing.status === "complete" && existing.totalBytes > 0 && existingBytes >= existing.totalBytes) {
    if (opts.saveToDevice) {
      existing.saveToDevice = true;
      existing.pendingDeviceExport = true;
      if (opts.exportFilename) existing.exportFilename = String(opts.exportFilename);
      await putVideoRecord(existing).catch(() => {});
      await showCompletionNotification(existing);
    }
    emitProgressChange({ id, status: "complete", downloadedBytes: existingBytes, totalBytes: existing.totalBytes, speedBps: 0, saveToDevice: Boolean(existing.saveToDevice) });
    return;
  }

  const now = Date.now();
  const record = {
    id,
    path: String(opts.path || existing?.path || ""),
    title: String(opts.title || existing?.title || "MovieStream BD Video"),
    episodeLabel: String(opts.episodeLabel || existing?.episodeLabel || ""),
    se: Number(opts.se ?? existing?.se ?? 0) || 0,
    ep: Number(opts.ep ?? existing?.ep ?? 1) || 1,
    quality: String(opts.quality || existing?.quality || "HD"),
    sourceUrl: String(opts.url || existing?.sourceUrl || ""),
    fallbackUrl: String(opts.fallbackUrl || existing?.fallbackUrl || ""),
    mimeType: "video/mp4",
    totalBytes: Number(existing?.totalBytes || opts.totalBytes || 0),
    downloadedBytes: existingBytes,
    chunkCount: existingCount,
    chunkSize: CHUNK_SIZE,
    posterDataUrl: existing?.posterDataUrl || opts.posterDataUrl || "",
    posterFallbackUrl: String(opts.posterFallbackUrl || existing?.posterFallbackUrl || ""),
    subtitles: Array.isArray(existing?.subtitles) ? existing.subtitles : [],
    saveToDevice: Boolean(opts.saveToDevice ?? existing?.saveToDevice),
    exportFilename: String(opts.exportFilename || existing?.exportFilename || ""),
    pendingDeviceExport: false,
    status: activeJobs.size >= MAX_CONCURRENT_DOWNLOADS ? "queued" : "downloading",
    error: "",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await putVideoRecord(record);

  queuedJobs.set(id, opts);
  if (record.status === "queued") {
    emitProgressChange({ id, status: "queued", downloadedBytes: existingBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "sw", saveToDevice: record.saveToDevice });
  }
  await processQueue();
}

async function pauseSwDownload(id) {
  if (!id) return;
  if (queuedJobs.has(id)) {
    queuedJobs.delete(id);
    const rec = await getVideoRecord(id);
    if (rec) {
      rec.status = "paused";
      rec.error = "";
      rec.updatedAt = Date.now();
      await putVideoRecord(rec).catch(() => {});
      emitProgressChange({ id, status: "paused", downloadedBytes: rec.downloadedBytes || 0, totalBytes: rec.totalBytes || 0, speedBps: 0, mode: "sw", saveToDevice: Boolean(rec.saveToDevice) });
    }
    resolveQueueDrainIfIdle();
    return;
  }
  const active = activeJobs.get(id);
  if (active) {
    active.abortController.abort();
  }
  try {
    if (self.registration?.backgroundFetch) {
      const bgReg = await self.registration.backgroundFetch.get(id).catch(() => null);
      if (bgReg) await bgReg.abort().catch(() => {});
    }
  } catch {}
}

async function pauseAllSwDownloads() {
  for (const id of [...queuedJobs.keys()]) {
    await pauseSwDownload(id);
  }
  for (const [id, active] of activeJobs.entries()) {
    try { active.abortController.abort(); } catch {}
    activeJobs.delete(id);
  }
  resolveQueueDrainIfIdle();
}

async function resumeAllSwDownloads() {
  const items = await listVideoRecords();
  for (const rec of items) {
    if ((rec.status === "paused" || rec.status === "error") && rec.sourceUrl) {
      await enqueueSwDownload({ ...rec, url: rec.sourceUrl });
    }
  }
}

// Native Background Fetch API Handlers (when supported by browser)
self.addEventListener("backgroundfetchsuccess", event => {
  const bgReg = event.registration;
  const id = bgReg.id;
  event.waitUntil(
    (async () => {
      try {
        const records = await bgReg.matchAll();
        const first = records?.[0];
        if (!first) throw new Error("Empty background fetch payload");
        const response = await first.responseReady;
        if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 502}`);

        const db = await openDb();
        // Replace partial chunks cleanly with full verified BackgroundFetch stream in 4 MiB chunks
        const clearTx = db.transaction("chunks", "readwrite");
        const idx = clearTx.objectStore("chunks").index("videoId");
        const oldKeys = await reqToPromise(idx.getAllKeys(id));
        for (const k of Array.isArray(oldKeys) ? oldKeys : []) {
          clearTx.objectStore("chunks").delete(k);
        }
        await txDone(clearTx);

        let chunkIdx = 0;
        let totalWritten = 0;
        let pendingParts = [];
        let pendingBytes = 0;

        const flushBuf = async () => {
          if (!pendingBytes) return;
          const merged = new Uint8Array(pendingBytes);
          let pos = 0;
          for (const p of pendingParts) {
            merged.set(p, pos);
            pos += p.byteLength;
          }
          pendingParts = [];
          pendingBytes = 0;
          await putChunkRecord(id, chunkIdx, merged);
          chunkIdx++;
        };

        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || !value.byteLength) continue;
            pendingParts.push(value);
            pendingBytes += value.byteLength;
            totalWritten += value.byteLength;
            if (pendingBytes >= CHUNK_SIZE) await flushBuf();
          }
          await flushBuf();
        } else {
          const ab = await response.arrayBuffer();
          const bytes = new Uint8Array(ab);
          for (let off = 0; off < bytes.byteLength; off += CHUNK_SIZE) {
            await putChunkRecord(id, chunkIdx++, bytes.subarray(off, Math.min(bytes.byteLength, off + CHUNK_SIZE)));
          }
          totalWritten = bytes.byteLength;
        }

        const existing = await getVideoRecord(id);
        const updated = {
          ...(existing || { id, title: "MovieStream BD Video", quality: "HD", se: 0, ep: 1 }),
          totalBytes: totalWritten,
          downloadedBytes: totalWritten,
          chunkCount: chunkIdx,
          chunkSize: CHUNK_SIZE,
          status: "complete",
          error: "",
          updatedAt: Date.now()
        };
        await putVideoRecord(updated);
        emitProgressChange({ id, status: "complete", downloadedBytes: totalWritten, totalBytes: totalWritten, speedBps: 0, mode: "bgfetch" });
        await event.updateUI({ title: `Saved Offline: ${updated.title}` }).catch(() => {});
        await showCompletionNotification(updated);
      } catch (err) {
        const existing = await getVideoRecord(id);
        if (existing) {
          existing.status = "error";
          existing.error = err?.message || "Background fetch store failed";
          existing.updatedAt = Date.now();
          await putVideoRecord(existing).catch(() => {});
        }
        emitProgressChange({ id, status: "error", error: err?.message || "Background fetch failed", mode: "bgfetch" });
      }
    })()
  );
});

self.addEventListener("backgroundfetchfail", event => {
  const id = event.registration.id;
  event.waitUntil(
    (async () => {
      const existing = await getVideoRecord(id);
      if (existing) {
        existing.status = "error";
        existing.error = "Background download failed — tap Resume to continue";
        existing.updatedAt = Date.now();
        await putVideoRecord(existing).catch(() => {});
      }
      emitProgressChange({ id, status: "error", error: "Background download interrupted", mode: "bgfetch" });
      await event.updateUI({ title: "Download interrupted — tap to resume" }).catch(() => {});
    })()
  );
});

self.addEventListener("backgroundfetchabort", event => {
  const id = event.registration.id;
  event.waitUntil(
    (async () => {
      const existing = await getVideoRecord(id);
      if (existing && existing.status !== "complete") {
        existing.status = "paused";
        existing.updatedAt = Date.now();
        await putVideoRecord(existing).catch(() => {});
      }
      emitProgressChange({ id, status: "paused", mode: "bgfetch" });
    })()
  );
});

self.addEventListener("backgroundfetchclick", event => {
  event.waitUntil(
    self.clients.openWindow("/saved.html?tab=offline").catch(() => {})
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/saved.html?tab=offline";
  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windowClients) {
        if ("focus" in client) {
          await client.focus().catch(() => {});
          if ("navigate" in client) {
            return client.navigate(targetUrl).catch(() => {});
          }
          return client;
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});

// Zero-RAM streaming export from 4 MiB IndexedDB chunks straight to Device Downloads folder
async function buildSwExportResponse(requestUrl) {
  const rawId = requestUrl.pathname.slice("/sw-download-export/".length);
  let id = "";
  try { id = decodeURIComponent(rawId); } catch { id = rawId; }
  if (!id) return new Response("Invalid download ID", { status: 400 });

  const db = await openDb();
  const meta = await getVideoRecord(id);
  if (!meta) return new Response("Offline video not found", { status: 404 });

  const keysTx = db.transaction("chunks", "readonly");
  const idx = keysTx.objectStore("chunks").index("videoId");
  const rawKeys = await reqToPromise(idx.getAllKeys(id));
  const sortedKeys = (Array.isArray(rawKeys) ? rawKeys : []).sort((a, b) => {
    const na = Number(String(a).split("::").pop()) || 0;
    const nb = Number(String(b).split("::").pop()) || 0;
    return na - nb;
  });
  if (!sortedKeys.length) return new Response("No video data saved", { status: 404 });

  const qFilename = requestUrl.searchParams.get("filename") || meta.exportFilename || "";
  const cleanTitle = String(qFilename || `${meta.title || "MovieStreamBD"}${meta.episodeLabel ? ` - ${meta.episodeLabel}` : ""} - ${meta.quality || "HD"}.mp4`)
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "MovieStreamBD-Video.mp4";
  const finalName = cleanTitle.toLowerCase().endsWith(".mp4") ? cleanTitle : `${cleanTitle}.mp4`;
  const asciiFallback = finalName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const totalBytes = Number(meta.downloadedBytes || meta.totalBytes || 0);

  let cursorPos = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (cursorPos >= sortedKeys.length) {
        controller.close();
        return;
      }
      const key = sortedKeys[cursorPos++];
      try {
        const tx = db.transaction("chunks", "readonly");
        const rec = await reqToPromise(tx.objectStore("chunks").get(key));
        if (rec?.data) {
          controller.enqueue(new Uint8Array(rec.data));
        }
      } catch (err) {
        controller.error(err);
      }
    }
  });

  const headers = {
    "Content-Type": meta.mimeType || "video/mp4",
    "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(finalName)}`,
    "Cache-Control": "no-store"
  };
  if (totalBytes > 0) headers["Content-Length"] = String(totalBytes);
  return new Response(stream, { status: 200, headers });
}

self.addEventListener("fetch", event => {
  try {
    const reqUrl = new URL(event.request.url);
    if (reqUrl.origin === self.location.origin && reqUrl.pathname.startsWith("/sw-download-export/")) {
      event.respondWith(
        buildSwExportResponse(reqUrl).catch(err => new Response(err?.message || "Export failed", { status: 500 }))
      );
    }
  } catch {}
});

self.addEventListener("message", event => {
  const msg = event.data || {};
  const port = event.ports?.[0] || null;
  const reply = data => {
    try { port?.postMessage(data); } catch {}
  };

  if (msg.type === "SW_DL_START") {
    event.waitUntil(
      (async () => {
        try {
          await enqueueSwDownload(msg.job);
          reply({ ok: true });
        } catch (err) {
          reply({ ok: false, error: err?.message || "Failed to enqueue" });
          return;
        }
        await getQueueDrainPromise();
      })()
    );
  } else if (msg.type === "SW_DL_PAUSE") {
    event.waitUntil(pauseSwDownload(msg.id).then(() => reply({ ok: true })));
  } else if (msg.type === "SW_DL_RESUME") {
    event.waitUntil(
      (async () => {
        const existing = await getVideoRecord(msg.id);
        if (!existing || !existing.sourceUrl) {
          reply({ ok: false, error: "Download record cannot be resumed" });
          return;
        }
        await enqueueSwDownload({ ...existing, url: existing.sourceUrl });
        reply({ ok: true });
        await getQueueDrainPromise();
      })()
    );
  } else if (msg.type === "SW_DL_PAUSE_ALL") {
    event.waitUntil(pauseAllSwDownloads().then(() => reply({ ok: true })));
  } else if (msg.type === "SW_DL_RESUME_ALL") {
    event.waitUntil(
      (async () => {
        await resumeAllSwDownloads();
        reply({ ok: true });
        await getQueueDrainPromise();
      })()
    );
  } else if (msg.type === "SW_DL_CLEAR_EXPORT_FLAG") {
    event.waitUntil(
      (async () => {
        const existing = await getVideoRecord(msg.id);
        if (existing && existing.pendingDeviceExport) {
          existing.pendingDeviceExport = false;
          existing.updatedAt = Date.now();
          await putVideoRecord(existing).catch(() => {});
        }
        reply({ ok: true });
      })()
    );
  } else if (msg.type === "SW_DL_DELETE") {
    event.waitUntil(deleteDownloadRecord(msg.id).then(() => reply({ ok: true })));
  } else if (msg.type === "SW_DL_CLIENT_YIELD") {
    const until = Number(msg.until) || Date.now() + 1800;
    if (until > clientBusyUntil) clientBusyUntil = until;
    reply({ ok: true });
  } else if (msg.type === "SW_DL_GET_SNAPSHOT") {
    event.waitUntil(
      (async () => {
        await ensureBootReconciled();
        const snapshot = {
          ok: true,
          activeIds: [...activeJobs.keys()],
          queuedIds: [...queuedJobs.keys()],
          progress: Object.fromEntries(liveProgress.entries())
        };
        reply(snapshot);
        event.source?.postMessage?.({ type: "CV_DL_SNAPSHOT", snapshot });
      })()
    );
  }
});
