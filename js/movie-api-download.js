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

  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB verified chunks: stays safely below proxy/Cloud Run body limits
  const CHUNK_TIMEOUT_MS = 35000;
  const CHUNK_MAX_RETRIES = 12;

  let activePath = path;
  let episodes = [];
  let selected = requested;
  let detail = null;
  let downloadable = [];
  let busy = false;
  let activeDownloadAbort = null;
  let currentSelectedSource = null;

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
      if (u.origin === location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4")) {
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
      const rawProxy = s.proxyUrl || s.proxy_url || "";
      const q = String(s.quality || s.resolution || s.resolutions || s.label || s.name || s.title || "").match(/\d{3,4}/)?.[0];
      const quality = q ? `${q}p` : "";
      const isTrailer = Boolean(s.isTrailer);
      const sizeBytes = Number(s.size) || 0;
      const language = String(s.audioLanguage || s.audio_language || s.dubLanguage || s.language || s.lang || "");
      const type = String(s.type || s.format || s.mimeType || "");
      const fnameHint = filenameBase ? `${filenameBase}-${quality || "HD"}.mp4` : "";
      const url = decorateMediaUrl(rawUrl, fnameHint);
      const proxyUrl = rawProxy ? decorateMediaUrl(rawProxy, fnameHint) : "";
      return {
        url,
        proxyUrl: proxyUrl && proxyUrl !== url ? proxyUrl : "",
        directPlayback: Boolean(s.directPlayback),
        directCors: Boolean(s.directCors),
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
        const allowed = u.protocol === "https:" || (u.origin === location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4"));
        return Boolean(s.quality) && allowed && !/m3u8|hls|dash/i.test(s.type) && !/\.(?:m3u8|mpd)(?:$|[?#])/i.test(s.url) && !/\/api\/mlbd-hls\.m3u8/i.test(s.url);
      } catch {
        return false;
      }
    });

    const uniq = [...new Map(filtered.map(s => [sourceDedupeKey(s), s])).values()];
    return uniq.sort((a, b) => Number(a.isTrailer) - Number(b.isTrailer) || b.qualityNum - a.qualityNum);
  }

  function currentOfflineId() {
    if (!window.CineVerseOffline) return "";
    const ep = episodes[selected];
    const coords = episodeCoords(ep, selected)[0] || { se: 0, ep: 1 };
    return window.CineVerseOffline.buildId(activePath || detail?.path || path, coords.se, coords.ep);
  }

  async function syncOfflineUiState(src = currentSelectedSource) {
    const offBtn = $("#downloadOfflineBtn");
    const offPlay = $("#downloadOfflinePlay");
    if (!offBtn || !window.CineVerseOffline) return;

    const id = currentOfflineId();
    const rec = id ? await window.CineVerseOffline.getDownload(id) : null;

    if (!src && !rec) {
      offBtn.hidden = true;
      if (offPlay) offPlay.hidden = true;
      return;
    }

    if (rec && rec.status === "complete") {
      offBtn.hidden = true;
      if (offPlay) {
        offPlay.hidden = false;
        offPlay.href = `watch.html?offline=${encodeURIComponent(rec.id)}`;
        const sizeTxt = formatBytes(rec.downloadedBytes || rec.totalBytes);
        offPlay.innerHTML = `<span>▶ PLAY OFFLINE NOW (NO INTERNET)<small>Saved in App (${esc(rec.quality || "HD")}${sizeTxt ? ` · ${sizeTxt}` : ""}) · Tap to watch</small></span><b class="icon">▶</b>`;
      }
      return;
    }

    if (offPlay) offPlay.hidden = true;
    offBtn.hidden = false;

    if (rec && (rec.status === "queued" || window.CineVerseOffline.isQueued?.(id))) {
      offBtn.innerHTML = `<span>⏳ QUEUED IN BACKGROUND · TAP TO PAUSE<small>Waiting for active slot · Browse freely</small></span><b class="icon">⏸</b>`;
    } else if (rec && (rec.status === "downloading" || window.CineVerseOffline.isActive(id))) {
      const pct = rec.totalBytes > 0 ? Math.min(100, Math.round((rec.downloadedBytes / rec.totalBytes) * 100)) : 0;
      const doneTxt = formatBytes(rec.downloadedBytes) || "0 MB";
      const totTxt = formatBytes(rec.totalBytes) || "?";
      const spdTxt = Number(rec.speedBps) > 0 ? ` · ${formatBytes(rec.speedBps)}/s` : "";
      offBtn.innerHTML = `<span>⏳ BACKGROUND DOWNLOADING (${pct}%) · TAP TO PAUSE<small>${doneTxt} / ${totTxt}${spdTxt} · Continues if you browse other pages</small></span><b class="icon">⏸</b>`;
    } else if (rec && Number(rec.downloadedBytes || 0) > 0) {
      const pct = rec.totalBytes > 0 ? Math.min(100, Math.round((rec.downloadedBytes / rec.totalBytes) * 100)) : 0;
      const doneTxt = formatBytes(rec.downloadedBytes) || "0 MB";
      const totTxt = formatBytes(rec.totalBytes) || "?";
      offBtn.innerHTML = `<span>▶ RESUME BACKGROUND DOWNLOAD (${pct}%)<small>${doneTxt} / ${totTxt} saved · Continues without restarting</small></span><b class="icon">▶</b>`;
    } else {
      const meta = [src?.quality, src?.sizeText].filter(Boolean).join(" · ");
      offBtn.innerHTML = `<span>📥 BACKGROUND DOWNLOAD (SAVE IN APP)<small>Continues across pages · Watch Offline or Export MP4${meta ? ` · ${esc(meta)}` : ""}</small></span><b class="icon">↓</b>`;
    }
  }

  function applySelectedSource(src) {
    currentSelectedSource = src || null;
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
      syncOfflineUiState(null);
      return;
    }

    const filename = buildFilename(ep, src);
    const finalUrl = decorateMediaUrl(src.url, filename);
    const rawFallback = src.proxyUrl ? decorateMediaUrl(src.proxyUrl, filename) : "";
    const fallbackUrl = rawFallback && rawFallback !== finalUrl ? rawFallback : "";
    const isExternalDirect = /^https?:\/\//i.test(finalUrl);
    const metaLabel = [src.sizeText, src.language || detail?.language || "", src.isTrailer ? "Trailer Only" : "Full Video"].filter(Boolean).join(" · ");

    action.href = finalUrl;
    action.setAttribute("download", filename);
    action.dataset.dlUrl = finalUrl;
    action.dataset.dlFallbackUrl = fallbackUrl;
    action.dataset.dlFilename = filename;
    if (isExternalDirect) {
      action.setAttribute("referrerpolicy", "no-referrer");
      action.setAttribute("rel", "noopener noreferrer");
    } else {
      action.removeAttribute("referrerpolicy");
      action.removeAttribute("rel");
    }
    action.setAttribute("aria-disabled", "false");
    action.innerHTML = `<span>⚡ BACKGROUND DIRECT DOWNLOAD · ${esc(src.quality)}<small>${esc(metaLabel || "Saves to Device Storage while you browse the app")}</small></span><b class="icon">↓</b>`;

    if (safeBtn) {
      safeBtn.hidden = false;
      safeBtn.dataset.dlUrl = finalUrl;
      safeBtn.dataset.dlFallbackUrl = fallbackUrl;
      safeBtn.dataset.dlFilename = filename;
      safeBtn.dataset.dlQuality = src.quality || "HD";
      safeBtn.dataset.dlSize = String(Number(src.size || 0));
      safeBtn.innerHTML = `<span>⚡ INSTANT BROWSER DOWNLOAD (NO CACHE LIMIT)<small>সরাসরি ব্রাউজারের Downloads-এ পাঠান — বড় ফাইলের জন্য সেরা</small></span><b class="icon">⬇</b>`;
    }
    action.dataset.dlQuality = src.quality || "HD";
    action.dataset.dlSize = String(Number(src.size || 0));
    if (rawLink) {
      rawLink.hidden = false;
      rawLink.href = finalUrl;
      rawLink.dataset.dlUrl = finalUrl;
      rawLink.dataset.dlFallbackUrl = fallbackUrl;
      if (isExternalDirect) {
        rawLink.setAttribute("referrerpolicy", "no-referrer");
        rawLink.setAttribute("rel", "noopener noreferrer");
      } else {
        rawLink.removeAttribute("referrerpolicy");
        rawLink.removeAttribute("rel");
      }
      rawLink.removeAttribute("download");
    }
    syncOfflineUiState(src);
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

    const gatewayButtons = (Array.isArray(ep?.downloadButtons) ? ep.downloadButtons : [])
      .filter(b => b?.url && b.type === "gateway");

    const mp4LinksHtml = downloadable
      .map(s => {
        const fname = buildFilename(ep, s);
        const href = decorateMediaUrl(s.url, fname);
        const rawFb = s.proxyUrl ? decorateMediaUrl(s.proxyUrl, fname) : "";
        const fb = rawFb && rawFb !== href ? rawFb : "";
        const extAttrs = /^https?:\/\//i.test(href) ? ' referrerpolicy="no-referrer" rel="noopener noreferrer"' : "";
        const sub = [s.sizeText || "Full MP4", s.language || "", s.isTrailer ? "Trailer" : ""].filter(Boolean).join(" · ");
        return `<a class="ms-download-link" href="${esc(href)}" download="${esc(fname)}" data-dl-url="${esc(href)}" data-dl-fallback-url="${esc(fb)}" data-dl-filename="${esc(fname)}" data-dl-quality="${esc(s.quality)}" data-dl-size="${Number(s.size || 0)}"${extAttrs}><span>Download ${esc(s.quality)}<small>${esc(sub)}</small></span><b>⬇</b></a>`;
      })
      .join("");

    const gatewayLinksHtml = gatewayButtons
      .map(b => {
        const sub = [b.sizeText, b.provider || "Mirror Server"].filter(Boolean).join(" · ");
        return `<a class="ms-download-link" href="${esc(b.url)}" data-mlbd-gateway="1" rel="noopener noreferrer"><span>${esc(b.label || `Mirror ${b.quality || "HD"}`)}<small>${esc(sub)}</small></span><b>↗</b></a>`;
      })
      .join("");

    $("#downloadLinks").innerHTML = mp4LinksHtml + gatewayLinksHtml;

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
          path: String(activePath || detail?.path || ""),
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
        const incomingSubs = Array.isArray(data?.subtitles) ? data.subtitles : Array.isArray(data?.stream?.subtitles) ? data.stream.subtitles : [];
        if (incomingSubs.length && (!Array.isArray(ep.subtitles) || !ep.subtitles.length)) {
          ep.subtitles = incomingSubs;
        }
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

  function parseContentRangeSpan(headerVal) {
    const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(headerVal || "").trim());
    if (!m) return null;
    return {
      start: Number(m[1]),
      end: Number(m[2]),
      total: m[3] === "*" ? 0 : Number(m[3])
    };
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
        const isSameOrigin = String(url || "").startsWith("/");
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          cache: "no-store",
          credentials: isSameOrigin ? "same-origin" : "omit",
          referrerPolicy: "no-referrer",
          signal
        });
        clearTimeout(timer);
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const retryAfterSec = Number(res.headers.get("retry-after") || 0);
          const backoffMs = res.status === 429
            ? Math.max(retryAfterSec * 1000, 2000 * (attempt + 1))
            : 900 * (attempt + 1);
          await new Promise(r => setTimeout(r, Math.min(backoffMs, 15000)));
          continue;
        }
        if (!res.ok && res.status !== 206) {
          throw new Error(`HTTP ${res.status}`);
        }
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("json") || ct.includes("text/html")) {
          throw new Error("Server returned an error page instead of video");
        }
        let buf = await res.arrayBuffer();
        const span = parseContentRangeSpan(res.headers.get("content-range"));
        if (res.status === 200 && start > 0) {
          buf = buf.slice(start, end + 1);
        } else if (res.status === 206 && span && span.start < start) {
          const offset = start - span.start;
          buf = buf.slice(offset, offset + (end - start + 1));
        }
        const total = span?.total || parseTotalFromContentRange(res.headers.get("content-range")) || Number(res.headers.get("content-length") || 0);
        return { buf, status: res.status, total };
      } catch (err) {
        clearTimeout(timer);
        if (outerSignal?.aborted) throw new DOMException("Download cancelled", "AbortError");
        lastErr = err;
        if (attempt >= retries) throw err;
        await new Promise(r => setTimeout(r, Math.min(10000, 900 * (attempt + 1))));
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

  async function downloadVerifiedFullFile(url, filename, onProgress, outerSignal, fallbackUrl = "") {
    if (window.CineVerseOffline?.downloadToDevice) {
      return await window.CineVerseOffline.downloadToDevice({
        url,
        fallbackUrl,
        filename,
        onProgress,
        signal: outerSignal
      });
    }

    const candidates = [url, fallbackUrl].filter((u, i, a) => u && a.indexOf(u) === i);
    let lastDownloadErr = null;

    for (const activeUrl of candidates) {
      let writable = null;
      try {
        writable = await tryOpenDirectDiskWriter(filename);
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        writable = null;
      }

      let totalBytes = 0;
      try {
        const isSameOrigin = String(activeUrl || "").startsWith("/");
        const headRes = await fetch(activeUrl, {
          method: "HEAD",
          cache: "no-store",
          credentials: isSameOrigin ? "same-origin" : "omit",
          referrerPolicy: "no-referrer",
          signal: outerSignal
        });
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
          const part = await fetchChunkWithRetry(activeUrl, downloaded, nextEnd, outerSignal);
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
        if (err?.name === "AbortError") throw err;
        lastDownloadErr = err;
      }
    }
    throw lastDownloadErr || new Error("Download failed");
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

  async function startBackgroundDeviceDownload(url, filename, fallbackUrl = "", opts = {}) {
    if (!url) return;

    const progress = $("#zipProgress");
    const bar = $("#zipProgressBar");
    const label = $("#zipProgressText");
    const status = $("#downloadStatus");
    const ep = episodes[selected];
    const coords = episodeCoords(ep, selected)[0] || { se: 0, ep: 1 };
    const isSeries = episodes.length > 1 || coords.se > 0;
    const episodeLabel = isSeries ? ep?.label || `Episode ${selected + 1}` : "";
    const quality = opts.quality || currentSelectedSource?.quality || "HD";
    const totalBytes = Number(opts.totalBytes ?? currentSelectedSource?.size ?? 0) || 0;

    if (window.CineVerseOffline?.startDeviceDownload) {
      if (progress) progress.hidden = false;
      if (bar) bar.style.width = "4%";
      if (label) label.textContent = "Background Direct Download শুরু হচ্ছে…";
      try {
        const res = await window.CineVerseOffline.startDeviceDownload(
          {
            id: currentOfflineId(),
            path: activePath || detail?.path || path,
            title: detail?.title || requestedTitle || "MovieStream BD",
            episodeLabel,
            se: coords.se,
            ep: coords.ep,
            quality,
            url,
            fallbackUrl,
            filename,
            totalBytes,
            posterUrl: detail?.poster || "",
            posterFallbackUrl: detail?.rawPoster || "",
            subtitles: Array.isArray(ep?.subtitles) ? ep.subtitles : [],
            forceNativeBrowser: Boolean(opts.forceNativeBrowser)
          },
          info => {
            if (!info) return;
            if (progress) progress.hidden = false;
            const total = Number(info.totalBytes || 0);
            const done = Number(info.downloadedBytes || 0);
            const pct = info.status === "complete" ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const speedText = Number(info.speedBps) > 0 ? ` · ${formatBytes(info.speedBps)}/s` : "";
            if (bar) bar.style.width = `${pct}%`;
            if (label) {
              label.textContent =
                info.status === "complete"
                  ? `Complete: ${formatBytes(done || total)} (${filename}) — Saving to Device Storage…`
                  : info.status === "queued"
                    ? "Queued in Background Download Manager…"
                    : `Background Direct Download: ${formatBytes(done)} / ${formatBytes(total) || "?"} (${pct}%)${speedText}`;
            }
          }
        );

        if (res.mode === "sw-background") {
          if (status) status.textContent = "Background Direct Download চলছে — এখন Home বা অন্য পেজ ব্রাউজ করতে পারেন! শেষ হলে ফাইল অটোমেটিক ডিভাইস স্টোরেজে সেভ হবে।";
          window.CineVerseDownloadManager?.refresh?.();
          res.promise
            .then(() => {
              if (bar) bar.style.width = "100%";
              if (label) label.textContent = `Complete: ${filename} (Saved to Device Storage)`;
              if (status) status.textContent = "ডাউনলোড শেষ হয়েছে — ফাইল সরাসরি আপনার ডিভাইসের Downloads-এ সেভ হচ্ছে!";
            })
            .catch(err => {
              if (err?.name !== "AbortError") {
                if (label) label.textContent = err?.message || "Download ব্যর্থ হয়েছে।";
                if (status) status.textContent = `ডাউনলোড সমস্যা: ${err?.message || "Download Manager থেকে Resume করুন"}`;
              }
            });
          return;
        }

        if (res.mode === "native-browser") {
          if (bar) bar.style.width = "100%";
          if (label) label.textContent = `Browser Native Download শুরু হয়েছে (${filename})`;
          if (status) status.textContent = "Browser Native Download শুরু হয়েছে — ডিভাইসের Downloads-এ সেভ হচ্ছে, আপনি নির্দ্বিধায় অ্যাপ ব্রাউজ করতে পারেন।";
          return;
        }

        if (res.mode === "instant-export") {
          if (bar) bar.style.width = "100%";
          if (label) label.textContent = `Exported: ${filename}`;
          if (status) status.textContent = "আগেই ডাউনলোড করা ছিল — ফাইল সরাসরি ডিভাইস স্টোরেজে সেভ হচ্ছে!";
          return;
        }

        if (bar) bar.style.width = "100%";
        if (label) label.textContent = `Complete: ${formatBytes(res.promise?.size || totalBytes)} (${filename})`;
        if (status) status.textContent = "১০০% সম্পূর্ণ ফাইল সেভ হয়েছে।";
        return;
      } catch (e) {
        if (e?.name === "AbortError") {
          if (label) label.textContent = "Download cancelled.";
          if (status) status.textContent = "ডাউনলোড বাতিল করা হয়েছে।";
        } else {
          if (label) label.textContent = e?.message || "Download ব্যর্থ হয়েছে।";
          if (status) status.textContent = `ডাউনলোড ব্যর্থ: ${e?.message || "অন্য Quality চেষ্টা করুন"}`;
        }
        return;
      }
    }

    // Legacy fallback if offline-downloads module isn't loaded
    if (busy) return;
    busy = true;
    activeDownloadAbort = new AbortController();
    const action = $("#downloadAction");
    const cancelBtn = $("#downloadCancelBtn");
    const origHtml = action.innerHTML;

    action.setAttribute("aria-disabled", "true");
    action.innerHTML = '<span>⏳ পূর্ণাঙ্গ ডাউনলোড চলছে…<small>মাঝপথে কাটবে না — ৪ MB রিজিউম ইঞ্জিন চালু আছে</small></span><b class="icon">⟳</b>';
    if (cancelBtn) cancelBtn.hidden = false;
    progress.hidden = false;
    bar.style.width = "0%";
    label.textContent = "Connecting to download server…";
    status.textContent = "Resumable Verified Download চলছে — ৪ MB chunk যাচাই করে ১০০% ফাইল নামানো হচ্ছে…";

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
        activeDownloadAbort.signal,
        fallbackUrl
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
    const action = $("#downloadAction");
    const url = action?.dataset.dlUrl || action?.getAttribute("href");
    if (action.getAttribute("aria-disabled") === "true" || !url || url === "#") {
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    const filename = action?.dataset.dlFilename || action?.getAttribute("download") || "MovieStreamBD-Video.mp4";
    const fallbackUrl = action?.dataset.dlFallbackUrl || "";
    startBackgroundDeviceDownload(url, filename, fallbackUrl, {
      quality: action?.dataset.dlQuality || currentSelectedSource?.quality || "HD",
      totalBytes: Number(action?.dataset.dlSize || currentSelectedSource?.size || 0)
    });
  });

  $("#downloadOfflineBtn")?.addEventListener("click", async () => {
    if (!window.CineVerseOffline) {
      $("#downloadStatus").textContent = "এই ব্রাউজারে Offline storage পাওয়া যায়নি।";
      return;
    }
    const id = currentOfflineId();
    if (!id) return;
    if (window.CineVerseOffline.isActive(id) || window.CineVerseOffline.isQueued?.(id)) {
      await window.CineVerseOffline.pauseDownload(id);
      $("#downloadStatus").textContent = "Background download পজ করা হয়েছে — চাইলে পরে যেকোনো পেজ থেকে Resume করতে পারবেন।";
      syncOfflineUiState();
      return;
    }

    const progress = $("#zipProgress");
    const bar = $("#zipProgressBar");
    const label = $("#zipProgressText");
    const status = $("#downloadStatus");

    const ep = episodes[selected];
    const coords = episodeCoords(ep, selected)[0] || { se: 0, ep: 1 };
    const isSeries = episodes.length > 1 || coords.se > 0;
    const episodeLabel = isSeries ? ep?.label || `Episode ${selected + 1}` : "";

    const handleProgress = info => {
      if (progress) progress.hidden = false;
      const pct = info.totalBytes > 0 ? Math.min(100, Math.round((info.downloadedBytes / info.totalBytes) * 100)) : 0;
      const speedText = info.speedBps > 0 ? ` · ${formatBytes(info.speedBps)}/s` : "";
      if (bar) bar.style.width = `${pct}%`;
      if (label) {
        label.textContent = info.status === "complete"
          ? `Offline Ready: ${formatBytes(info.downloadedBytes)}`
          : info.status === "queued"
            ? "Queued in Background Download Manager…"
            : `Background Download: ${formatBytes(info.downloadedBytes)} / ${formatBytes(info.totalBytes) || "?"} (${pct}%)${speedText}`;
      }
      syncOfflineUiState();
    };

    window.CineVerseOffline.getDownload(id).then(existing => {
      const sameQuality =
        !existing?.quality ||
        !currentSelectedSource?.quality ||
        String(existing.quality).toLowerCase() === String(currentSelectedSource.quality).toLowerCase();
      if (existing && existing.sourceUrl && existing.status !== "complete" && (sameQuality || Number(existing.downloadedBytes || 0) > 0)) {
        if (status) status.textContent = "Background download পুনরায় চালু হয়েছে — অন্য পেজে গেলেও চলবে।";
        window.CineVerseOffline.resumeDownload(id, handleProgress).then(() => {
          if (status) status.textContent = "অফলাইন প্লেব্যাকের জন্য সম্পূর্ণ ভিডিও সেভ হয়েছে! Download Manager বা My List থেকে Play / Save MP4 করতে পারবেন।";
          syncOfflineUiState();
        }).catch(err => {
          if (err?.name !== "AbortError" && status) status.textContent = `Download error: ${err?.message || "Try resuming"}`;
          syncOfflineUiState();
        });
        syncOfflineUiState();
        return;
      }

      if (!currentSelectedSource) return;
      const filename = buildFilename(ep, currentSelectedSource);
      const finalUrl = decorateMediaUrl(currentSelectedSource.url, filename);
      const rawFallback = currentSelectedSource.proxyUrl ? decorateMediaUrl(currentSelectedSource.proxyUrl, filename) : "";
      const fallbackUrl = rawFallback && rawFallback !== finalUrl ? rawFallback : "";
      if (status) status.textContent = "Background Download শুরু হয়েছে — এখন Home বা অন্য মুভি ব্রাউজ করলেও ডাউনলোড চলতে থাকবে!";
      window.CineVerseOffline
        .startDownload(
          {
            id,
            path: activePath || detail?.path || path,
            title: detail?.title || requestedTitle || "MovieStream BD",
            episodeLabel,
            se: coords.se,
            ep: coords.ep,
            quality: currentSelectedSource.quality || "HD",
            totalBytes: Number(currentSelectedSource.size || 0),
            url: finalUrl,
            fallbackUrl,
            posterUrl: detail?.poster || "",
            posterFallbackUrl: detail?.rawPoster || "",
            subtitles: Array.isArray(ep?.subtitles) ? ep.subtitles : []
          },
          handleProgress
        )
        .then(() => {
          if (status) status.textContent = "সম্পূর্ণ ভিডিও সেভ হয়েছে! ডানপাশের Download Manager আইকন বা My List থেকে Play / Save MP4 করুন।";
          syncOfflineUiState();
        })
        .catch(err => {
          if (err?.name !== "AbortError" && status) status.textContent = `Download error: ${err?.message || "Try resuming"}`;
          syncOfflineUiState();
        });
      syncOfflineUiState();
    });
  });

  window.addEventListener("cv:offline-change", ev => {
    if (!ev?.detail?.id || ev.detail.id === currentOfflineId()) {
      syncOfflineUiState();
    }
  });

  $("#downloadSafeChunked")?.addEventListener("click", () => {
    const safeBtn = $("#downloadSafeChunked");
    const action = $("#downloadAction");
    const url = safeBtn?.dataset.dlUrl || action?.dataset.dlUrl || action?.getAttribute("href");
    const fallbackUrl = safeBtn?.dataset.dlFallbackUrl || action?.dataset.dlFallbackUrl || "";
    const filename = safeBtn?.dataset.dlFilename || action?.dataset.dlFilename || action?.getAttribute("download") || "MovieStreamBD-Video.mp4";
    if (!url || url === "#") return;
    startBackgroundDeviceDownload(url, filename, fallbackUrl, {
      quality: safeBtn?.dataset.dlQuality || currentSelectedSource?.quality || "HD",
      totalBytes: Number(safeBtn?.dataset.dlSize || currentSelectedSource?.size || 0),
      forceNativeBrowser: true
    });
  });

  $("#downloadDirectRaw")?.addEventListener("click", async e => {
    const rawLink = $("#downloadDirectRaw");
    const rawHref = rawLink?.dataset.dlUrl || rawLink?.getAttribute("href");
    if (!rawHref || rawHref === "#") return;
    e.preventDefault();
    const absUrl = new URL(rawHref, location.origin).href;
    const status = $("#downloadStatus");
    try {
      await navigator.clipboard.writeText(absUrl);
      if (status) status.textContent = "Direct Server Link (IDM / ADM) কপি করা হয়েছে — এখন IDM/ADM-এ paste করুন।";
    } catch {
      const ta = document.createElement("textarea");
      ta.value = absUrl;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        if (status) status.textContent = "Direct Server Link (IDM / ADM) কপি করা হয়েছে।";
      } catch {
        if (status) status.textContent = `Direct Link: ${absUrl}`;
      }
      ta.remove();
    }
  });

  $("#downloadLinks").addEventListener("click", e => {
    const link = e.target.closest(".ms-download-link");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || href === "#") {
      e.preventDefault();
      return;
    }
    if (link.dataset.mlbdGateway === "1") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    const url = link.dataset.dlUrl || href;
    const fallbackUrl = link.dataset.dlFallbackUrl || "";
    const filename = link.dataset.dlFilename || link.getAttribute("download") || "MovieStreamBD-Video.mp4";
    startBackgroundDeviceDownload(url, filename, fallbackUrl, {
      quality: link.dataset.dlQuality || currentSelectedSource?.quality || "HD",
      totalBytes: Number(link.dataset.dlSize || 0)
    });
  });

  async function fetchEpisodeBlobOnly(item, index) {
    let last = "No downloadable MP4 source";
    await loadStreamSources(index);
    const coords = episodeCoords(item, index)[0] || { se: 0, ep: index + 1 };
    const candidates = getSources(item).filter(s => s.url);
    for (const source of candidates) {
      try {
        const chunks = [];
        if (window.CineVerseOffline?.resumableRangeDownload) {
          await window.CineVerseOffline.resumableRangeDownload({
            url: source.url,
            fallbackUrl: source.proxyUrl || "",
            onBytes: async chunk => {
              chunks.push(chunk.slice().buffer);
            }
          });
        } else {
          const urlsToTry = [source.url, source.proxyUrl].filter((u, i, a) => u && a.indexOf(u) === i);
          let completedSource = false;
          for (const tryUrl of urlsToTry) {
            chunks.length = 0;
            let downloaded = 0;
            let detectedTotal = 0;
            let emptyRetries = 0;
            try {
              while (detectedTotal === 0 || downloaded < detectedTotal) {
                const nextEnd = detectedTotal > 0 ? Math.min(detectedTotal - 1, downloaded + CHUNK_SIZE - 1) : downloaded + CHUNK_SIZE - 1;
                const part = await fetchChunkWithRetry(tryUrl, downloaded, nextEnd, null);
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
              completedSource = true;
              break;
            } catch (err) {
              last = err?.message || "Network error";
            }
          }
          if (!completedSource) continue;
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

  function readCachedDownloadDetail(targetPath) {
    try {
      const m = JSON.parse(sessionStorage.getItem("cv_watch_detail_v1") || "{}");
      const hit = m[targetPath];
      if (hit && hit.ts && Date.now() - hit.ts < 3 * 60 * 1000 && hit.detail && hit.detail.hasResource !== false && Array.isArray(hit.detail.episodes) && hit.detail.episodes.length > 0) {
        return hit.detail;
      }
    } catch {}
    return null;
  }

  async function load() {
    if (!/^\/(?:mb|mlbd|movie|series|drama|anime)\/[a-zA-Z0-9_./-]{1,300}$/i.test(path)) {
      $("#downloadStatus").textContent = "Invalid title link.";
      return;
    }
    try {
      const reqUrl = `/api/movie-api/details?path=${encodeURIComponent(path)}&title=${encodeURIComponent(requestedTitle)}`;
      let loadedDetail = readCachedDownloadDetail(path);
      if (!loadedDetail) {
        const pre = window.__cvDownloadDetailPreload;
        let data = null;
        if (pre && pre.url === reqUrl && pre.promise) {
          window.__cvDownloadDetailPreload = null;
          data = await pre.promise;
        } else {
          const r = await fetch(reqUrl, { cache: "default" });
          data = await r.json();
          if (!r.ok && !data?.detail) throw new Error(data?.error || "Title details unavailable.");
        }
        if (!data?.detail) throw new Error(data?.error || "Title details unavailable.");
        loadedDetail = data.detail;
      }
      detail = loadedDetail;
      if (detail.path && detail.path !== activePath) {
        activePath = detail.path;
      }
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
      $("#downloadBack").href = `watch.html?path=${encodeURIComponent(activePath)}&title=${encodeURIComponent(detail.title || requestedTitle)}`;
      renderEpisodeList();
      await loadStreamSources(selected);
      updateSources();
      renderEpisodeList();
      syncOfflineUiState();
    } catch (e) {
      $("#downloadTitle").textContent = "Download unavailable";
      $("#downloadStatus").textContent = e.message || "Could not load download options.";
    }
  }
  load();
})();