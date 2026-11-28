(() => {
  "use strict";

  const DB_NAME = "moviestreambd_offline_v1";
  const DB_VERSION = 1;
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB balanced chunks: fast resume without starving browsing
  const READ_IDLE_TIMEOUT_MS = 28000;
  const MAX_RETRIES = 15;
  const MAX_CONCURRENT_LOCAL = 1;
  const INTER_CHUNK_YIELD_MS = 160;
  const CLIENT_BUSY_YIELD_MS = 450;
  const CHANNEL_NAME = "cv-downloads-v1";

  const activeJobs = new Map(); // id -> { abortController, promise }
  const localQueuedJobs = new Map(); // id -> { opts, onProgress, resolve, reject }
  const progressListeners = new Map(); // id -> Set<fn>
  const liveProgressMap = new Map(); // id -> { id, status, downloadedBytes, totalBytes, speedBps, updatedAt, mode }
  const swActiveIds = new Set();
  const swQueuedIds = new Set();
  let swRegistration = null;
  let swInitPromise = null;
  let swChannel = null;
  let dbPromise = null;
  let localBusyUntil = 0;
  let lastYieldPostAt = 0;

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

  function yieldForBrowsing(ms = 1800) {
    const until = Date.now() + Math.max(400, Math.min(5000, Number(ms) || 1800));
    if (until > localBusyUntil) localBusyUntil = until;
    const now = Date.now();
    if (now - lastYieldPostAt >= 500) {
      lastYieldPostAt = now;
      try {
        navigator.serviceWorker?.controller?.postMessage?.({ type: "SW_DL_CLIENT_YIELD", until });
      } catch {}
    }
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable in this browser"));
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
      req.onerror = () => reject(req.error || new Error("Failed to open offline storage"));
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB operation failed"));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("Transaction failed"));
    });
  }

  function emitChange(detail = {}) {
    if (detail?.id) {
      if (detail.deleted) {
        liveProgressMap.delete(detail.id);
        swActiveIds.delete(detail.id);
        swQueuedIds.delete(detail.id);
      } else {
        liveProgressMap.set(detail.id, {
          ...(liveProgressMap.get(detail.id) || {}),
          ...detail,
          updatedAt: Date.now()
        });
        if (detail.status === "downloading") {
          swActiveIds.add(detail.id);
          swQueuedIds.delete(detail.id);
        } else if (detail.status === "queued") {
          swQueuedIds.add(detail.id);
          swActiveIds.delete(detail.id);
        } else if (detail.status === "complete" || detail.status === "paused" || detail.status === "error") {
          swActiveIds.delete(detail.id);
          swQueuedIds.delete(detail.id);
        }
      }
      const listeners = progressListeners.get(detail.id);
      if (listeners?.size && detail.status) {
        for (const fn of [...listeners]) {
          try { fn(detail); } catch {}
        }
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("cv:offline-change", { detail }));
    } catch {}
  }

  function emitCompleteNotice(detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent("cv:offline-complete", { detail }));
    } catch {}
  }

  function formatBytes(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "0 MB";
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function buildId(path, se = 0, ep = 1) {
    const cleanPath = String(path || "video").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 90);
    return `off_${cleanPath}_s${Number(se) || 0}_e${Number(ep) || 0}`;
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

  async function waitOnlineIfNeeded(signal) {
    if (typeof navigator === "undefined" || navigator.onLine !== false) return;
    await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Download aborted", "AbortError"));
        return;
      }
      const onOnline = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("Download aborted", "AbortError"));
      };
      const timer = setInterval(() => {
        if (navigator.onLine !== false) {
          cleanup();
          resolve();
        }
      }, 2000);
      const cleanup = () => {
        clearInterval(timer);
        window.removeEventListener("online", onOnline);
        signal?.removeEventListener("abort", onAbort);
      };
      window.addEventListener("online", onOnline, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
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

  function fetchInitForUrl(targetUrl, extra = {}) {
    const isSameOrigin = String(targetUrl || "").startsWith("/");
    return {
      priority: extra.priority ?? "low",
      ...extra,
      credentials: isSameOrigin ? "same-origin" : "omit",
      referrerPolicy: "no-referrer"
    };
  }

  async function probeTotalLength(url, signal) {
    try {
      const headRes = await fetch(url, fetchInitForUrl(url, { method: "HEAD", cache: "no-store", signal }));
      const cl = Number(headRes.headers.get("content-length") || 0);
      if (headRes.ok && cl > 0) return cl;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
    try {
      const rangeRes = await fetch(
        url,
        fetchInitForUrl(url, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          cache: "no-store",
          signal
        })
      );
      const cr = parseTotalFromContentRange(rangeRes.headers.get("content-range"));
      try {
        await rangeRes.body?.cancel();
      } catch {}
      if (cr?.total > 0) return cr.total;
      const cl = Number(rangeRes.headers.get("content-length") || 0);
      if (rangeRes.ok && cl > 1) return cl;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
    return 0;
  }

  /**
   * Streams URL from `startOffset` in bounded 4 MiB Range steps with exact-byte continuation.
   * Calls `onBytes(Uint8Array, totalBytes)` sequentially as bytes arrive, so nothing is wasted on drops.
   */
  async function resumableRangeDownload({
    url,
    fallbackUrl = "",
    startOffset = 0,
    knownTotal = 0,
    signal,
    onBytes,
    onProgress,
    onUrlSwitch = null
  }) {
    let activeUrl = url;
    let switchedToFallback = false;
    let offset = Math.max(0, Number(startOffset) || 0);
    let totalBytes = Math.max(0, Number(knownTotal) || 0);
    if (!totalBytes) {
      totalBytes = await probeTotalLength(activeUrl, signal);
      if (!totalBytes && fallbackUrl && fallbackUrl !== activeUrl) {
        const fbTotal = await probeTotalLength(fallbackUrl, signal);
        if (fbTotal > 0) {
          totalBytes = fbTotal;
        }
      }
    }

    const startedAt = Date.now();
    const initialOffset = offset;
    let consecutiveErrors = 0;

    while (totalBytes === 0 || offset < totalBytes) {
      if (signal?.aborted) throw new DOMException("Download aborted", "AbortError");
      await waitOnlineIfNeeded(signal);
      if (offset > initialOffset) {
        const pauseMs = Date.now() < localBusyUntil ? CLIENT_BUSY_YIELD_MS : INTER_CHUNK_YIELD_MS;
        await sleepWithAbort(pauseMs, signal);
      }

      const reqEnd = totalBytes > 0 ? Math.min(totalBytes - 1, offset + CHUNK_SIZE - 1) : offset + CHUNK_SIZE - 1;
      const connectCtrl = new AbortController();
      const onOuterAbort = () => {
        try { connectCtrl.abort(signal?.reason || new DOMException("Download aborted", "AbortError")); } catch {}
      };
      if (signal) {
        if (signal.aborted) onOuterAbort();
        else signal.addEventListener("abort", onOuterAbort, { once: true });
      }
      const connectTimer = setTimeout(() => {
        connectCtrl.abort(new DOMException("Connection timed out", "TimeoutError"));
      }, 30000);
      const reqSignal = connectCtrl.signal;

      let res = null;
      let reader = null;
      let progressInAttempt = 0;
      let serverIgnoredRange = false;

      try {
        res = await fetch(
          activeUrl,
          fetchInitForUrl(activeUrl, {
            headers: { Range: `bytes=${offset}-${reqEnd}` },
            cache: "no-store",
            signal: reqSignal
          })
        );
        clearTimeout(connectTimer);
        if (signal) signal.removeEventListener("abort", onOuterAbort);

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

        // If upstream sent full file (200) or earlier offset (206), skip bytes up to `offset`
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
        if (progressInAttempt === 0 && totalBytes === 0) {
          break;
        }
        if (totalBytes > 0 && offset >= totalBytes) {
          break;
        }
      } catch (err) {
        clearTimeout(connectTimer);
        try { await reader?.cancel(); } catch {}
        if (signal?.aborted || err?.name === "AbortError") {
          throw new DOMException("Download aborted", "AbortError");
        }
        consecutiveErrors++;
        const st = Number(err?.httpStatus || 0);
        const immediateSwitch =
          err instanceof TypeError || st === 401 || st === 403 || st === 404 || st === 416;
        if (
          fallbackUrl &&
          !switchedToFallback &&
          fallbackUrl !== activeUrl &&
          (immediateSwitch || consecutiveErrors >= 2)
        ) {
          activeUrl = fallbackUrl;
          switchedToFallback = true;
          consecutiveErrors = 0;
          onUrlSwitch?.(activeUrl);
          continue;
        }
        if (consecutiveErrors > MAX_RETRIES) {
          throw err;
        }
        const waitMs = Math.min(12000, Math.max(Number(err?.retryAfterMs) || 0, 750 * consecutiveErrors));
        await new Promise(r => setTimeout(r, waitMs));
      } finally {
        clearTimeout(connectTimer);
        try { reader?.releaseLock(); } catch {}
      }
    }

    if (totalBytes > 0 && offset < totalBytes) {
      throw new Error(`Incomplete download (${formatBytes(offset)} / ${formatBytes(totalBytes)})`);
    }

    return { downloadedBytes: offset, totalBytes: totalBytes || offset };
  }

  async function tryOpenDirectDiskWriter(filename) {
    if (window.self !== window.top || typeof window.showSaveFilePicker !== "function") {
      return null;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }]
      });
      return await handle.createWritable();
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      return null;
    }
  }

  async function cleanupStaleOpfsFiles(maxAgeMs = 5 * 60 * 1000) {
    try {
      if (!navigator.storage?.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      const now = Date.now();
      for await (const [name, handle] of root.entries()) {
        if (name.startsWith("cv-dl-") && handle.kind === "file") {
          const tsMatch = name.match(/^cv-dl-(\d+)-/);
          if (tsMatch && now - Number(tsMatch[1]) > maxAgeMs) {
            await root.removeEntry(name).catch(() => {});
          }
        }
      }
    } catch {}
  }

  function triggerBlobSave(blob, filename) {
    const a = document.createElement("a");
    const u = URL.createObjectURL(blob);
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 45000);
  }

  function triggerHiddenFrameDownload(url) {
    if (!url || typeof document === "undefined") return false;
    const frame = document.createElement("iframe");
    frame.style.cssText = "display:none;width:0;height:0;border:0;position:absolute;left:-9999px;visibility:hidden";
    frame.setAttribute("aria-hidden", "true");
    frame.src = url;
    (document.body || document.documentElement).appendChild(frame);
    setTimeout(() => {
      try { frame.remove(); } catch {}
    }, 120000);
    return true;
  }

  function triggerDirectStreamSave(url, filename) {
    try {
      const u = new URL(String(url || ""), location.origin);
      if (u.origin === location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4")) {
        u.searchParams.set("download", "1");
        if (filename) u.searchParams.set("filename", filename);
        triggerHiddenFrameDownload(u.pathname + u.search);
        return;
      }
    } catch {}
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    a.referrerPolicy = "no-referrer";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function hasFreeBrowserStorage(minBytes = 64 * 1024 * 1024) {
    try {
      if (!navigator.storage?.estimate) return true;
      const est = await navigator.storage.estimate();
      const quota = Number(est.quota || 0);
      const usage = Number(est.usage || 0);
      if (quota > 0 && quota - usage < minBytes) return false;
    } catch {}
    return true;
  }

  async function getFreeBrowserStorageBytes() {
    try {
      if (!navigator.storage?.estimate) return Infinity;
      const est = await navigator.storage.estimate();
      const quota = Number(est.quota || 0);
      const usage = Number(est.usage || 0);
      if (quota > 0) return Math.max(0, quota - usage);
    } catch {}
    return Infinity;
  }

  async function downloadToDevice({ url, fallbackUrl = "", filename, onProgress, signal }) {
    let directWriter = await tryOpenDirectDiskWriter(filename);
    let opfsRoot = null;
    let opfsName = "";
    let opfsWriter = null;
    let memChunks = null;

    if (!directWriter) {
      await cleanupStaleOpfsFiles(5 * 60 * 1000);
      const enoughForOpfs = await hasFreeBrowserStorage(96 * 1024 * 1024);
      if (enoughForOpfs) {
        try {
          if (navigator.storage?.getDirectory) {
            opfsRoot = await navigator.storage.getDirectory();
            opfsName = `cv-dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
            const fh = await opfsRoot.getFileHandle(opfsName, { create: true });
            if (typeof fh.createWritable === "function") {
              opfsWriter = await fh.createWritable();
            } else {
              await opfsRoot.removeEntry(opfsName).catch(() => {});
              opfsRoot = null;
              opfsName = "";
            }
          }
        } catch {
          opfsRoot = null;
          opfsWriter = null;
          opfsName = "";
        }
      }
    }

    if (!directWriter && !opfsWriter) {
      const probedSize = await probeTotalLength(url, signal).catch(() => 0);
      if (!probedSize || probedSize > 250 * 1024 * 1024) {
        triggerDirectStreamSave(url, filename);
        return { size: probedSize, streamedToDisk: true };
      }
      memChunks = [];
    }

    const activeWriter = directWriter || opfsWriter;
    const cleanupOpfsNow = () => {
      if (opfsRoot && opfsName) {
        opfsRoot.removeEntry(opfsName).catch(() => {});
      }
    };
    window.addEventListener("pagehide", cleanupOpfsNow, { once: true });

    try {
      const result = await resumableRangeDownload({
        url,
        fallbackUrl,
        signal,
        onProgress,
        onBytes: async chunk => {
          if (activeWriter) {
            await activeWriter.write(chunk);
          } else if (memChunks) {
            memChunks.push(chunk.slice().buffer);
          }
        }
      });

      if (directWriter) {
        await directWriter.close();
        return { size: result.downloadedBytes, streamedToDisk: true };
      }

      if (opfsWriter && opfsRoot) {
        await opfsWriter.close();
        const fh = await opfsRoot.getFileHandle(opfsName);
        const file = await fh.getFile();
        triggerBlobSave(file, filename);
        setTimeout(() => {
          opfsRoot.removeEntry(opfsName).catch(() => {});
        }, 30000);
        return { size: file.size || result.downloadedBytes, streamedToDisk: false };
      }

      const blob = new Blob(memChunks, { type: "video/mp4" });
      memChunks.length = 0;
      triggerBlobSave(blob, filename);
      return { size: blob.size, streamedToDisk: false };
    } catch (err) {
      window.removeEventListener("pagehide", cleanupOpfsNow);
      if (directWriter) await directWriter.abort().catch(() => {});
      if (opfsWriter) await opfsWriter.abort().catch(() => {});
      cleanupOpfsNow();
      throw err;
    }
  }

  async function fetchPosterDataUrl(posterUrl, posterFallbackUrl = "") {
    const candidates = [posterUrl, posterFallbackUrl].filter((u, i, a) => u && a.indexOf(u) === i);
    for (const candidate of candidates) {
      try {
        const res = await fetch(
          candidate,
          fetchInitForUrl(candidate, { cache: "force-cache", signal: AbortSignal.timeout(8000) })
        );
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || blob.size > 512 * 1024) continue;
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      } catch {}
    }
    return "";
  }

  async function fetchOfflineSubtitles(subtitles = []) {
    const out = [];
    const list = (Array.isArray(subtitles) ? subtitles : []).slice(0, 6);
    await Promise.allSettled(
      list.map(async s => {
        if (!s?.url) return;
        try {
          const r = await fetch(s.url, { cache: "force-cache", signal: AbortSignal.timeout(8000) });
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

  async function putVideoRecord(rec) {
    const db = await openDb();
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").put(rec);
    await txDone(tx);
  }

  async function putChunkRecord(videoId, index, uint8) {
    const db = await openDb();
    const tx = db.transaction("chunks", "readwrite");
    tx.objectStore("chunks").put({
      key: `${videoId}::${index}`,
      videoId,
      index,
      size: uint8.byteLength,
      data: uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength)
    });
    await txDone(tx);
  }

  function mergeWithLiveState(rec) {
    if (!rec) return null;
    const live = liveProgressMap.get(rec.id);
    if (live && (live.status === "downloading" || live.status === "queued")) {
      return {
        ...rec,
        status: live.status,
        downloadedBytes: Math.max(Number(rec.downloadedBytes) || 0, Number(live.downloadedBytes) || 0),
        totalBytes: Math.max(Number(rec.totalBytes) || 0, Number(live.totalBytes) || 0),
        speedBps: Number(live.speedBps) || 0
      };
    }
    return rec;
  }

  async function getDownload(id) {
    if (!id) return null;
    try {
      const db = await openDb();
      const tx = db.transaction("videos", "readonly");
      const rec = await reqToPromise(tx.objectStore("videos").get(id));
      return mergeWithLiveState(rec || null);
    } catch {
      return null;
    }
  }

  async function listDownloads() {
    try {
      const db = await openDb();
      const tx = db.transaction("videos", "readonly");
      const all = await reqToPromise(tx.objectStore("videos").getAll());
      const sorted = (Array.isArray(all) ? all : []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return sorted.map(rec => {
        const live = liveProgressMap.get(rec.id);
        if (live && (live.status === "downloading" || live.status === "queued")) {
          return {
            ...rec,
            status: live.status,
            downloadedBytes: Math.max(Number(rec.downloadedBytes) || 0, Number(live.downloadedBytes) || 0),
            totalBytes: Math.max(Number(rec.totalBytes) || 0, Number(live.totalBytes) || 0),
            speedBps: Number(live.speedBps) || 0
          };
        }
        return rec;
      });
    } catch {
      return [];
    }
  }

  async function findDownloadForEpisode(path, se = 0, ep = 1) {
    const id = buildId(path, se, ep);
    return await getDownload(id);
  }

  function hasServiceWorkerSupport() {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator;
  }

  function hasBackgroundFetchSupport() {
    return hasServiceWorkerSupport() && "BackgroundFetchManager" in window;
  }

  function getNotificationPermission() {
    try {
      if (typeof Notification === "undefined") return "unsupported";
      return Notification.permission;
    } catch {
      return "unsupported";
    }
  }

  async function requestNotificationPermission() {
    try {
      if (typeof Notification === "undefined") return "unsupported";
      if (Notification.permission === "default") {
        return await Notification.requestPermission().catch(() => Notification.permission);
      }
      return Notification.permission;
    } catch {
      return "denied";
    }
  }

  function applySwSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    swActiveIds.clear();
    swQueuedIds.clear();
    for (const id of Array.isArray(snapshot.activeIds) ? snapshot.activeIds : []) swActiveIds.add(id);
    for (const id of Array.isArray(snapshot.queuedIds) ? snapshot.queuedIds : []) swQueuedIds.add(id);
    if (snapshot.progress && typeof snapshot.progress === "object") {
      for (const [id, entry] of Object.entries(snapshot.progress)) {
        if (entry) liveProgressMap.set(id, entry);
      }
    }
    emitChange({ snapshotSynced: true });
  }

  function handleSwIncomingMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.type === "CV_DL_EVENT" && data.detail) {
      emitChange(data.detail);
    } else if (data.type === "CV_DL_COMPLETE_NOTICE" && data.detail) {
      emitCompleteNotice(data.detail);
    } else if (data.type === "CV_DL_SNAPSHOT" && data.snapshot) {
      applySwSnapshot(data.snapshot);
    }
  }

  function getActiveSwTarget() {
    if (!hasServiceWorkerSupport()) return null;
    return navigator.serviceWorker.controller || swRegistration?.active || null;
  }

  function postToSw(msg, waitForReply = false, timeoutMs = 5000) {
    const target = getActiveSwTarget();
    if (!target) return Promise.resolve(null);
    if (!waitForReply) {
      try { target.postMessage(msg); } catch {}
      return Promise.resolve({ ok: true });
    }
    return new Promise(resolve => {
      try {
        const ch = new MessageChannel();
        const timer = setTimeout(() => resolve(null), timeoutMs);
        ch.port1.onmessage = ev => {
          clearTimeout(timer);
          resolve(ev.data || null);
        };
        target.postMessage(msg, [ch.port2]);
      } catch {
        resolve(null);
      }
    });
  }

  function initServiceWorker() {
    if (swInitPromise) return swInitPromise;
    swInitPromise = (async () => {
      try {
        if (typeof BroadcastChannel !== "undefined" && !swChannel) {
          swChannel = new BroadcastChannel(CHANNEL_NAME);
          swChannel.addEventListener("message", ev => handleSwIncomingMessage(ev.data));
        }
      } catch {}

      if (!hasServiceWorkerSupport()) return null;
      try {
        navigator.serviceWorker.addEventListener("message", ev => handleSwIncomingMessage(ev.data));
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          postToSw({ type: "SW_DL_GET_SNAPSHOT" }, true).then(snap => {
            if (snap?.ok) applySwSnapshot(snap);
          });
        });

        const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
        swRegistration = reg;

        // If an updated worker is currently installing/waiting, wait briefly so we talk to the newest SW
        const pendingWorker = reg.installing || reg.waiting;
        if (pendingWorker && pendingWorker.state !== "activated") {
          await new Promise(resolve => {
            const done = setTimeout(resolve, 2500);
            pendingWorker.addEventListener("statechange", () => {
              if (pendingWorker.state === "activated" || pendingWorker.state === "redundant") {
                clearTimeout(done);
                resolve();
              }
            });
          });
        }

        await navigator.serviceWorker.ready.catch(() => {});
        const snap = await postToSw({ type: "SW_DL_GET_SNAPSHOT" }, true);
        if (snap?.ok) applySwSnapshot(snap);

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible" && getActiveSwTarget()) {
            postToSw({ type: "SW_DL_GET_SNAPSHOT" }, true).then(s => {
              if (s?.ok) applySwSnapshot(s);
            });
          }
        });
        return reg;
      } catch {
        return null;
      }
    })();
    return swInitPromise;
  }

  async function deleteDownload(id) {
    const active = activeJobs.get(id);
    if (active) {
      active.abortController.abort();
      activeJobs.delete(id);
    }
    localQueuedJobs.delete(id);
    swActiveIds.delete(id);
    swQueuedIds.delete(id);
    liveProgressMap.delete(id);

    await initServiceWorker().catch(() => {});
    if (getActiveSwTarget()) {
      await postToSw({ type: "SW_DL_DELETE", id }, true);
    }

    try {
      const db = await openDb();
      const tx = db.transaction(["videos", "chunks"], "readwrite");
      tx.objectStore("videos").delete(id);
      const idx = tx.objectStore("chunks").index("videoId");
      const keys = await reqToPromise(idx.getAllKeys(id));
      for (const k of Array.isArray(keys) ? keys : []) {
        tx.objectStore("chunks").delete(k);
      }
      await txDone(tx);
    } catch {}
    emitChange({ id, deleted: true });
  }

  async function loadExistingChunksTail(db, id, existingRecord = null) {
    const tx = db.transaction("chunks", "readonly");
    const idx = tx.objectStore("chunks").index("videoId");
    const count = Number(await reqToPromise(idx.count(id))) || 0;
    if (count === 0) return { count: 0, bytes: 0 };
    if (existingRecord && Number(existingRecord.chunkCount) === count && Number(existingRecord.downloadedBytes) > 0) {
      return { count, bytes: Number(existingRecord.downloadedBytes) };
    }
    let totalSavedBytes = 0;
    let maxIndex = -1;
    await new Promise((resolve, reject) => {
      const req = idx.openCursor(id);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
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

  async function tryLocalCompletionNotification(record) {
    const clean = String(record.title || "MovieStreamBD").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "MovieStreamBD";
    const ep = record.episodeLabel ? ` - ${record.episodeLabel}` : "";
    const fname = record.exportFilename || `${clean}${ep} - ${record.quality || "HD"}.mp4`;
    emitCompleteNotice({
      id: record.id,
      title: record.title,
      episodeLabel: record.episodeLabel || "",
      quality: record.quality || "HD",
      totalBytes: record.downloadedBytes || record.totalBytes || 0,
      posterDataUrl: record.posterDataUrl || "",
      posterFallbackUrl: record.posterFallbackUrl || "",
      saveToDevice: Boolean(record.saveToDevice),
      exportFilename: fname,
      exportUrl: `/sw-download-export/${encodeURIComponent(record.id)}?filename=${encodeURIComponent(fname)}`
    });
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        const reg = swRegistration || (hasServiceWorkerSupport() ? await navigator.serviceWorker.getRegistration("/").catch(() => null) : null);
        const titleLabel = record.episodeLabel ? `${record.title} (${record.episodeLabel})` : record.title;
        const body = `Download complete (${record.quality || "HD"} · ${formatBytes(record.downloadedBytes || record.totalBytes)}). Tap to watch offline.`;
        if (reg?.showNotification) {
          await reg.showNotification(`Ready Offline: ${titleLabel}`, {
            body,
            icon: "/favicon.svg",
            tag: `cv-dl-${record.id}`,
            data: { id: record.id, url: `/watch.html?offline=${encodeURIComponent(record.id)}` }
          });
        } else {
          const n = new Notification(`Ready Offline: ${titleLabel}`, { body, icon: "/favicon.svg", tag: `cv-dl-${record.id}` });
          n.onclick = () => {
            try { window.focus(); } catch {}
            location.href = `watch.html?offline=${encodeURIComponent(record.id)}`;
          };
        }
      }
    } catch {}
  }

  function processLocalQueue() {
    while (activeJobs.size < MAX_CONCURRENT_LOCAL && localQueuedJobs.size > 0) {
      const next = localQueuedJobs.entries().next().value;
      if (!next) break;
      const [id, entry] = next;
      localQueuedJobs.delete(id);
      runLocalDownload(entry.opts, entry.onProgress).then(entry.resolve, entry.reject);
    }
  }

  function runLocalDownload(opts, onProgress) {
    const id = opts.id || buildId(opts.path, opts.se, opts.ep);
    if (activeJobs.has(id)) {
      return activeJobs.get(id).promise;
    }

    const abortController = new AbortController();
    const promise = (async () => {
      const db = await openDb();
      const existing = await getDownload(id);
      const { count: existingCount, bytes: existingBytes } = await loadExistingChunksTail(db, id, existing);

      if (existing && existing.status === "complete" && existing.totalBytes > 0 && existingBytes >= existing.totalBytes) {
        emitChange({ id, status: "complete", downloadedBytes: existingBytes, totalBytes: existing.totalBytes, speedBps: 0, saveToDevice: Boolean(opts.saveToDevice ?? existing.saveToDevice) });
        return existing;
      }

      const enoughSpace = await hasFreeBrowserStorage(48 * 1024 * 1024);
      if (!enoughSpace) {
        throw new Error("Browser storage nearly full — delete old offline videos or use Direct Browser Save.");
      }

      const now = Date.now();
      let record = {
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
        posterDataUrl: existing?.posterDataUrl || "",
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
      emitChange({ id, status: "downloading", downloadedBytes: existingBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "page", saveToDevice: record.saveToDevice });

      Promise.all([
        !record.posterDataUrl && (opts.posterUrl || record.posterFallbackUrl)
          ? fetchPosterDataUrl(opts.posterUrl || record.posterFallbackUrl, record.posterFallbackUrl)
          : Promise.resolve(""),
        (!record.subtitles || !record.subtitles.length) && Array.isArray(opts.subtitles)
          ? fetchOfflineSubtitles(opts.subtitles)
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
        }
      });

      let nextChunkIndex = existingCount;
      let pendingParts = [];
      let pendingBytes = 0;

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
        await putChunkRecord(id, nextChunkIndex, merged);
        nextChunkIndex++;
        record.chunkCount = nextChunkIndex;
        record.downloadedBytes = existingBytes + flushedTotal;
        record.updatedAt = Date.now();
        await putVideoRecord(record);
      };

      let flushedTotal = 0;
      let lastUiTick = 0;

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
              onProgress?.({ id, downloadedBytes: done, totalBytes: total, speedBps, status: "downloading" });
              emitChange({ id, status: "downloading", downloadedBytes: done, totalBytes: total, speedBps, mode: "page" });
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
        onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "complete", saveToDevice: record.saveToDevice });
        emitChange({ id, status: "complete", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "page", saveToDevice: record.saveToDevice, pendingDeviceExport: record.pendingDeviceExport });
        await tryLocalCompletionNotification(record);
        return record;
      } catch (err) {
        try { await flushPending(); } catch {}
        if (err?.name === "AbortError") {
          record.status = "paused";
          record.error = "";
          record.updatedAt = Date.now();
          await putVideoRecord(record).catch(() => {});
          onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "paused" });
          emitChange({ id, status: "paused", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, mode: "page" });
          return record;
        }
        record.status = "error";
        record.error = err?.message || "Download interrupted";
        record.updatedAt = Date.now();
        await putVideoRecord(record).catch(() => {});
        onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "error", error: record.error });
        emitChange({ id, status: "error", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, error: record.error, mode: "page" });
        throw err;
      } finally {
        activeJobs.delete(id);
        processLocalQueue();
      }
    })();

    activeJobs.set(id, { abortController, promise });
    return promise;
  }

  async function tryStartBackgroundFetch(opts) {
    if (!hasBackgroundFetchSupport()) return false;
    const targetUrl = String(opts.url || "");
    // BackgroundFetch works best for same-origin or explicit CORS endpoints without custom no-referrer headers
    const abs = new URL(targetUrl, location.origin);
    if (abs.origin !== location.origin) return false;
    try {
      const reg = swRegistration || (await navigator.serviceWorker.ready.catch(() => null));
      if (!reg?.backgroundFetch) return false;
      const existingBg = await reg.backgroundFetch.get(opts.id).catch(() => null);
      if (existingBg) return true;

      const bgFetch = await reg.backgroundFetch.fetch(opts.id, [abs.href], {
        title: opts.episodeLabel ? `${opts.title} (${opts.episodeLabel})` : opts.title,
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
        downloadTotal: Number(opts.totalBytes) || 0
      });

      const startedAt = Date.now();
      emitChange({
        id: opts.id,
        status: "downloading",
        downloadedBytes: bgFetch.downloaded || 0,
        totalBytes: bgFetch.downloadTotal || 0,
        speedBps: 0,
        mode: "bgfetch"
      });

      bgFetch.addEventListener("progress", () => {
        const elapsed = Math.max(0.5, (Date.now() - startedAt) / 1000);
        const speedBps = (bgFetch.downloaded || 0) / elapsed;
        emitChange({
          id: opts.id,
          status: "downloading",
          downloadedBytes: bgFetch.downloaded || 0,
          totalBytes: bgFetch.downloadTotal || 0,
          speedBps,
          mode: "bgfetch"
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  function startDownload(opts, onProgress) {
    const id = opts.id || buildId(opts.path, opts.se, opts.ep);
    const jobOpts = { ...opts, id };

    if (typeof onProgress === "function") {
      if (!progressListeners.has(id)) progressListeners.set(id, new Set());
      progressListeners.get(id).add(onProgress);
    }

    if (getNotificationPermission() === "default") {
      requestNotificationPermission().catch(() => {});
    }

    const waitPromise = new Promise((resolve, reject) => {
      (async () => {
        try {
          const existing = await getDownload(id);
          if (existing?.status === "complete") {
            emitChange({ id, status: "complete", downloadedBytes: existing.downloadedBytes || 0, totalBytes: existing.totalBytes || 0 });
            resolve(existing);
            return;
          }

          const enoughSpace = await hasFreeBrowserStorage(48 * 1024 * 1024);
          if (!enoughSpace) {
            throw new Error("Browser storage nearly full — delete old offline videos or use regular Download.");
          }

          await initServiceWorker().catch(() => {});
          const swTarget = getActiveSwTarget();

          if (swTarget) {
            // Pre-persist poster/subtitles & record immediately if Background Fetch succeeds
            if (jobOpts.useBackgroundFetch) {
              const now = Date.now();
              await putVideoRecord({
                id,
                path: String(jobOpts.path || existing?.path || ""),
                title: String(jobOpts.title || existing?.title || "MovieStream BD Video"),
                episodeLabel: String(jobOpts.episodeLabel || existing?.episodeLabel || ""),
                se: Number(jobOpts.se ?? existing?.se ?? 0) || 0,
                ep: Number(jobOpts.ep ?? existing?.ep ?? 1) || 1,
                quality: String(jobOpts.quality || existing?.quality || "HD"),
                sourceUrl: String(jobOpts.url || existing?.sourceUrl || ""),
                fallbackUrl: String(jobOpts.fallbackUrl || existing?.fallbackUrl || ""),
                mimeType: "video/mp4",
                totalBytes: Number(existing?.totalBytes || jobOpts.totalBytes || 0),
                downloadedBytes: Number(existing?.downloadedBytes || 0),
                chunkCount: Number(existing?.chunkCount || 0),
                chunkSize: CHUNK_SIZE,
                posterDataUrl: existing?.posterDataUrl || "",
                posterFallbackUrl: String(jobOpts.posterFallbackUrl || existing?.posterFallbackUrl || ""),
                subtitles: Array.isArray(existing?.subtitles) ? existing.subtitles : [],
                status: "downloading",
                error: "",
                createdAt: existing?.createdAt || now,
                updatedAt: now
              }).catch(() => {});
              const bgStarted = await tryStartBackgroundFetch(jobOpts);
              if (bgStarted) {
                // Watch completion via event listener
                const onCompleteOrStop = ev => {
                  const d = ev?.detail;
                  if (d?.id !== id) return;
                  if (d.status === "complete") {
                    window.removeEventListener("cv:offline-change", onCompleteOrStop);
                    getDownload(id).then(resolve, () => resolve(d));
                  } else if (d.status === "error") {
                    window.removeEventListener("cv:offline-change", onCompleteOrStop);
                    reject(new Error(d.error || "Background download failed"));
                  } else if (d.status === "paused" || d.deleted) {
                    window.removeEventListener("cv:offline-change", onCompleteOrStop);
                    resolve(d);
                  }
                };
                window.addEventListener("cv:offline-change", onCompleteOrStop);
                return;
              }
            }

            // Delegate to persistent Service Worker 4 MiB chunk queue (survives page navigation!)
            const onSwDone = ev => {
              const d = ev?.detail;
              if (d?.id !== id) return;
              if (d.status === "complete") {
                window.removeEventListener("cv:offline-change", onSwDone);
                getDownload(id).then(resolve, () => resolve(d));
              } else if (d.status === "error") {
                window.removeEventListener("cv:offline-change", onSwDone);
                reject(new Error(d.error || "Download failed"));
              } else if (d.status === "paused" || d.deleted) {
                window.removeEventListener("cv:offline-change", onSwDone);
                resolve(d);
              }
            };
            window.addEventListener("cv:offline-change", onSwDone);
            const ack = await postToSw({ type: "SW_DL_START", job: jobOpts }, true);
            if (ack?.ok) {
              jobOpts.onEnqueued?.({ id, mode: "sw" });
              return;
            }
            window.removeEventListener("cv:offline-change", onSwDone);
          }

          // Fallback to page-local resumable queue if SW isn't controlling this context
          if (activeJobs.has(id)) {
            jobOpts.onEnqueued?.({ id, mode: "page" });
            resolve(await activeJobs.get(id).promise);
            return;
          }
          if (activeJobs.size >= MAX_CONCURRENT_LOCAL) {
            if (!localQueuedJobs.has(id)) {
              const now = Date.now();
              await putVideoRecord({
                id,
                path: String(jobOpts.path || existing?.path || ""),
                title: String(jobOpts.title || existing?.title || "MovieStream BD Video"),
                episodeLabel: String(jobOpts.episodeLabel || existing?.episodeLabel || ""),
                se: Number(jobOpts.se ?? existing?.se ?? 0) || 0,
                ep: Number(jobOpts.ep ?? existing?.ep ?? 1) || 1,
                quality: String(jobOpts.quality || existing?.quality || "HD"),
                sourceUrl: String(jobOpts.url || existing?.sourceUrl || ""),
                fallbackUrl: String(jobOpts.fallbackUrl || existing?.fallbackUrl || ""),
                mimeType: "video/mp4",
                totalBytes: Number(existing?.totalBytes || jobOpts.totalBytes || 0),
                downloadedBytes: Number(existing?.downloadedBytes || 0),
                chunkCount: Number(existing?.chunkCount || 0),
                chunkSize: CHUNK_SIZE,
                posterDataUrl: existing?.posterDataUrl || "",
                posterFallbackUrl: String(jobOpts.posterFallbackUrl || existing?.posterFallbackUrl || ""),
                subtitles: Array.isArray(existing?.subtitles) ? existing.subtitles : [],
                saveToDevice: Boolean(jobOpts.saveToDevice ?? existing?.saveToDevice),
                exportFilename: String(jobOpts.exportFilename || existing?.exportFilename || ""),
                pendingDeviceExport: false,
                status: "queued",
                error: "",
                createdAt: existing?.createdAt || now,
                updatedAt: now
              }).catch(() => {});
              emitChange({ id, status: "queued", downloadedBytes: Number(existing?.downloadedBytes || 0), totalBytes: Number(existing?.totalBytes || 0), speedBps: 0, saveToDevice: Boolean(jobOpts.saveToDevice) });
              localQueuedJobs.set(id, { opts: jobOpts, onProgress, resolve, reject });
            }
            jobOpts.onEnqueued?.({ id, mode: "page-queued" });
            return;
          }
          jobOpts.onEnqueued?.({ id, mode: "page" });
          resolve(await runLocalDownload(jobOpts, onProgress));
        } catch (err) {
          reject(err);
        }
      })();
    });

    return waitPromise;
  }

  function pickSameOriginAttachmentUrl(url, fallbackUrl, filename) {
    const candidates = [url, fallbackUrl].filter(Boolean);
    for (const c of candidates) {
      try {
        const u = new URL(String(c), location.origin);
        if (u.origin === location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4")) {
          u.searchParams.set("download", "1");
          if (filename) u.searchParams.set("filename", filename);
          return u.pathname + u.search;
        }
      } catch {}
    }
    return "";
  }

  async function startDeviceDownload(opts, onProgress) {
    const baseId = opts.id || buildId(opts.path, opts.se, opts.ep);
    const qualityTag = String(opts.quality || "HD").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase() || "hd";
    let targetId = baseId;

    const existingBase = await getDownload(baseId);
    if (existingBase) {
      const sameQuality = String(existingBase.quality || "").toLowerCase() === String(opts.quality || "").toLowerCase();
      if (sameQuality && existingBase.status === "complete") {
        await exportToDevice(baseId);
        return { mode: "instant-export", id: baseId, promise: Promise.resolve(existingBase) };
      }
      if (!sameQuality) {
        targetId = `${baseId}_q${qualityTag}`;
        const existingQ = await getDownload(targetId);
        if (existingQ?.status === "complete") {
          await exportToDevice(targetId);
          return { mode: "instant-export", id: targetId, promise: Promise.resolve(existingQ) };
        }
      }
    }

    await initServiceWorker().catch(() => {});
    const swTarget = getActiveSwTarget();
    const freeBytes = await getFreeBrowserStorageBytes();
    const knownSize = Number(opts.totalBytes || 0);
    const enoughForChunks = knownSize > 0 ? freeBytes > knownSize + 48 * 1024 * 1024 : freeBytes >= 96 * 1024 * 1024;
    const nativeUrl = pickSameOriginAttachmentUrl(opts.url, opts.fallbackUrl, opts.filename);

    if (swTarget && enoughForChunks && !opts.forceNativeBrowser) {
      const dlPromise = startDownload(
        {
          ...opts,
          id: targetId,
          saveToDevice: true,
          exportFilename: opts.filename || ""
        },
        onProgress
      );
      return { mode: "sw-background", id: targetId, promise: dlPromise };
    }

    // Fallback: hand off directly to native Browser Download Manager via non-navigating hidden iframe
    if (nativeUrl) {
      triggerHiddenFrameDownload(nativeUrl);
      return { mode: "native-browser", id: targetId, promise: Promise.resolve({ nativeTriggered: true }) };
    }

    // Last resort: use local chunked device download
    const res = await downloadToDevice({
      url: opts.url,
      fallbackUrl: opts.fallbackUrl || "",
      filename: opts.filename || "MovieStreamBD-Video.mp4",
      onProgress: (done, total, speedBps) => onProgress?.({ id: targetId, status: "downloading", downloadedBytes: done, totalBytes: total, speedBps }),
      signal: opts.signal
    });
    return { mode: "direct-page", id: targetId, promise: Promise.resolve(res) };
  }

  async function markDeviceExported(id) {
    if (!id) return;
    if (getActiveSwTarget()) {
      await postToSw({ type: "SW_DL_CLEAR_EXPORT_FLAG", id }, true);
    }
    try {
      const rec = await getDownload(id);
      if (rec && rec.pendingDeviceExport) {
        rec.pendingDeviceExport = false;
        rec.updatedAt = Date.now();
        await putVideoRecord(rec).catch(() => {});
      }
    } catch {}
  }

  async function pauseDownload(id) {
    if (!id) return;
    if (localQueuedJobs.has(id)) {
      const entry = localQueuedJobs.get(id);
      localQueuedJobs.delete(id);
      const rec = await getDownload(id);
      if (rec) {
        rec.status = "paused";
        rec.error = "";
        rec.updatedAt = Date.now();
        await putVideoRecord(rec).catch(() => {});
        emitChange({ id, status: "paused", downloadedBytes: rec.downloadedBytes || 0, totalBytes: rec.totalBytes || 0, speedBps: 0 });
      }
      entry?.resolve?.(rec);
    }
    const active = activeJobs.get(id);
    if (active) {
      active.abortController.abort();
    }
    if (getActiveSwTarget()) {
      await postToSw({ type: "SW_DL_PAUSE", id }, true);
    }
  }

  async function resumeDownload(id, onProgress) {
    const existing = await getDownload(id);
    if (!existing || !existing.sourceUrl) throw new Error("Download record cannot be resumed");
    return await startDownload({ ...existing, url: existing.sourceUrl }, onProgress);
  }

  async function retryDownload(id, onProgress) {
    return await resumeDownload(id, onProgress);
  }

  async function pauseAll() {
    for (const id of [...localQueuedJobs.keys()]) {
      await pauseDownload(id);
    }
    for (const [id, active] of activeJobs.entries()) {
      try { active.abortController.abort(); } catch {}
      activeJobs.delete(id);
    }
    if (getActiveSwTarget()) {
      await postToSw({ type: "SW_DL_PAUSE_ALL" }, true);
    }
  }

  async function resumeAll() {
    const items = await listDownloads();
    for (const rec of items) {
      if ((rec.status === "paused" || rec.status === "error") && rec.sourceUrl) {
        startDownload({ ...rec, url: rec.sourceUrl }).catch(() => {});
      }
    }
  }

  async function clearCompleted() {
    const items = await listDownloads();
    for (const item of items) {
      if (item.status === "complete") {
        await deleteDownload(item.id).catch(() => {});
      }
    }
  }

  function isActive(id) {
    return activeJobs.has(id) || swActiveIds.has(id);
  }

  function isQueued(id) {
    return localQueuedJobs.has(id) || swQueuedIds.has(id);
  }

  function getLiveProgress(id) {
    return liveProgressMap.get(id) || null;
  }

  async function getCounts() {
    const items = await listDownloads();
    let downloading = 0;
    let queued = 0;
    let completed = 0;
    let paused = 0;
    let failed = 0;
    for (const item of items) {
      if (item.status === "complete") completed++;
      else if (item.status === "downloading" || isActive(item.id)) downloading++;
      else if (item.status === "queued" || isQueued(item.id)) queued++;
      else if (item.status === "error") failed++;
      else paused++;
    }
    return {
      downloading,
      queued,
      activeTotal: downloading + queued,
      completed,
      paused,
      failed,
      total: items.length
    };
  }

  async function getVideoBlob(id) {
    const db = await openDb();
    const meta = await getDownload(id);
    if (!meta) throw new Error("Offline video not found");
    const tx = db.transaction("chunks", "readonly");
    const idx = tx.objectStore("chunks").index("videoId");
    const records = await reqToPromise(idx.getAll(id));
    const sorted = (Array.isArray(records) ? records : []).sort((a, b) => a.index - b.index);
    if (!sorted.length) throw new Error("No video data saved yet");
    const blob = new Blob(
      sorted.map(r => r.data),
      { type: meta.mimeType || "video/mp4" }
    );
    return { meta, blob };
  }

  async function getPlayableMedia(id) {
    const { meta, blob } = await getVideoBlob(id);
    const videoUrl = URL.createObjectURL(blob);
    const subUrls = [];
    const subtitles = (Array.isArray(meta.subtitles) ? meta.subtitles : []).map(s => {
      const subUrl = URL.createObjectURL(new Blob([String(s.vttText || "WEBVTT\n\n")], { type: "text/vtt" }));
      subUrls.push(subUrl);
      return {
        label: s.label || "Subtitle",
        language: s.language || "und",
        url: subUrl
      };
    });
    return {
      meta,
      videoUrl,
      posterUrl: meta.posterDataUrl || "",
      subtitles,
      revoke: () => {
        try { URL.revokeObjectURL(videoUrl); } catch {}
        for (const u of subUrls) {
          try { URL.revokeObjectURL(u); } catch {}
        }
      }
    };
  }

  async function exportToDevice(id) {
    const meta = await getDownload(id);
    if (!meta) throw new Error("Offline video not found");
    const clean = String(meta.title || "MovieStreamBD").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "MovieStreamBD";
    const ep = meta.episodeLabel ? ` - ${meta.episodeLabel}` : "";
    const filename = meta.exportFilename || `${clean}${ep} - ${meta.quality || "HD"}.mp4`;

    if (hasServiceWorkerSupport() && navigator.serviceWorker.controller) {
      const exportUrl = `/sw-download-export/${encodeURIComponent(id)}?filename=${encodeURIComponent(filename)}&ts=${Date.now()}`;
      triggerHiddenFrameDownload(exportUrl);
      await markDeviceExported(id).catch(() => {});
      return filename;
    }

    const writer = await tryOpenDirectDiskWriter(filename);
    if (writer) {
      const db = await openDb();
      const tx = db.transaction("chunks", "readonly");
      const keys = await reqToPromise(tx.objectStore("chunks").index("videoId").getAllKeys(id));
      const sortedKeys = (Array.isArray(keys) ? keys : []).sort((a, b) => (Number(String(a).split("::").pop()) || 0) - (Number(String(b).split("::").pop()) || 0));
      for (const k of sortedKeys) {
        const cTx = db.transaction("chunks", "readonly");
        const rec = await reqToPromise(cTx.objectStore("chunks").get(k));
        if (rec?.data) await writer.write(new Uint8Array(rec.data));
      }
      await writer.close();
      await markDeviceExported(id).catch(() => {});
      return filename;
    }

    const { blob } = await getVideoBlob(id);
    triggerBlobSave(blob, filename);
    await markDeviceExported(id).catch(() => {});
    return filename;
  }

  async function getStorageEstimate() {
    const items = await listDownloads();
    const offlineBytes = items.reduce((sum, x) => sum + (Number(x?.downloadedBytes) || 0), 0);
    let quota = 0;
    let usage = 0;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quota = Number(est.quota || 0);
        usage = Number(est.usage || 0);
      }
    } catch {}
    return {
      count: items.length,
      completeCount: items.filter(x => x.status === "complete").length,
      offlineBytes,
      quota,
      usage
    };
  }

  async function clearAllDownloads() {
    await pauseAll().catch(() => {});
    for (const [id] of localQueuedJobs.entries()) {
      localQueuedJobs.delete(id);
    }
    for (const [id, active] of activeJobs.entries()) {
      try { active.abortController.abort(); } catch {}
      activeJobs.delete(id);
    }
    swActiveIds.clear();
    swQueuedIds.clear();
    liveProgressMap.clear();
    try {
      const db = await openDb();
      const tx = db.transaction(["videos", "chunks"], "readwrite");
      tx.objectStore("videos").clear();
      tx.objectStore("chunks").clear();
      await txDone(tx);
    } catch {}
    await cleanupStaleOpfsFiles(0);
    emitChange({ clearedAll: true });
  }

  cleanupStaleOpfsFiles();
  initServiceWorker();

  try {
    document.addEventListener("click", e => {
      if (e.target?.closest?.("a[href]") && (activeJobs.size > 0 || swActiveIds.size > 0)) {
        yieldForBrowsing(2000);
      }
    }, { capture: true, passive: true });
    window.addEventListener("pagehide", () => {
      if (activeJobs.size > 0 || swActiveIds.size > 0) yieldForBrowsing(2200);
    });
  } catch {}

  window.CineVerseOffline = {
    buildId,
    formatBytes,
    yieldForBrowsing,
    resumableRangeDownload,
    downloadToDevice,
    startDownload,
    startDeviceDownload,
    triggerHiddenFrameDownload,
    markDeviceExported,
    pauseDownload,
    resumeDownload,
    retryDownload,
    pauseAll,
    resumeAll,
    clearCompleted,
    deleteDownload,
    clearAllDownloads,
    getDownload,
    listDownloads,
    findDownloadForEpisode,
    getPlayableMedia,
    exportToDevice,
    getStorageEstimate,
    getCounts,
    getLiveProgress,
    isActive,
    isQueued,
    hasServiceWorkerSupport,
    hasBackgroundFetchSupport,
    getNotificationPermission,
    requestNotificationPermission,
    ready: () => initServiceWorker()
  };
})();
