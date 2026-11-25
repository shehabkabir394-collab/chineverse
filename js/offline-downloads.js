(() => {
  "use strict";

  const DB_NAME = "moviestreambd_offline_v1";
  const DB_VERSION = 1;
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB verified chunks: fast, zero Cloud Run 32 MiB cutoffs
  const READ_IDLE_TIMEOUT_MS = 28000;
  const MAX_RETRIES = 15;

  const activeJobs = new Map(); // id -> { abortController, promise }
  let dbPromise = null;

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
    try {
      window.dispatchEvent(new CustomEvent("cv:offline-change", { detail }));
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

  async function probeTotalLength(url, signal) {
    try {
      const headRes = await fetch(url, { method: "HEAD", cache: "no-store", signal });
      const cl = Number(headRes.headers.get("content-length") || 0);
      if (headRes.ok && cl > 0) return cl;
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
    try {
      const rangeRes = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
        signal
      });
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
    startOffset = 0,
    knownTotal = 0,
    signal,
    onBytes,
    onProgress
  }) {
    let offset = Math.max(0, Number(startOffset) || 0);
    let totalBytes = Math.max(0, Number(knownTotal) || 0);
    if (!totalBytes) {
      totalBytes = await probeTotalLength(url, signal);
    }

    const startedAt = Date.now();
    const initialOffset = offset;
    let consecutiveErrors = 0;

    while (totalBytes === 0 || offset < totalBytes) {
      if (signal?.aborted) throw new DOMException("Download aborted", "AbortError");
      await waitOnlineIfNeeded(signal);

      const reqEnd = totalBytes > 0 ? Math.min(totalBytes - 1, offset + CHUNK_SIZE - 1) : offset + CHUNK_SIZE - 1;
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(() => {
        connectCtrl.abort(new DOMException("Connection timed out", "TimeoutError"));
      }, 30000);
      const reqSignal =
        signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([signal, connectCtrl.signal])
          : connectCtrl.signal;

      let res = null;
      let reader = null;
      let progressInAttempt = 0;
      let serverIgnoredRange = false;

      try {
        res = await fetch(url, {
          headers: { Range: `bytes=${offset}-${reqEnd}` },
          cache: "no-store",
          signal: reqSignal
        });
        clearTimeout(connectTimer);

        if (res.status === 416) {
          const cr = parseTotalFromContentRange(res.headers.get("content-range"));
          try { await res.body?.cancel(); } catch {}
          if (cr?.total > 0 && offset >= cr.total) {
            totalBytes = cr.total;
            break;
          }
          throw new Error("HTTP 416 Range not satisfiable");
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after") || 0);
          try { await res.body?.cancel(); } catch {}
          throw Object.assign(new Error(`Server busy (HTTP ${res.status})`), { retryAfterMs: retryAfter * 1000 });
        }

        if (!res.ok && res.status !== 206) {
          try { await res.body?.cancel(); } catch {}
          throw new Error(`HTTP ${res.status}`);
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

  async function cleanupStaleOpfsFiles() {
    try {
      if (!navigator.storage?.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      const now = Date.now();
      for await (const [name, handle] of root.entries()) {
        if (name.startsWith("cv-dl-") && handle.kind === "file") {
          const tsMatch = name.match(/^cv-dl-(\d+)-/);
          if (tsMatch && now - Number(tsMatch[1]) > 6 * 3600 * 1000) {
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
    setTimeout(() => URL.revokeObjectURL(u), 240000);
  }

  async function downloadToDevice({ url, filename, onProgress, signal }) {
    let directWriter = await tryOpenDirectDiskWriter(filename);
    let opfsRoot = null;
    let opfsName = "";
    let opfsWriter = null;
    let memChunks = null;

    if (!directWriter) {
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
          }
        }
      } catch {
        opfsRoot = null;
        opfsWriter = null;
      }
    }

    if (!directWriter && !opfsWriter) {
      memChunks = [];
    }

    const activeWriter = directWriter || opfsWriter;

    try {
      const result = await resumableRangeDownload({
        url,
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
        }, 240000);
        return { size: file.size || result.downloadedBytes, streamedToDisk: false };
      }

      const blob = new Blob(memChunks, { type: "video/mp4" });
      memChunks.length = 0;
      triggerBlobSave(blob, filename);
      return { size: blob.size, streamedToDisk: false };
    } catch (err) {
      if (directWriter) await directWriter.abort().catch(() => {});
      if (opfsWriter) await opfsWriter.abort().catch(() => {});
      if (opfsRoot && opfsName) await opfsRoot.removeEntry(opfsName).catch(() => {});
      throw err;
    }
  }

  async function fetchPosterDataUrl(posterUrl) {
    if (!posterUrl) return "";
    try {
      const res = await fetch(posterUrl, { cache: "force-cache", signal: AbortSignal.timeout(8000) });
      if (!res.ok) return "";
      const blob = await res.blob();
      if (!blob || blob.size > 512 * 1024) return "";
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
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

  async function getDownload(id) {
    if (!id) return null;
    try {
      const db = await openDb();
      const tx = db.transaction("videos", "readonly");
      const rec = await reqToPromise(tx.objectStore("videos").get(id));
      return rec || null;
    } catch {
      return null;
    }
  }

  async function listDownloads() {
    try {
      const db = await openDb();
      const tx = db.transaction("videos", "readonly");
      const all = await reqToPromise(tx.objectStore("videos").getAll());
      return (Array.isArray(all) ? all : []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch {
      return [];
    }
  }

  async function findDownloadForEpisode(path, se = 0, ep = 1) {
    const id = buildId(path, se, ep);
    return await getDownload(id);
  }

  async function deleteDownload(id) {
    const active = activeJobs.get(id);
    if (active) {
      active.abortController.abort();
      activeJobs.delete(id);
    }
    const db = await openDb();
    const tx = db.transaction(["videos", "chunks"], "readwrite");
    tx.objectStore("videos").delete(id);
    const idx = tx.objectStore("chunks").index("videoId");
    const keys = await reqToPromise(idx.getAllKeys(id));
    for (const k of Array.isArray(keys) ? keys : []) {
      tx.objectStore("chunks").delete(k);
    }
    await txDone(tx);
    emitChange({ id, deleted: true });
  }

  async function loadExistingChunksTail(db, id) {
    const tx = db.transaction("chunks", "readonly");
    const idx = tx.objectStore("chunks").index("videoId");
    const records = await reqToPromise(idx.getAll(id));
    const sorted = (Array.isArray(records) ? records : []).sort((a, b) => a.index - b.index);
    let totalSavedBytes = 0;
    for (const r of sorted) totalSavedBytes += Number(r.size || r.data?.byteLength || 0);
    return { count: sorted.length, bytes: totalSavedBytes };
  }

  function startDownload(opts, onProgress) {
    const id = opts.id || buildId(opts.path, opts.se, opts.ep);
    if (activeJobs.has(id)) {
      return activeJobs.get(id).promise;
    }

    const abortController = new AbortController();
    const promise = (async () => {
      const db = await openDb();
      const existing = await getDownload(id);
      const { count: existingCount, bytes: existingBytes } = await loadExistingChunksTail(db, id);

      if (existing && existing.status === "complete" && existing.totalBytes > 0 && existingBytes >= existing.totalBytes) {
        emitChange({ id, status: "complete", downloadedBytes: existingBytes, totalBytes: existing.totalBytes });
        return existing;
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
        mimeType: "video/mp4",
        totalBytes: Number(existing?.totalBytes || 0),
        downloadedBytes: existingBytes,
        chunkCount: existingCount,
        chunkSize: CHUNK_SIZE,
        posterDataUrl: existing?.posterDataUrl || "",
        subtitles: Array.isArray(existing?.subtitles) ? existing.subtitles : [],
        status: "downloading",
        error: "",
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await putVideoRecord(record);
      emitChange({ id, status: "downloading", downloadedBytes: existingBytes, totalBytes: record.totalBytes });

      // Cache poster & VTT subtitles in parallel (non-blocking if offline-first)
      Promise.all([
        !record.posterDataUrl && opts.posterUrl ? fetchPosterDataUrl(opts.posterUrl) : Promise.resolve(""),
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
          startOffset: existingBytes,
          knownTotal: record.totalBytes,
          signal: abortController.signal,
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
            if (nowMs - lastUiTick > 220) {
              lastUiTick = nowMs;
              onProgress?.({ id, downloadedBytes: done, totalBytes: total, speedBps, status: "downloading" });
              emitChange({ id, status: "downloading", downloadedBytes: done, totalBytes: total, speedBps });
            }
          }
        });

        await flushPending();
        record.totalBytes = res.totalBytes || res.downloadedBytes;
        record.downloadedBytes = res.downloadedBytes;
        record.status = "complete";
        record.error = "";
        record.updatedAt = Date.now();
        await putVideoRecord(record);
        onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "complete" });
        emitChange({ id, status: "complete", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes });
        return record;
      } catch (err) {
        // Flush any full bytes received before pause/error so resume loses 0 bytes
        try {
          await flushPending();
        } catch {}
        if (err?.name === "AbortError") {
          record.status = "paused";
          record.error = "";
          record.updatedAt = Date.now();
          await putVideoRecord(record).catch(() => {});
          onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "paused" });
          emitChange({ id, status: "paused", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes });
          return record;
        }
        record.status = "error";
        record.error = err?.message || "Download interrupted";
        record.updatedAt = Date.now();
        await putVideoRecord(record).catch(() => {});
        onProgress?.({ id, downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, speedBps: 0, status: "error", error: record.error });
        emitChange({ id, status: "error", downloadedBytes: record.downloadedBytes, totalBytes: record.totalBytes, error: record.error });
        throw err;
      } finally {
        activeJobs.delete(id);
      }
    })();

    activeJobs.set(id, { abortController, promise });
    return promise;
  }

  function pauseDownload(id) {
    const active = activeJobs.get(id);
    if (active) {
      active.abortController.abort();
    }
  }

  async function resumeDownload(id, onProgress) {
    const existing = await getDownload(id);
    if (!existing || !existing.sourceUrl) throw new Error("Download record cannot be resumed");
    return await startDownload({ ...existing, url: existing.sourceUrl }, onProgress);
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
    const { meta, blob } = await getVideoBlob(id);
    const clean = String(meta.title || "MovieStreamBD").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    const ep = meta.episodeLabel ? ` - ${meta.episodeLabel}` : "";
    const filename = `${clean}${ep} - ${meta.quality || "HD"}.mp4`;
    const writer = await tryOpenDirectDiskWriter(filename);
    if (writer) {
      await writer.write(blob);
      await writer.close();
      return filename;
    }
    triggerBlobSave(blob, filename);
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

  cleanupStaleOpfsFiles();

  window.CineVerseOffline = {
    buildId,
    formatBytes,
    resumableRangeDownload,
    downloadToDevice,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
    getDownload,
    listDownloads,
    findDownloadForEpisode,
    getPlayableMedia,
    exportToDevice,
    getStorageEstimate,
    isActive: id => activeJobs.has(id)
  };
})();
