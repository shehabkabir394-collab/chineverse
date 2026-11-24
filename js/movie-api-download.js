(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const path = params.get("path") || "";
  const requestedTitle = params.get("title") || "";
  const requested = Math.max(0, Number(params.get("episode")) || 0);
  const requestedQuality = String(params.get("quality") || "").match(/\d{3,4}/)?.[0] || "";

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeName = s =>
    String(s || "MovieStreamBD").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "MovieStreamBD";

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB verified chunks: stays safely below proxy 32 MiB cap & resumes on drops
  const CHUNK_TIMEOUT_MS = 35000;
  const CHUNK_MAX_RETRIES = 5;

  let episodes = [];
  let selected = requested;
  let detail = null;
  let downloadable = [];
  let busy = false;
  let activeDownloadAbort = null;

  const subjectIdOf = () =>
    detail?.subjectId || detail?.subject_id || detail?.subject?.subjectId || detail?.subject?.subject_id || detail?.subject?.id || detail?.id || "";

  function formatBytes(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }

  function buildFilename(ep, src) {
    const titlePart = safeName(detail?.title || requestedTitle || "MovieStreamBD");
    const isSeries = episodes.length > 1 || (Number(ep?.seasonNumber ?? ep?.se ?? 0) || 0) > 0;
    const epTag = isSeries ? safeName(ep?.label || `Episode ${selected + 1}`) : "";
    const qPart = src?.quality || "HD";
    const base = [titlePart, epTag, qPart].filter(Boolean).join(" - ");
    return `${base}.mp4`;
  }

  function decorateMediaUrl(rawUrl, filename) {
    try {
      const u = new URL(String(rawUrl || ""), location.origin);
      if (u.origin === location.origin && u.pathname === "/api/cinepulse-media") {
        u.searchParams.set("download", "1");
        if (filename) u.searchParams.set("filename", filename);
        return u.pathname + u.search;
      }
      return u.href;
    } catch {
      return String(rawUrl || "");
    }
  }

  function sourceDedupeKey(s) {
    try {
      const u = new URL(String(s.url || ""), location.origin);
      if (u.pathname === "/api/cinepulse-media") {
        const tok = u.searchParams.get("mb") || u.searchParams.get("t") || u.pathname;
        const res = u.searchParams.get("res") || s.quality || "";
        return `proxy:${tok}:${res}`;
      }
      return u.origin + u.pathname + u.search;
    } catch {
      return `${s.quality}:${s.url}`;
    }
  }

  function episodeCoords(item, index) {
    const primarySe = Number(item?.seasonNumber ?? item?.se ?? 0) || 0;
    const primaryEp =
      item?.ep != null
        ? Math.max(0, Number(item.ep) || 0)
        : Math.max(0, Number(item?.episodeNumber ?? item?.number ?? (index + 1)) || 1);
    const out = [{ se: primarySe, ep: primaryEp }];
    const label = String(item?.label || item?.name || item?.title || "");
    const match =
      label.match(/S(?:eason)?\s*0*(\d+)\s*[-._ ]*E(?:pisode)?\s*0*(\d+)/i) ||
      label.match(/Season\s*0*(\d+).*?Episode\s*0*(\d+)/i);
    if (match) {
      out.push({ se: Math.max(0, Number(match[1])), ep: Math.max(0, Number(match[2])) });
    }
    if (item?.se != null && item?.ep != null) {
      out.push({ se: Math.max(0, Number(item.se) || 0), ep: Math.max(0, Number(item.ep) || 0) });
    }
    return out.filter((v, i, a) => a.findIndex(x => x.se === v.se && x.ep === v.ep) === i);
  }

  function getSources(ep, filenameBase = "") {
    const raw = [...(Array.isArray(ep?.sources) ? ep.sources : [])];
    for (const b of Array.isArray(ep?.downloadButtons) ? ep.downloadButtons : []) {
      raw.push({ ...b, url: b.downloadUrl || b.download_url || b.url || b.link || b.fileUrl });
    }
    const rows = raw.map(s => {
      const rawUrl = s.downloadUrl || s.download_url || s.url || s.link || s.fileUrl || s.file_url || s.proxyUrl || s.proxy_url;
      const q = String(s.quality || s.resolution || s.resolutions || s.label || s.name || s.title || "").match(/\d{3,4}/)?.[0];
      const quality = q ? `${q}p` : "";
      const isTrailer = Boolean(s.isTrailer);
      const sizeBytes = Number(s.size) || 0;
      const language = String(s.audioLanguage || s.audio_language || s.dubLanguage || s.language || s.lang || "");
      const type = String(s.type || s.format || s.mimeType || "");
      const url = decorateMediaUrl(rawUrl, filenameBase ? `${filenameBase}-${quality || "HD"}.mp4` : "");
      return {
        url,
        quality,
        qualityNum: q ? Number(q) : 0,
        size: sizeBytes,
        sizeText: formatBytes(sizeBytes),
        isTrailer,
        language,
        type
      };
    });

    const filtered = rows.filter(s => {
      try {
        const u = new URL(s.url, location.origin);
        const allowed = u.protocol === "https:" || (u.origin === location.origin && u.pathname === "/api/cinepulse-media");
        return Boolean(s.quality) && allowed && !/m3u8|hls|dash/i.test(s.type) && !/\.(?:m3u8|mpd)(?:$|[?#])/i.test(s.url);
      } catch {
        return false;
      }
    });

    const uniq = [...new Map(filtered.map(s => [sourceDedupeKey(s), s])).values()];
    return uniq.sort((a, b) => Number(a.isTrailer) - Number(b.isTrailer) || b.qualityNum - a.qualityNum);
  }

  function applySelectedSource(src) {
    const ep = episodes[selected];
    const action = $("#downloadAction");
    const safeBtn = $("#downloadSafeChunked");
    const rawLink = $("#downloadDirectRaw");
    const status = $("#downloadStatus");
    if (!src) {
      action.href = "#";
      action.removeAttribute("download");
      action.setAttribute("aria-disabled", "true");
      action.innerHTML = '<span>Download source unavailable<small>Try another episode or audio dub</small></span><b class="icon">↓</b>';
      if (safeBtn) safeBtn.hidden = true;
      if (rawLink) rawLink.hidden = true;
      status.textContent = "এই Episode-এর সরাসরি MP4 source পাওয়া যায়নি। অন্য Episode নির্বাচন করে দেখুন।";
      return;
    }

    const filename = buildFilename(ep, src);
    const finalUrl = decorateMediaUrl(src.url, filename);
    const metaLabel = [src.sizeText, src.language || detail?.language || "", src.isTrailer ? "Trailer Only" : "Full Video"].filter(Boolean).join(" · ");

    action.href = finalUrl;
    action.setAttribute("download", filename);
    action.dataset.dlUrl = finalUrl;
    action.dataset.dlFilename = filename;
    action.setAttribute("aria-disabled", "false");
    action.innerHTML = `<span>⚡ ONE CLICK DOWNLOAD · ${esc(src.quality)}<small>${esc(metaLabel || "Full File · Verified Chunked")}</small></span><b class="icon">↓</b>`;

    if (safeBtn) {
      safeBtn.hidden = true; // Primary ONE CLICK button now uses verified chunked download directly
    }
    if (rawLink) {
      rawLink.hidden = false;
      rawLink.href = finalUrl;
      rawLink.setAttribute("download", filename);
    }
  }

  function updateSources() {
    const ep = episodes[selected];
    const titleStem = safeName(detail?.title || requestedTitle || "MovieStreamBD");
    downloadable = getSources(ep, titleStem);
    const quality = $("#downloadQuality");
    const status = $("#downloadStatus");

    quality.innerHTML = downloadable.length
      ? downloadable
          .map((s, i) => {
            const parts = [s.quality, s.sizeText, s.language, s.isTrailer ? "Trailer" : ""].filter(Boolean);
            return `<option value="${i}">${esc(parts.join(" · "))}</option>`;
          })
          .join("")
      : '<option value="">No direct MP4 quality</option>';
    quality.disabled = !downloadable.length;

    let defaultIdx = 0;
    if (requestedQuality && downloadable.length) {
      const matchIdx = downloadable.findIndex(s => String(s.qualityNum) === requestedQuality || s.quality === `${requestedQuality}p`);
      if (matchIdx >= 0) defaultIdx = matchIdx;
    }
    quality.value = downloadable.length ? String(defaultIdx) : "";

    $("#downloadLinks").innerHTML = downloadable
      .map(s => {
        const fname = buildFilename(ep, s);
        const href = decorateMediaUrl(s.url, fname);
        const sub = [s.sizeText || "Full MP4", s.language || "", s.isTrailer ? "Trailer" : ""].filter(Boolean).join(" · ");
        return `<a class="ms-download-link" href="${esc(href)}" download="${esc(fname)}" data-dl-url="${esc(href)}" data-dl-filename="${esc(fname)}"><span>Download ${esc(s.quality)}<small>${esc(sub)}</small></span><b>⬇</b></a>`;
      })
      .join("");

    if (downloadable.length) {
      const picked = downloadable[defaultIdx] || downloadable[0];
      applySelectedSource(picked);
      const trailerOnly = downloadable.every(s => s.isTrailer);
      status.textContent = trailerOnly
        ? `এই টাইটেলটির শুধু Trailer পাওয়া গেছে (${downloadable.length}টি quality)।`
        : `${downloadable.length}টি পূর্ণাঙ্গ MP4 quality পাওয়া গেছে (${picked.quality}${picked.sizeText ? ` · ${picked.sizeText}` : ""})।`;
    } else {
      applySelectedSource(null);
    }

    $("#downloadZip").hidden = episodes.length < 2 || !subjectIdOf();
    renderEpisodeList();
  }

  async function loadStreamSources(index) {
    const ep = episodes[index];
    const subjectId = subjectIdOf();
    if (!subjectId && !detail?.title && !path) return;
    if (Array.isArray(ep?.sources) && ep.sources.length) {
      const existing = getSources(ep);
      if (existing.length) return;
    }
    for (const c of episodeCoords(ep, index)) {
      try {
        const qs = new URLSearchParams({
          path: String(path || detail?.path || ""),
          ...(subjectId ? { subjectId: String(subjectId) } : {}),
          title: String(detail?.title || requestedTitle || ""),
          detailPath: String(detail?.detailPath || ""),
          source: String(detail?.source || ""),
          se: String(c.se),
          ep: String(c.ep)
        });
        const r = await fetch(`/api/movie-api/stream?${qs.toString()}`, { cache: "no-store" });
        const data = await r.json();
        if (!r.ok || data?.ok === false) continue;
        const incoming = getSources(data);
        if (incoming.length) {
          const merged = [...(ep.sources || []), ...incoming];
          ep.sources = [...new Map(merged.map(item => [sourceDedupeKey(item), item])).values()];
          ep.downloadButtons = [];
          return;
        }
      } catch (e) {
        console.warn("Stream source lookup", e);
      }
    }
  }

  $("#downloadQuality").addEventListener("change", () => {
    const s = downloadable[Number($("#downloadQuality").value)];
    if (s) applySelectedSource(s);
  });

  function renderEpisodeList() {
    const section = $("#downloadEpisodeSection");
    const list = $("#downloadEpisodeList");
    if (episodes.length < 2) {
      section.hidden = true;
      return;
    }
    const groups = new Map();
    episodes.forEach((ep, i) => {
      const key = String(
        ep.seasonName ||
          ep.seasonTitle ||
          (ep.seasonNumber != null
            ? `Season ${ep.seasonNumber}`
            : ep.season != null
              ? typeof ep.season === "number"
                ? `Season ${ep.season}`
                : String(ep.season)
              : "Season 1")
      );
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ep, i });
    });
    $("#downloadEpisodeCount").textContent = `(${episodes.length})`;
    list.innerHTML = [...groups.entries()]
      .map(
        ([season, items], si) =>
          `<section class="ms-season-card"><button class="ms-season-heading" type="button" aria-expanded="${si === 0 ? "true" : "false"}"><span class="ms-season-name">${esc(season)}</span><small>${items.length} Episodes</small><b class="ms-season-chevron">⌄</b></button><div class="ms-season-episodes" ${si === 0 ? "" : "hidden"}>${items
            .map(
              ({ ep, i }) =>
                `<button class="movie-api-episode ms-episode-button ${i === selected ? "active" : ""}" type="button" data-download-episode="${i}"><span class="ms-episode-number">EP ${String(ep.number || i + 1).padStart(2, "0")}</span><span class="ms-episode-info"><b>${esc(ep.label || `Episode ${ep.number || i + 1}`)}</b><small>${esc(ep.kind || "Episode")}</small></span><span class="ms-episode-action">${i === selected ? "● SELECTED" : "⬇ DOWNLOAD"}</span></button>`
            )
            .join("")}</div></section>`
      )
      .join("");
    section.hidden = false;
  }

  async function selectEpisode(index) {
    selected = index;
    const ep = episodes[selected];
    $("#downloadSubtitle").textContent = ep?.label || `Episode ${selected + 1}`;
    $("#downloadStatus").textContent = "Checking this Episode's download servers…";
    renderEpisodeList();
    await loadStreamSources(selected);
    updateSources();
    renderEpisodeList();
  }

  $("#downloadEpisodeList").addEventListener("click", async e => {
    const heading = e.target.closest(".ms-season-heading");
    if (heading) {
      const panel = heading.nextElementSibling;
      const open = heading.getAttribute("aria-expanded") === "true";
      heading.setAttribute("aria-expanded", String(!open));
      panel.hidden = open;
      return;
    }
    const button = e.target.closest("[data-download-episode]");
    if (button) await selectEpisode(Number(button.dataset.downloadEpisode));
  });

  function parseTotalFromContentRange(headerVal) {
    const m = String(headerVal || "").match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  }

  async function fetchChunkWithRetry(url, start, end, outerSignal, retries = CHUNK_MAX_RETRIES) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (outerSignal?.aborted) throw new DOMException("Download cancelled", "AbortError");
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(new DOMException("Chunk timed out", "TimeoutError")), CHUNK_TIMEOUT_MS);
      const signal = outerSignal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([outerSignal, timeoutCtrl.signal])
        : timeoutCtrl.signal;
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          cache: "no-store",
          signal
        });
        clearTimeout(timer);
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("json") || ct.includes("text/html")) {
          throw new Error("Server returned an error page instead of video");
        }
        const buf = await res.arrayBuffer();
        const total = parseTotalFromContentRange(res.headers.get("content-range")) || Number(res.headers.get("content-length") || 0);
        return { buf, status: res.status, total };
      } catch (err) {
        clearTimeout(timer);
        if (outerSignal?.aborted) throw new DOMException("Download cancelled", "AbortError");
        lastErr = err;
        if (attempt >= retries) throw err;
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw lastErr || new Error("Chunk download failed");
  }

  async function tryOpenDirectDiskWriter(filename) {
    // Only works in top-level browsing context (not cross-origin iframes) on desktop Chromium
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
      if (err?.name === "AbortError") throw err; // User cancelled Save dialog
      return null; // SecurityError or unsupported -> silently fall back to Blob download
    }
  }

  async function downloadVerifiedFullFile(url, filename, onProgress, outerSignal) {
    let writable = null;
    try {
      writable = await tryOpenDirectDiskWriter(filename);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      writable = null;
    }

    let totalBytes = 0;
    try {
      const headRes = await fetch(url, { method: "HEAD", cache: "no-store", signal: outerSignal });
      if (headRes.ok) totalBytes = Number(headRes.headers.get("content-length") || 0);
    } catch (err) {
      if (err?.name === "AbortError") {
        await writable?.abort().catch(() => {});
        throw err;
      }
    }

    const chunks = writable ? null : [];
    let downloaded = 0;
    let detectedTotal = totalBytes;
    const startedAt = Date.now();
    let emptyRetries = 0;

    try {
      while (detectedTotal === 0 || downloaded < detectedTotal) {
        if (outerSignal?.aborted) throw new DOMException("Download cancelled", "AbortError");
        const nextEnd = detectedTotal > 0 ? Math.min(detectedTotal - 1, downloaded + CHUNK_SIZE - 1) : downloaded + CHUNK_SIZE - 1;
        const part = await fetchChunkWithRetry(url, downloaded, nextEnd, outerSignal);
        if (part.total > 0 && (detectedTotal === 0 || part.total > detectedTotal)) {
          detectedTotal = part.total;
        }
        if (!part.buf.byteLength) {
          emptyRetries++;
          if (emptyRetries > 3) break;
          await new Promise(r => setTimeout(r, 700));
          continue;
        }
        emptyRetries = 0;
        if (writable) {
          await writable.write(new Uint8Array(part.buf));
        } else {
          chunks.push(part.buf);
        }
        downloaded += part.buf.byteLength;
        const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
        const speedBps = downloaded / elapsedSec;
        onProgress?.(downloaded, detectedTotal, speedBps);
        if (part.status === 200 && downloaded >= detectedTotal) break;
      }

      if (detectedTotal > 0 && downloaded < detectedTotal) {
        throw new Error(`Incomplete download (${formatBytes(downloaded)} / ${formatBytes(detectedTotal)})`);
      }

      if (writable) {
        await writable.close();
        return { size: downloaded, streamedToDisk: true };
      }

      const blob = new Blob(chunks, { type: "video/mp4" });
      chunks.length = 0;
      triggerBlobSave(blob, filename);
      return { size: blob.size, streamedToDisk: false };
    } catch (err) {
      if (writable) await writable.abort().catch(() => {});
      throw err;
    }
  }

  function triggerBlobSave(blob, filename) {
    const a = document.createElement("a");
    const u = URL.createObjectURL(blob);
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 180000);
  }

  async function startVerifiedSingleDownload(url, filename) {
    if (busy || !url) return;
    busy = true;
    activeDownloadAbort = new AbortController();

    const action = $("#downloadAction");
    const cancelBtn = $("#downloadCancelBtn");
    const progress = $("#zipProgress");
    const bar = $("#zipProgressBar");
    const label = $("#zipProgressText");
    const status = $("#downloadStatus");
    const origHtml = action.innerHTML;

    action.setAttribute("aria-disabled", "true");
    action.innerHTML = '<span>⏳ পূর্ণাঙ্গ ডাউনলোড চলছে…<small>অর্ধেক কাটবে না — পেজটি খোলা রাখুন</small></span><b class="icon">⟳</b>';
    if (cancelBtn) cancelBtn.hidden = false;
    progress.hidden = false;
    bar.style.width = "0%";
    label.textContent = "Connecting to download server…";
    status.textContent = "ডাউনলোড শুরু হচ্ছে — প্রতিটি অংশ (5 MB chunk) যাচাই করে নামানো হচ্ছে…";

    try {
      const res = await downloadVerifiedFullFile(
        url,
        filename,
        (done, total, speedBps) => {
          const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
          const speedText = speedBps > 0 ? ` · ${formatBytes(speedBps)}/s` : "";
          bar.style.width = `${pct}%`;
          label.textContent = `Downloaded ${formatBytes(done)} / ${formatBytes(total) || "?"} (${pct}%)${speedText}`;
        },
        activeDownloadAbort.signal
      );
      bar.style.width = "100%";
      label.textContent = `Complete: ${formatBytes(res.size)} (${filename})`;
      status.textContent = res.streamedToDisk
        ? `১০০% সম্পূর্ণ ফাইল সেভ হয়েছে (${formatBytes(res.size)})।`
        : `১০০% সম্পূর্ণ ফাইল যাচাই হয়ে সেভ শুরু হয়েছে (${formatBytes(res.size)})।`;
    } catch (e) {
      if (e?.name === "AbortError") {
        label.textContent = "Download cancelled.";
        status.textContent = "ডাউনলোড বাতিল করা হয়েছে।";
      } else {
        label.textContent = e?.message || "Download ব্যর্থ হয়েছে।";
        status.textContent = `ডাউনলোড ব্যর্থ: ${e?.message || "অন্য Quality চেষ্টা করুন"}`;
      }
    } finally {
      busy = false;
      activeDownloadAbort = null;
      if (cancelBtn) cancelBtn.hidden = true;
      action.setAttribute("aria-disabled", "false");
      action.innerHTML = origHtml;
    }
  }

  $("#downloadCancelBtn")?.addEventListener("click", () => {
    activeDownloadAbort?.abort();
  });

  $("#downloadAction").addEventListener("click", e => {
    e.preventDefault();
    const action = $("#downloadAction");
    if (action.getAttribute("aria-disabled") === "true") return;
    const url = action.dataset.dlUrl || action.getAttribute("href");
    const filename = action.dataset.dlFilename || action.getAttribute("download") || "MovieStreamBD-Video.mp4";
    startVerifiedSingleDownload(url, filename);
  });

  $("#downloadLinks").addEventListener("click", e => {
    const link = e.target.closest(".ms-download-link");
    if (!link) return;
    e.preventDefault();
    const url = link.dataset.dlUrl || link.getAttribute("href");
    const filename = link.dataset.dlFilename || link.getAttribute("download") || "MovieStreamBD-Video.mp4";
    startVerifiedSingleDownload(url, filename);
  });

  async function fetchEpisodeBlobOnly(item, index) {
    let last = "No downloadable MP4 source";
    await loadStreamSources(index);
    const coords = episodeCoords(item, index)[0] || { se: 0, ep: index + 1 };
    const candidates = getSources(item).filter(s => s.url);
    for (const source of candidates) {
      try {
        const chunks = [];
        let downloaded = 0;
        let detectedTotal = 0;
        let emptyRetries = 0;
        while (detectedTotal === 0 || downloaded < detectedTotal) {
          const nextEnd = detectedTotal > 0 ? Math.min(detectedTotal - 1, downloaded + CHUNK_SIZE - 1) : downloaded + CHUNK_SIZE - 1;
          const part = await fetchChunkWithRetry(source.url, downloaded, nextEnd, null);
          if (part.total > 0 && (detectedTotal === 0 || part.total > detectedTotal)) detectedTotal = part.total;
          if (!part.buf.byteLength) {
            emptyRetries++;
            if (emptyRetries > 3) break;
            continue;
          }
          emptyRetries = 0;
          chunks.push(part.buf);
          downloaded += part.buf.byteLength;
          if (part.status === 200 && downloaded >= detectedTotal) break;
        }
        if (detectedTotal > 0 && downloaded < detectedTotal) {
          last = `Incomplete episode (${formatBytes(downloaded)} / ${formatBytes(detectedTotal)})`;
          continue;
        }
        const blob = new Blob(chunks, { type: "video/mp4" });
        if (!blob.size) {
          last = "Empty video file";
          continue;
        }
        return { blob, coords };
      } catch (e) {
        last = e.message || "Network error";
      }
    }
    throw new Error(last);
  }

  $("#downloadZip").addEventListener("click", async () => {
    if (busy) return;
    const subjectId = subjectIdOf();
    if (!subjectId) return;
    if (!window.JSZip) {
      $("#downloadStatus").textContent = "ZIP library load হয়নি। ইন্টারনেট চালু রেখে refresh করুন।";
      return;
    }
    busy = true;
    const btn = $("#downloadZip");
    const progress = $("#zipProgress");
    const bar = $("#zipProgressBar");
    const label = $("#zipProgressText");
    btn.disabled = true;
    btn.textContent = "⏳ ZIP তৈরি হচ্ছে…";
    progress.hidden = false;
    bar.style.width = "0%";

    const zip = new JSZip();
    const root = zip.folder(safeName(detail?.title || "Drama"));
    const failed = [];
    try {
      for (let i = 0; i < episodes.length; i++) {
        const item = episodes[i];
        label.textContent = `Episode ${i + 1} / ${episodes.length} সংগ্রহ হচ্ছে…`;
        try {
          const result = await fetchEpisodeBlobOnly(item, i);
          const seasonNum = Number(item.seasonNumber ?? result.coords.se ?? 1) || 1;
          const season = `Season ${String(seasonNum).padStart(2, "0")}`;
          const epNo = String(item.episodeNumber || item.number || i + 1).padStart(2, "0");
          const filename = `${safeName(item.label || `Episode ${epNo}`)}.mp4`;
          root.folder(season).file(filename, result.blob);
        } catch (e) {
          failed.push(`${item.label || `Episode ${i + 1}`}: ${e.message}`);
        }
        bar.style.width = `${Math.round(((i + 1) / episodes.length) * 75)}%`;
      }
      const successes = episodes.length - failed.length;
      if (!successes) throw new Error(`কোনো Episode ডাউনলোড করা যায়নি। ${failed[0] || ""}`);
      if (failed.length) root.file("DOWNLOAD-REPORT.txt", `Download failed for these episodes:\n${failed.join("\n")}`);
      label.textContent = "ZIP archive তৈরি হচ্ছে…";
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }, m => {
        bar.style.width = `${75 + Math.round(m.percent * 0.25)}%`;
      });
      triggerBlobSave(blob, `${safeName(detail?.title || "Drama")}-Full-Drama.zip`);
      label.textContent = `Complete: ${successes} / ${episodes.length} episodes${failed.length ? ` · ${failed.length} failed` : ""}`;
      $("#downloadStatus").textContent = failed.length
        ? "ZIP তৈরি হয়েছে, তবে কিছু Episode পাওয়া যায়নি। ZIP-এর DOWNLOAD-REPORT.txt দেখুন।"
        : "Full Drama ZIP download শুরু হয়েছে।";
    } catch (e) {
      label.textContent = e.message || "ZIP তৈরি করা যায়নি।";
      $("#downloadStatus").textContent = `ZIP ব্যর্থ: ${e.message || "Unknown error"}`;
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "📦 DOWNLOAD FULL DRAMA ZIP";
    }
  });

  async function load() {
    if (!/^\/(?:mb|movie|series)\/[a-zA-Z0-9_./-]{1,300}$/.test(path)) {
      $("#downloadStatus").textContent = "Invalid title link.";
      return;
    }
    try {
      const r = await fetch(
        `/api/movie-api/details?path=${encodeURIComponent(path)}&title=${encodeURIComponent(requestedTitle)}`,
        { cache: "default" }
      );
      const data = await r.json();
      if (!r.ok || !data.detail) throw new Error(data.error || "Title details unavailable.");
      detail = data.detail;
      episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
      if (!episodes.length) throw new Error("No versions or episodes were returned.");
      selected = Math.min(requested, episodes.length - 1);
      $("#downloadTitle").textContent = detail.title || "Download";
      $("#downloadSubtitle").textContent = episodes[selected].label || `Episode ${selected + 1}`;
      $("#downloadCount").textContent = `${episodes.length} Episodes / Versions`;
      $("#downloadType").textContent = episodes.length > 1 ? "Full Drama" : "Single Video";
      if (detail.poster && /^(?:https?:\/\/|\/api\/)/i.test(detail.poster)) {
        const p = $("#downloadPoster");
        p.src = detail.poster;
        p.hidden = false;
      }
      $("#downloadBack").href = `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(detail.title || requestedTitle)}`;
      renderEpisodeList();
      await loadStreamSources(selected);
      updateSources();
      renderEpisodeList();
    } catch (e) {
      $("#downloadTitle").textContent = "Download unavailable";
      $("#downloadStatus").textContent = e.message || "Could not load download options.";
    }
  }
  load();
})();