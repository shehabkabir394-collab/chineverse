(() => {
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const HISTORY_KEY = "cv_watch_history_v1";
  const BOOST_KEY = "cv_sound_boost_v1";
  const BRIGHT_KEY = "cv_brightness_v1";
  const AMBIENT_KEY = "cv_ambient_mode_v1";
  const AMBIENT_LEVEL_KEY = "cv_ambient_level_v1";
  const PLAYBACK_MODE_KEY = "cv_playback_quality_mode_v1";

  function readPlaybackMode() {
    if (window.CineVerseAccount?.getPlaybackMode) {
      return window.CineVerseAccount.getPlaybackMode();
    }
    try {
      const v = localStorage.getItem(PLAYBACK_MODE_KEY);
      if (v === "data-saver" || v === "high-quality") return v;
    } catch {}
    try {
      if (navigator.connection?.saveData) return "data-saver";
    } catch {}
    return "high-quality";
  }

  function writePlaybackMode(mode) {
    const next = mode === "data-saver" ? "data-saver" : "high-quality";
    if (window.CineVerseAccount?.setPlaybackMode) {
      return window.CineVerseAccount.setPlaybackMode(next);
    }
    try {
      localStorage.setItem(PLAYBACK_MODE_KEY, next);
    } catch {}
    window.dispatchEvent(new CustomEvent("cv:playback-mode-change", { detail: { mode: next } }));
    return next;
  }

  function srtToVtt(text) {
    const clean = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!clean) return "WEBVTT\n\n";
    if (/^WEBVTT(?:\s|$)/i.test(clean)) return clean;
    const norm = ts => {
      const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(ts.trim());
      if (!m) return ts.trim();
      return `${String(Number(m[1] || 0)).padStart(2, "0")}:${String(Number(m[2])).padStart(2, "0")}:${String(Number(m[3])).padStart(2, "0")}.${String(m[4]).padEnd(3, "0").slice(0, 3)}`;
    };
    const cues = [];
    for (const block of clean.split(/\n{2,}/)) {
      const lines = block.split("\n").map(l => l.trimEnd()).filter(Boolean);
      const tIdx = lines.findIndex(l => l.includes("-->"));
      if (tIdx < 0) continue;
      const parts = lines[tIdx].split("-->");
      if (parts.length < 2) continue;
      const rest = parts[1].trim().split(/\s+/);
      const payload = lines.slice(tIdx + 1).map(l => l.replace(/\{\\an\d+\}/gi, "").trim());
      if (!payload.length) continue;
      cues.push(`${norm(parts[0])} --> ${norm(rest[0] || "")}${rest.length > 1 ? " " + rest.slice(1).join(" ") : ""}\n${payload.join("\n")}`);
    }
    return `WEBVTT\n\n${cues.join("\n\n")}\n`;
  }

  function saveHistoryEntry(meta, currentTime, duration) {
    if (!meta?.path || !Number.isFinite(currentTime) || currentTime < 2) return;
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      const list = Array.isArray(raw) ? raw : [];
      const filtered = list.filter(x => x && x.path !== meta.path);
      const entry = {
        path: meta.path,
        title: meta.title || "Untitled",
        poster: meta.poster || "",
        isSeries: Boolean(meta.isSeries),
        se: Number(meta.se || 0),
        ep: Number(meta.ep || 0),
        currentTime: Math.floor(currentTime),
        duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
        updatedAt: Date.now()
      };
      localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...filtered].slice(0, 30)));
    } catch {}
  }

  function mount({
    video,
    sources = [],
    storageKey = "cv-player",
    subtitles = [],
    title = "Now Playing",
    backUrl = "./",
    historyMeta = null,
    onOpenSettings = null,
    onStateChange = null,
    onRetryStream = null
  }) {
    if (!video || !sources.length) return null;

    const wrap = document.createElement("div");
    wrap.className = "cv-player";
    video.parentNode.insertBefore(wrap, video);
    wrap.appendChild(video);
    video.controls = false;
    video.playsInline = true;
    video.muted = false;
    video.defaultMuted = false;

    let currentMeta = historyMeta ? { ...historyMeta } : { path: "", title, poster: "", isSeries: false, se: 0, ep: 0 };

    const FAST_HOST_KEY = "cv_fast_srv_v1";
    const readClientServerScores = () => {
      try {
        const raw = JSON.parse(sessionStorage.getItem(FAST_HOST_KEY) || "{}");
        const now = Date.now();
        const clean = {};
        for (const [k, v] of Object.entries(raw || {})) {
          if (v && now - Number(v.at || 0) < 180000) clean[k] = v;
        }
        return clean;
      } catch {
        return {};
      }
    };
    const writeClientServerScore = (urlKey, latencyMs, ok = true) => {
      if (!urlKey) return;
      try {
        const cur = readClientServerScores();
        cur[urlKey] = { latencyMs: Number(latencyMs) || 500, ok: Boolean(ok), at: Date.now() };
        const keys = Object.keys(cur);
        if (keys.length > 24) delete cur[keys[0]];
        sessionStorage.setItem(FAST_HOST_KEY, JSON.stringify(cur));
      } catch {}
    };
    const sourceServerKey = rawUrl => {
      try {
        const u = new URL(String(rawUrl || ""), location.origin);
        return `${u.pathname}:${u.searchParams.get("res") || ""}:${String(u.searchParams.get("t") || u.searchParams.get("mb") || "").slice(0, 12)}`;
      } catch {
        return String(rawUrl || "").slice(0, 48);
      }
    };

    const qualityNumber = x => Number(String(x?.quality || "").match(/\d+/)?.[0] || 0);
    const normalizeQualityLabel = raw => {
      const s = String(raw || "Auto").trim();
      const m = /^(\d{3,4})\s*p?$/i.exec(s);
      return m ? `${m[1]}p` : s || "Auto";
    };
    const isHlsSource = s =>
      /\.m3u8(?:$|[?#])/i.test(String(s?.url || "")) ||
      /\/api\/(?:sports-hls|mlbd-hls)\//i.test(String(s?.url || "")) ||
      /mpegurl|m3u8|hls/i.test(String(s?.mime || s?.type || ""));
    const normalizeSources = list =>
      [...list]
        .filter(x => {
          if (!x || !x.url) return false;
          if (/\.mpd(?:$|[?#])/i.test(String(x.url))) return false;
          if (/\bdash\b|dash\+xml/i.test(String(x.format || x.mime || x.type || ""))) return false;
          return true;
        })
        .map((x, idx) => ({
          ...x,
          _origIdx: idx,
          quality: normalizeQualityLabel(x.quality),
          mime: String(x.mime || x.type || "")
        }));

    const dedupeByQuality = list => {
      const byQ = new Map();
      for (const s of [...list].sort((a, b) => qualityNumber(a) - qualityNumber(b))) {
        const key = String(s.quality || "Auto").toLowerCase();
        const prev = byQ.get(key);
        const isHls = isHlsSource(s);
        const prevIsHls = prev ? isHlsSource(prev) : false;
        const sLat = Number(s.serverLatencyMs || 500);
        const pLat = prev ? Number(prev.serverLatencyMs || 500) : 9999;
        if (!prev || (prev.serverOk === false && s.serverOk !== false) || (prevIsHls && !isHls && s.serverOk !== false) || sLat + 120 < pLat) {
          byQ.set(key, s);
        }
      }
      return [...byQ.values()].sort((a, b) => qualityNumber(a) - qualityNumber(b));
    };

    let allSources = normalizeSources(sources);
    let ordered = dedupeByQuality(allSources);
    let playbackMode = readPlaybackMode();
    let activeHlsStopped = false;
    let pauseStopTimer = 0;

    const applySaverUrlFlag = rawUrl => {
      try {
        const u = new URL(String(rawUrl || ""), location.origin);
        if (u.origin === location.origin && (u.pathname === "/api/cinepulse-media" || u.pathname === "/api/mlbd-stream.mp4")) {
          if (playbackMode === "data-saver") u.searchParams.set("saver", "1");
          else u.searchParams.delete("saver");
          return u.pathname + u.search;
        }
      } catch {}
      return String(rawUrl || "");
    };

    const scoreCandidateForPlayback = (s, clientScores) => {
      if (!s || !s.url) return -999999;
      if (s.serverOk === false) return -50000;
      const c = navigator.connection || {};
      const down = Number(c.downlink) || 0;
      const verySlow = /2g|slow-2g/i.test(c.effectiveType || "") || (down > 0 && down < 1.5);
      const moderateSlow = verySlow || /3g/i.test(c.effectiveType || "") || (down > 0 && down < 3.2);
      const qNum = qualityNumber(s);
      const isHls = isHlsSource(s);
      const cs = clientScores?.[sourceServerKey(s.url)];
      const lat = cs ? Number(cs.latencyMs || 500) : Number(s.serverLatencyMs || 450);
      if (cs && cs.ok === false) return -40000;

      if (playbackMode === "data-saver") {
        let sc = 0;
        if (qNum > 0 && qNum <= 480) sc += 5000 + qNum;
        else if (isHls) sc += 4000;
        else sc += Math.max(0, 2000 - qNum);
        return sc - lat;
      }

      const fastTier = lat <= 420 ? 3 : lat <= 850 ? 2 : 1;
      let sc = fastTier * 10000 + Math.max(0, 1200 - lat);
      if (s.autoSelected && !cs) sc += 600;
      if (moderateSlow) {
        // On slower mobile connections, adaptive HLS or 720p/480p avoids buffering
        if (isHls) sc += 2600;
        else if (qNum > 0 && qNum <= 720) sc += 2200 + qNum;
        else sc += 800;
      } else {
        if (qNum >= 1080) sc += 1800;
        else if (isHls) sc += 1650;
        else if (qNum >= 720) sc += 1400;
        else sc += qNum;
      }
      return sc;
    };

    const rankAllCandidates = (pool = allSources, excludeSet = null) => {
      const clientScores = readClientServerScores();
      const filtered = (Array.isArray(pool) ? pool : []).filter(x => x && x.url && (!excludeSet || !excludeSet.has(x.url)));
      const base = filtered.length ? filtered : pool;
      return [...base].sort((a, b) => scoreCandidateForPlayback(b, clientScores) - scoreCandidateForPlayback(a, clientScores));
    };

    const best = () => {
      if (!allSources.length) return null;
      return rankAllCandidates(allSources)[0] || ordered[0] || allSources[0];
    };

    const initial = best();
    const saved = Number(localStorage.getItem(storageKey) || 0);
    const savedRawVol = Number(localStorage.getItem("cv-player-volume"));
    const savedVolume = Number.isFinite(savedRawVol) && savedRawVol > 0 ? Math.min(1, savedRawVol) : 1;
    video.volume = savedVolume;
    video.muted = false;
    video.defaultMuted = false;

    let soundBoostPct = Math.max(100, Math.min(400, Number(localStorage.getItem(BOOST_KEY) || 100)));
    let brightnessPct = Math.max(30, Math.min(180, Number(localStorage.getItem(BRIGHT_KEY) || 100)));
    let ambientMode = (() => {
      try { return localStorage.getItem(AMBIENT_KEY) !== "0"; } catch { return true; }
    })();
    let ambientLevel = (() => {
      try {
        const v = localStorage.getItem(AMBIENT_LEVEL_KEY);
        return ["soft", "cinema", "vivid"].includes(v) ? v : "cinema";
      } catch {
        return "cinema";
      }
    })();
    let preferredQuality = "auto";
    let activeSubtitleIdx = -1;
    let subtitleItems = [];
    let activeHls = null;
    let sourceToken = 0;
    let activeSource = null;
    let failedSources = new Set();
    let slowSources = new Set();
    let retriedUrls = new Set();
    let userSelectedAudio = false;
    let userMutedByToggle = false;
    let stallWatchTimer = 0;
    let stallTimestamps = [];
    let lastProgressTime = 0;
    let lastProgressAt = 0;

    // Cinema Ambient Mode backdrop behind .cv-player-stage
    const stageEl = wrap.closest(".cv-player-stage") || wrap.parentElement;
    let ambientWrap = stageEl?.closest(".cv-ambient-stage-wrap");
    if (stageEl && stageEl.parentNode && !ambientWrap) {
      ambientWrap = document.createElement("div");
      ambientWrap.className = "cv-ambient-stage-wrap";
      stageEl.parentNode.insertBefore(ambientWrap, stageEl);
      ambientWrap.appendChild(stageEl);
    }
    let ambientBackdrop = ambientWrap?.querySelector(".cv-ambient-backdrop");
    if (ambientWrap && !ambientBackdrop) {
      ambientBackdrop = document.createElement("div");
      ambientBackdrop.className = "cv-ambient-backdrop";
      ambientBackdrop.setAttribute("aria-hidden", "true");
      ambientBackdrop.innerHTML =
        '<div class="cv-ambient-poster-fallback"></div><canvas class="cv-ambient-canvas" width="48" height="27"></canvas>';
      ambientWrap.insertBefore(ambientBackdrop, ambientWrap.firstChild);
    }
    const ambientPosterFallback = ambientBackdrop?.querySelector(".cv-ambient-poster-fallback");
    const ambientCanvas = ambientBackdrop?.querySelector(".cv-ambient-canvas");
    const ambientCtx = ambientCanvas?.getContext("2d", { alpha: false }) || null;
    const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let ambientRaf = 0;
    let ambientLastTick = 0;
    let ambientHasVideoFrame = false;
    let ambientCorsTainted = false;

    function syncAmbientPoster() {
      if (!ambientPosterFallback) return;
      const posterSrc = String(video.poster || currentMeta?.poster || "").trim();
      if (posterSrc && /^(?:https?:\/\/|\/\/|\/api\/)/i.test(posterSrc)) {
        ambientPosterFallback.style.backgroundImage = `url("${posterSrc.replace(/"/g, '\\"')}")`;
      } else {
        ambientPosterFallback.style.backgroundImage =
          "radial-gradient(circle at 30% 40%, rgba(248, 113, 113, 0.36), rgba(30, 41, 59, 0.45) 60%, transparent 100%)";
      }
      if (ambientBackdrop) {
        ambientBackdrop.classList.toggle("use-poster", !ambientHasVideoFrame || ambientCorsTainted);
      }
    }

    function drawAmbientSample(forceSnap = false) {
      if (!ambientMode || !ambientBackdrop || !ambientCtx || !ambientCanvas) return;
      if (document.fullscreenElement) return;
      if (!ambientCorsTainted && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          ambientCtx.globalAlpha = forceSnap || !ambientHasVideoFrame ? 1 : 0.24;
          ambientCtx.drawImage(video, 0, 0, ambientCanvas.width, ambientCanvas.height);
          ambientCtx.globalAlpha = 1;
          ambientHasVideoFrame = true;
          ambientBackdrop.classList.remove("use-poster");
          return;
        } catch (err) {
          if (err && err.name === "SecurityError") {
            ambientCorsTainted = true;
          }
        }
      }
      syncAmbientPoster();
    }

    function stopAmbientLoop() {
      if (ambientRaf) {
        cancelAnimationFrame(ambientRaf);
        ambientRaf = 0;
      }
    }

    function scheduleAmbientLoop() {
      stopAmbientLoop();
      if (!ambientMode || !ambientBackdrop || document.hidden || document.fullscreenElement) return;
      if (video.paused || video.ended || reducedMotionQuery?.matches) {
        drawAmbientSample(true);
        return;
      }
      const step = ts => {
        if (!ambientMode || video.paused || video.ended || document.hidden || document.fullscreenElement) {
          ambientRaf = 0;
          return;
        }
        if (ts - ambientLastTick >= 95) {
          ambientLastTick = ts;
          drawAmbientSample(false);
        }
        ambientRaf = requestAnimationFrame(step);
      };
      ambientRaf = requestAnimationFrame(step);
    }

    function applyAmbientState() {
      if (!ambientBackdrop) return;
      ambientBackdrop.dataset.ambientLevel = ambientLevel;
      ambientBackdrop.classList.toggle("is-active", ambientMode && !document.fullscreenElement);
      syncAmbientPoster();
      if (ambientMode) {
        drawAmbientSample(true);
        scheduleAmbientLoop();
      } else {
        stopAmbientLoop();
      }
    }

    // Audio boost via Web Audio GainNode (safe on same-origin proxied streams)
    let audioCtx = null;
    let gainNode = null;
    function applyAudioBoost(pct) {
      soundBoostPct = Math.max(100, Math.min(400, Math.round(Number(pct) || 100)));
      try {
        localStorage.setItem(BOOST_KEY, String(soundBoostPct));
      } catch {}
      if (soundBoostPct > 100 && !audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          try {
            audioCtx = new AC();
            const srcNode = audioCtx.createMediaElementSource(video);
            gainNode = audioCtx.createGain();
            srcNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);
          } catch {
            audioCtx = null;
            gainNode = null;
          }
        }
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      if (gainNode) {
        gainNode.gain.value = soundBoostPct / 100;
      }
    }

    function applyBrightness(pct) {
      brightnessPct = Math.max(30, Math.min(180, Math.round(Number(pct) || 100)));
      try {
        localStorage.setItem(BRIGHT_KEY, String(brightnessPct));
      } catch {}
      video.style.filter = brightnessPct === 100 ? "" : `brightness(${(brightnessPct / 100).toFixed(2)})`;
    }
    applyBrightness(brightnessPct);

    // Floating OSD bar (Brightness / Sound Boost matching screenshot)
    const osdPill = document.createElement("div");
    osdPill.className = "cv-osd-pill";
    osdPill.hidden = true;
    wrap.appendChild(osdPill);
    let osdTimer = 0;
    function showOsd(icon, label, pct, minPct, maxPct, color = "#eab308") {
      const ratio = Math.max(0, Math.min(100, ((pct - minPct) / (maxPct - minPct)) * 100));
      osdPill.innerHTML = `<span class="cv-osd-icon">${icon}</span><div class="cv-osd-body"><div class="cv-osd-label">${esc(label)} ${pct}%</div><div class="cv-osd-track"><span style="width:${ratio}%;background:${color}"></span></div></div>`;
      osdPill.hidden = false;
      clearTimeout(osdTimer);
      osdTimer = setTimeout(() => {
        osdPill.hidden = true;
      }, 1500);
    }

    // Muted-autoplay unmute prompt
    const unmuteBtn = document.createElement("button");
    unmuteBtn.type = "button";
    unmuteBtn.className = "cv-unmute-float";
    unmuteBtn.hidden = true;
    unmuteBtn.textContent = "🔇 Tap to enable audio";
    wrap.appendChild(unmuteBtn);
    unmuteBtn.addEventListener("click", () => {
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
      unmuteBtn.hidden = true;
      syncSound();
    });

    const topbar = document.createElement("div");
    topbar.className = "cv-topbar";
    topbar.innerHTML =
      '<a class="cv-back-link" href="' +
      esc(backUrl) +
      '" aria-label="Back">‹</a><strong class="cv-title">' +
      esc(title) +
      '</strong><div class="cv-top-right"></div>';
    wrap.appendChild(topbar);

    const controls = document.createElement("div");
    controls.className = "cv-controls";
    const qualityOptions = [
      '<option value="auto">Auto</option>',
      ...ordered.map(x => '<option value="' + esc(x.quality) + '">' + esc(x.quality) + "</option>")
    ].join("");
    controls.innerHTML =
      '<div class="cv-progress"><input class="cv-seek" type="range" min="0" max="1000" value="0" aria-label="Seek"></div><div class="cv-control-row"><button type="button" class="cv-play" aria-label="Play">▶</button><button type="button" class="cv-back" aria-label="Back 10 seconds">↶10</button><button type="button" class="cv-forward" aria-label="Forward 10 seconds">10↷</button><span class="cv-time tabular-nums">0:00 / 0:00</span><button type="button" class="cv-mute" aria-label="Mute sound" title="Mute / Unmute">🔊</button><input class="cv-volume" type="range" min="0" max="1" step=".05" value="1" aria-label="Volume"><select class="cv-quality" aria-label="Quality">' +
      qualityOptions +
      '</select><select class="cv-speed" aria-label="Playback speed"><option value="0.5">0.5</option><option value="0.75">0.75</option><option value="1" selected>1</option><option value="1.25">1.25</option><option value="1.5">1.5</option><option value="2">2</option></select><select class="cv-subtitles" aria-label="Subtitles"><option value="-1">CC: Off</option></select><button type="button" class="cv-settings" aria-label="Player settings" title="Settings">⚙</button><button type="button" class="cv-pip" title="Picture in Picture" aria-label="Picture in Picture">▣</button><button type="button" class="cv-full" title="Fullscreen" aria-label="Fullscreen">⛶</button></div><div class="cv-buffer" hidden>Buffering…</div>';
    wrap.appendChild(controls);

    const topRight = topbar.querySelector(".cv-top-right");
    const lockButton = document.createElement("button");
    lockButton.type = "button";
    lockButton.className = "cv-lock";
    lockButton.textContent = "🔒";
    lockButton.setAttribute("aria-label", "Lock controls");
    wrap.appendChild(lockButton);

    const settingsButton = controls.querySelector(".cv-settings");
    const settingsPanel = document.createElement("div");
    settingsPanel.className = "cv-settings-panel";
    settingsPanel.innerHTML = "<span>Playback speed</span>";
    const speedSelect = controls.querySelector(".cv-speed");
    settingsPanel.appendChild(speedSelect);
    wrap.appendChild(settingsPanel);

    settingsButton.addEventListener("click", () => {
      if (typeof onOpenSettings === "function") {
        hideControls();
        onOpenSettings();
      } else {
        settingsPanel.classList.toggle("open");
        if (settingsPanel.classList.contains("open")) {
          clearTimeout(hideTimer);
        } else {
          scheduleHide();
        }
      }
    });

    let locked = false;
    lockButton.addEventListener("click", () => {
      locked = !locked;
      wrap.classList.toggle("cv-locked", locked);
      lockButton.textContent = locked ? "🔓" : "🔒";
      lockButton.setAttribute("aria-label", locked ? "Unlock controls" : "Lock controls");
      revealControls();
    });

    const centerPlay = document.createElement("button");
    centerPlay.type = "button";
    centerPlay.className = "cv-center-play";
    centerPlay.setAttribute("aria-label", "Play video");
    centerPlay.innerHTML = "<span>▶</span>";
    wrap.appendChild(centerPlay);

    const skipHint = document.createElement("div");
    skipHint.className = "cv-skip-hint";
    skipHint.setAttribute("aria-live", "polite");
    wrap.appendChild(skipHint);

    const skipControls = document.createElement("div");
    skipControls.className = "cv-mid-skip";
    skipControls.innerHTML =
      '<button type="button" class="cv-mid-back" aria-label="Rewind 10 seconds"><span>↶</span><small>10</small></button><button type="button" class="cv-mid-forward" aria-label="Forward 10 seconds"><span>↷</span><small>10</small></button>';
    wrap.appendChild(skipControls);

    const $ = s => controls.querySelector(s);
    const play = $(".cv-play");
    const seek = $(".cv-seek");
    const time = $(".cv-time");
    const quality = controls.querySelector(".cv-quality");
    const subs = controls.querySelector(".cv-subtitles");
    const volume = $(".cv-volume");
    const mute = $(".cv-mute");
    volume.value = String(video.volume);

    const ambientTopBtn = document.createElement("button");
    ambientTopBtn.type = "button";
    ambientTopBtn.className = "cv-top-pill cv-ambient-top-btn";
    ambientTopBtn.setAttribute("aria-label", "Toggle Ambient Mode");
    ambientTopBtn.title = "Ambient Mode";
    ambientTopBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M8 2v2M16 2v2M8 20v2M16 20v2M1 12h1.5M21.5 12H23"/></svg>';

    const qualBtn = document.createElement("button");
    qualBtn.type = "button";
    qualBtn.className = "cv-top-pill cv-qual-btn";
    qualBtn.setAttribute("aria-label", "Video quality");
    qualBtn.textContent = "Auto ▾";

    const subsBtn = document.createElement("button");
    subsBtn.type = "button";
    subsBtn.className = "cv-top-pill cv-subs-btn";
    subsBtn.setAttribute("aria-label", "Subtitles");
    subsBtn.textContent = "CC: Off ▾";

    const topMenu = document.createElement("div");
    topMenu.className = "cv-top-menu";
    topMenu.hidden = true;
    wrap.appendChild(topMenu);

    let openTopMenuType = "";
    function closeTopMenu() {
      openTopMenuType = "";
      topMenu.hidden = true;
      topMenu.innerHTML = "";
    }

    function syncTopButtons() {
      const isSaver = playbackMode === "data-saver";
      const qText = preferredQuality === "auto"
        ? (isSaver ? `Saver${activeSource?.quality ? ` · ${activeSource.quality}` : ""}` : `Auto${activeSource?.quality ? ` (${activeSource.quality})` : ""}`)
        : (isSaver ? `${preferredQuality} · Saver` : preferredQuality);
      qualBtn.textContent = `${qText} ▾`;
      qualBtn.classList.toggle("active", isSaver);
      const activeSub = activeSubtitleIdx >= 0 ? subtitleItems[activeSubtitleIdx] : null;
      subsBtn.textContent = activeSub ? `CC: ${activeSub.label} ▾` : "CC: Off ▾";
      ambientTopBtn.classList.toggle("active", ambientMode);
      ambientTopBtn.setAttribute("aria-pressed", ambientMode ? "true" : "false");
      ambientTopBtn.title = ambientMode ? "Ambient Mode: ON" : "Ambient Mode: OFF";
    }

    function openTopMenu(type) {
      if (openTopMenuType === type && !topMenu.hidden) {
        closeTopMenu();
        scheduleHide(1200);
        return;
      }
      openTopMenuType = type;
      clearTimeout(hideTimer);
      wrap.classList.add("cv-ui-visible");
      if (type === "quality") {
        const isSaver = playbackMode === "data-saver";
        const items = [
          { value: "auto", label: `Auto${activeSource?.quality ? ` (${activeSource.quality})` : ""}`, active: preferredQuality === "auto" },
          ...ordered.map(x => ({ value: x.quality, label: x.quality, active: preferredQuality === x.quality }))
        ];
        topMenu.innerHTML =
          `<div class="cv-top-menu-head">Playback Mode</div>` +
          `<button type="button" class="cv-top-menu-item ${isSaver ? "active" : ""}" data-pick-playback-mode="data-saver"><span>⚡ Data Saver (≤480p)</span>${isSaver ? "<b>✓</b>" : ""}</button>` +
          `<button type="button" class="cv-top-menu-item ${!isSaver ? "active" : ""}" data-pick-playback-mode="high-quality"><span>✨ High Quality</span>${!isSaver ? "<b>✓</b>" : ""}</button>` +
          `<div class="cv-top-menu-head" style="margin-top:4px">Quality</div>` +
          items.map(
            it => `<button type="button" class="cv-top-menu-item ${it.active ? "active" : ""}" data-pick-quality="${esc(it.value)}"><span>${esc(it.label)}</span>${it.active ? "<b>✓</b>" : ""}</button>`
          ).join("");
      } else {
        const items = [
          { value: -1, label: "Off", active: activeSubtitleIdx < 0 },
          ...subtitleItems.map(s => ({ value: s.index, label: s.label, active: activeSubtitleIdx === s.index }))
        ];
        topMenu.innerHTML = `<div class="cv-top-menu-head">Subtitles</div>` + (
          items.length > 1
            ? items.map(it => `<button type="button" class="cv-top-menu-item ${it.active ? "active" : ""}" data-pick-sub="${it.value}"><span>${esc(it.label)}</span>${it.active ? "<b>✓</b>" : ""}</button>`).join("")
            : `<button type="button" class="cv-top-menu-item active" data-pick-sub="-1"><span>Off (No tracks)</span><b>✓</b></button>`
        );
      }
      topMenu.hidden = false;
    }

    ambientTopBtn.addEventListener("click", e => {
      e.stopPropagation();
      toggleAmbientMode();
      scheduleHide(1200);
    });
    qualBtn.addEventListener("click", e => {
      e.stopPropagation();
      openTopMenu("quality");
    });
    subsBtn.addEventListener("click", e => {
      e.stopPropagation();
      openTopMenu("subs");
    });
    topMenu.addEventListener("click", e => {
      e.stopPropagation();
      const modePick = e.target.closest("[data-pick-playback-mode]");
      if (modePick) {
        setPlaybackMode(modePick.dataset.pickPlaybackMode);
        closeTopMenu();
        scheduleHide(1200);
        return;
      }
      const qPick = e.target.closest("[data-pick-quality]");
      if (qPick) {
        selectQuality(qPick.dataset.pickQuality);
        closeTopMenu();
        scheduleHide(1200);
        return;
      }
      const sPick = e.target.closest("[data-pick-sub]");
      if (sPick) {
        applyTrackSelection(Number(sPick.dataset.pickSub));
        closeTopMenu();
        scheduleHide(1200);
      }
    });

    function syncSound() {
      const silent = video.muted || video.volume === 0;
      mute.textContent = silent ? "🔇" : "🔊";
      mute.setAttribute("aria-label", silent ? "Turn sound on" : "Mute sound");
      mute.title = silent ? "Turn sound on" : "Mute sound";
      if (!silent) unmuteBtn.hidden = true;
    }
    syncSound();
    topRight.append(ambientTopBtn, qualBtn, subsBtn);
    syncTopButtons();
    applyAmbientState();

    function emitState() {
      syncTopButtons();
      if (typeof onStateChange === "function") {
        onStateChange(getState());
      }
    }

    const AUTO_HIDE_MS = 1700;
    let hideTimer = 0;
    let isDraggingControl = false;
    let activeSelect = false;
    let hasShownInitial = false;
    let uiVisibleAtPointerDown = false;
    let suppressNextVideoClick = false;
    let lastMouseMoveAt = 0;

    function blurFocusedControl() {
      const active = document.activeElement;
      if (active && active !== document.body && wrap.contains(active) && active !== wrap) {
        try {
          active.blur();
        } catch {}
      }
    }

    function hideControls() {
      clearTimeout(hideTimer);
      wrap.classList.remove("cv-ui-visible");
      settingsPanel.classList.remove("open");
      closeTopMenu();
      activeSelect = false;
      blurFocusedControl();
    }

    function scheduleHide(delay = AUTO_HIDE_MS) {
      clearTimeout(hideTimer);
      if (isDraggingControl || activeSelect || settingsPanel.classList.contains("open") || !topMenu.hidden) return;
      if (!video.paused && !video.ended) {
        hideTimer = setTimeout(() => {
          hideControls();
        }, delay);
      }
    }

    function revealControls(delay = AUTO_HIDE_MS) {
      wrap.classList.add("cv-ui-visible");
      scheduleHide(delay);
    }

    function showSkip(delta) {
      skipHint.textContent = delta < 0 ? "−10 seconds" : "＋10 seconds";
      skipHint.classList.add("show");
      clearTimeout(showSkip.timer);
      showSkip.timer = setTimeout(() => skipHint.classList.remove("show"), 650);
    }

    const fmt = t => {
      if (!Number.isFinite(t)) return "0:00";
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const s = Math.floor(t % 60);
      return h
        ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
        : m + ":" + String(s).padStart(2, "0");
    };

    const errorNotice = document.createElement("div");
    errorNotice.className = "cv-player-error";
    errorNotice.hidden = true;
    errorNotice.setAttribute("role", "status");
    errorNotice.style.cssText =
      "position:absolute;z-index:16;left:8%;right:8%;top:50%;transform:translateY(-50%);padding:14px 18px;border-radius:12px;background:rgba(12,18,30,.95);border:1px solid rgba(255,255,255,.16);color:#fff;text-align:center;font:600 14px/1.5 system-ui;";
    wrap.appendChild(errorNotice);

    async function handleMediaError() {
      const failed = activeSource;
      const token = sourceToken;
      if (!failed || !video.getAttribute("src")) return;
      const code = video.error?.code || 0;
      const message = video.error?.message || "";
      let probeInfo = null;
      try {
        const pr = await fetch(failed.url, { headers: { Range: "bytes=0-1023" }, credentials: "same-origin", cache: "no-store" });
        if (token !== sourceToken) return;
        probeInfo = { status: pr.status, contentType: pr.headers.get("content-type") || "", redirected: pr.redirected };
        if ((pr.status >= 500 || pr.status === 429) && !retriedUrls.has(failed.url)) {
          retriedUrls.add(failed.url);
          const sep = failed.url.includes("?") ? "&" : "?";
          const retrySrc = { ...failed, url: failed.url + sep + "_r=" + Date.now() };
          setTimeout(() => {
            if (token === sourceToken) setSource(retrySrc, false, true);
          }, 600);
          return;
        }
      } catch (e) {
        probeInfo = { fetchError: e?.message || "network error" };
      }
      if (token !== sourceToken) return;
      failedSources.add(failed.url);
      writeClientServerScore(sourceServerKey(failed.url), 9999, false);
      const exclude = new Set([...failedSources, ...slowSources]);
      let remaining = rankAllCandidates(allSources, exclude);
      if (!remaining.length) remaining = rankAllCandidates(allSources, failedSources);
      const sameQ = remaining.find(x => x.quality === failed.quality);
      const next = sameQ || remaining[0];
      if (next) {
        console.warn("Video source failed; switching to fastest backup server", { quality: failed.quality, code, probeInfo });
        setSource(next, true, true);
        return;
      }
      const isHtmlAuth = probeInfo && /text\/html/i.test(String(probeInfo.contentType || ""));
      const msg = isHtmlAuth
        ? "ব্রাউজার সেশন বা কুকি অনুমোদনের কারণে ভিডিও স্ট্রিম লোড হয়নি। পেজটি রিলোড করুন বা নতুন ট্যাবে ওপেন করুন।"
        : code === 4
          ? "এই ভিডিওটি বর্তমানে লোড করা যায়নি। নিচের Retry বাটনে ক্লিক করে আবার চেষ্টা করুন।"
          : "ভিডিও লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
      errorNotice.innerHTML =
        "<div>" +
        esc(msg) +
        '</div><button type="button" style="margin-top:10px;padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:#e50914;color:#fff;font-weight:700;cursor:pointer">↻ Retry Stream</button>';
      errorNotice.querySelector("button")?.addEventListener("click", () => {
        errorNotice.hidden = true;
        failedSources.clear();
        retriedUrls.clear();
        if (typeof onRetryStream === "function") {
          onRetryStream();
        } else {
          setSource(best() || ordered[0], false, true);
        }
      });
      errorNotice.hidden = false;
      console.error("All video sources failed", { code, message, networkState: video.networkState, readyState: video.readyState, probeInfo });
    }
    video.addEventListener("error", () => {
      handleMediaError();
    });

    function loadHlsLibrary() {
      if (window.Hls) return Promise.resolve(window.Hls);
      if (window.__odHlsPromise) return window.__odHlsPromise;
      window.__odHlsPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js";
        script.onload = () => resolve(window.Hls);
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return window.__odHlsPromise;
    }

    const isHindiTrack = track => {
      const lang = String(track?.lang || track?.language || "").trim();
      const name = String(track?.name || track?.label || "").trim();
      return /^(?:hi|hin)$/i.test(lang) || /hindi|हिन्दी|हिंदी/i.test(`${name} ${lang}`);
    };

    function autoSelectHindiAudio() {
      if (userSelectedAudio) return;
      if (activeHls && Array.isArray(activeHls.audioTracks) && activeHls.audioTracks.length > 0) {
        const idx = activeHls.audioTracks.findIndex(isHindiTrack);
        if (idx >= 0 && activeHls.audioTrack !== idx) {
          activeHls.audioTrack = idx;
        }
      }
      if (video.audioTracks && video.audioTracks.length > 1) {
        let hindiIdx = -1;
        for (let i = 0; i < video.audioTracks.length; i++) {
          if (isHindiTrack(video.audioTracks[i])) {
            hindiIdx = i;
            break;
          }
        }
        if (hindiIdx >= 0) {
          for (let i = 0; i < video.audioTracks.length; i++) {
            video.audioTracks[i].enabled = i === hindiIdx;
          }
        }
      }
    }

    async function safePlayWithFallback() {
      if (!userMutedByToggle) {
        video.muted = false;
        if (video.volume === 0) {
          video.volume = 1;
          volume.value = "1";
        }
      }
      try {
        await video.play();
        unmuteBtn.hidden = true;
        syncSound();
      } catch (err) {
        if (err && err.name === "NotAllowedError") {
          // Never mute by default; show prominent Play button so a tap starts unmuted audio immediately
          video.muted = false;
          syncSound();
          centerPlay.innerHTML = "<span>▶</span>";
          centerPlay.setAttribute("aria-label", "Play video with sound");
          centerPlay.classList.add("visible");
          wrap.classList.add("cv-ui-visible");
        }
      }
    }

    function applyTrackSelection(idx) {
      const targetIdx = Number.isFinite(idx) ? idx : -1;
      activeSubtitleIdx = targetIdx;
      const tracks = [...video.textTracks];
      tracks.forEach((track, i) => {
        track.mode = i === targetIdx ? "showing" : "disabled";
      });
      if (subs) {
        subs.value = targetIdx >= 0 && targetIdx < tracks.length ? String(targetIdx) : "-1";
      }
      if (targetIdx >= 0 && tracks[targetIdx]) {
        const track = tracks[targetIdx];
        track.mode = "showing";
        const el = video.querySelectorAll("track")[targetIdx];
        if (el) {
          el.default = true;
          el.addEventListener(
            "load",
            () => {
              if (activeSubtitleIdx === targetIdx) track.mode = "showing";
            },
            { once: true }
          );
        }
      }
      emitState();
    }

    function applyHlsPlaybackProfile(hlsInstance) {
      if (!hlsInstance) return;
      const isSaver = playbackMode === "data-saver";
      if (hlsInstance.config) {
        hlsInstance.config.maxBufferLength = isSaver ? 10 : 40;
        hlsInstance.config.maxMaxBufferLength = isSaver ? 18 : 90;
        hlsInstance.config.backBufferLength = isSaver ? 30 : 90;
        hlsInstance.config.capLevelToPlayerSize = isSaver;
      }
      if (Array.isArray(hlsInstance.levels) && hlsInstance.levels.length > 0) {
        if (isSaver) {
          let capIdx = -1;
          for (let i = 0; i < hlsInstance.levels.length; i++) {
            const h = Number(hlsInstance.levels[i]?.height || 0);
            if (h > 0 && h <= 480) capIdx = i;
          }
          if (capIdx < 0) {
            let minIdx = 0;
            let minBitrate = Number(hlsInstance.levels[0]?.bitrate || Infinity);
            for (let i = 1; i < hlsInstance.levels.length; i++) {
              const br = Number(hlsInstance.levels[i]?.bitrate || Infinity);
              if (br < minBitrate) {
                minBitrate = br;
                minIdx = i;
              }
            }
            capIdx = minIdx;
          }
          hlsInstance.autoLevelCapping = capIdx;
          if (hlsInstance.currentLevel > capIdx || hlsInstance.nextLevel > capIdx) {
            hlsInstance.nextLevel = capIdx;
          }
        } else {
          hlsInstance.autoLevelCapping = -1;
        }
      }
    }

    async function raceFastestServerSource(candidates, fallbackSrc) {
      if (!Array.isArray(candidates) || candidates.length < 2 || playbackMode === "data-saver") {
        return fallbackSrc || candidates?.[0] || null;
      }
      const pool = candidates.slice(0, 3);
      const clientScores = readClientServerScores();
      const firstScore = clientScores[sourceServerKey(pool[0].url)];
      if ((firstScore && firstScore.ok && firstScore.latencyMs <= 320) || (pool[0]?.serverOk && Number(pool[0]?.serverLatencyMs || 999) <= 280)) {
        return pool[0];
      }
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 750);
      try {
        const probes = pool.map(src => {
          const isHls = isHlsSource(src);
          const t0 = performance.now();
          const hdrs = isHls ? {} : { Range: "bytes=0-16383" };
          return fetch(src.url, { method: "GET", headers: hdrs, credentials: "same-origin", signal: ac.signal })
            .then(async r => {
              const ms = Math.max(1, Math.round(performance.now() - t0));
              try { await r.body?.cancel(); } catch {}
              const ok = r.ok || r.status === 206;
              writeClientServerScore(sourceServerKey(src.url), ok ? ms : 9999, ok);
              if (!ok) throw new Error("not ok");
              return { src, ms };
            });
        });
        const fastest = await Promise.any(probes);
        clearTimeout(timeout);
        ac.abort();
        return fastest?.src || fallbackSrc || pool[0];
      } catch {
        clearTimeout(timeout);
        return fallbackSrc || pool[0];
      }
    }

    function switchToFasterServer(reason = "buffering") {
      if (!allSources.length || !activeSource) return false;
      if (activeHls && Array.isArray(activeHls.levels) && activeHls.levels.length > 1) {
        const curLvl = activeHls.currentLevel >= 0 ? activeHls.currentLevel : activeHls.levels.length - 1;
        if (curLvl > 0) {
          activeHls.nextLevel = curLvl - 1;
          showOsd("⚡", "Adjusting Quality", Math.max(25, Math.round(((curLvl) / activeHls.levels.length) * 100)), 0, 100, "#38bdf8");
          return true;
        }
      }
      slowSources.add(activeSource.url);
      writeClientServerScore(sourceServerKey(activeSource.url), 4500, true);
      const exclude = new Set([...failedSources, ...slowSources]);
      const candidates = rankAllCandidates(allSources, exclude);
      const next = candidates.find(x => x.url !== activeSource.url);
      if (!next) return false;
      console.warn(`Auto-switching to faster server (${reason})`, { from: activeSource.quality, to: next.quality, provider: next.provider });
      showOsd("⚡", "Fast Server", 100, 0, 100, "#10b981");
      setSource(next, true, !video.paused, video.currentTime || 0);
      return true;
    }

    async function setSource(src, keep = true, autoplay = false, seekOverride = null) {
      const token = ++sourceToken;
      const t = seekOverride != null ? Math.max(0, Number(seekOverride) || 0) : keep ? video.currentTime : 0;
      const was = !video.paused;
      errorNotice.hidden = true;
      clearTimeout(pauseStopTimer);
      activeHlsStopped = false;
      if (activeHls) {
        activeHls.destroy();
        activeHls = null;
      }
      video.pause();
      activeSource = src;
      userSelectedAudio = false;
      if (!userMutedByToggle) {
        video.muted = false;
        if (video.volume === 0) {
          video.volume = 1;
          volume.value = "1";
        }
      }
      quality.value = preferredQuality === "auto" ? "auto" : src.quality || "auto";
      emitState();

      const isHls =
        /\.m3u8(?:$|[?#])/i.test(src.url) ||
        /\/api\/(?:sports-hls|mlbd-hls)\//i.test(src.url) ||
        /mpegurl|m3u8|hls/i.test(String(src.mime || src.type || ""));

      const ready = () => {
        if (token !== sourceToken) return;
        applyHlsPlaybackProfile(activeHls);
        if (t > 0 && Number.isFinite(video.duration)) {
          video.currentTime = Math.min(t, Math.max(0, video.duration - 2));
        }
        autoSelectHindiAudio();
        if (activeSubtitleIdx >= 0) {
          applyTrackSelection(activeSubtitleIdx);
        }
        emitState();
        if (was || autoplay) safePlayWithFallback();
      };

      clearTimeout(stallWatchTimer);
      lastProgressTime = video.currentTime || 0;
      lastProgressAt = Date.now();

      if (isHls) {
        const ua = navigator.userAgent || "";
        const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/i.test(ua);
        if (!isSafari) {
          try {
            const Hls = await loadHlsLibrary();
            if (token !== sourceToken) return;
            if (Hls && Hls.isSupported()) {
              const isSaver = playbackMode === "data-saver";
              activeHls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                startLevel: -1,
                maxBufferLength: isSaver ? 10 : 40,
                maxMaxBufferLength: isSaver ? 18 : 90,
                maxBufferHole: 0.5,
                backBufferLength: isSaver ? 30 : 90,
                capLevelToPlayerSize: isSaver,
                nudgeMaxRetry: 5,
                fragLoadingTimeOut: 12000,
                manifestLoadingTimeOut: 10000,
                abrEwmaDefaultEstimate: isSaver ? 400000 : 2500000
              });
              activeHls.on(Hls.Events.MEDIA_ATTACHED, () => {
                if (token === sourceToken) activeHls.loadSource(src.url);
              });
              activeHls.on(Hls.Events.MANIFEST_PARSED, ready);
              activeHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
                if (token === sourceToken) {
                  autoSelectHindiAudio();
                  emitState();
                }
              });
              activeHls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
                if (token === sourceToken) emitState();
              });
              activeHls.on(Hls.Events.ERROR, (_, data) => {
                if (token !== sourceToken) return;
                if (!data.fatal && (data.details === "bufferStalledError" || data.details === "fragLoadTimeOut" || data.details === "fragLoadError")) {
                  if (activeHls && activeHls.currentLevel > 0) {
                    activeHls.nextLevel = activeHls.currentLevel - 1;
                  }
                  return;
                }
                if (data.fatal) {
                  $(".cv-buffer").hidden = true;
                  video.dispatchEvent(new Event("error"));
                }
              });
              activeHls.attachMedia(video);
              return;
            }
          } catch (e) {
            console.warn("hls.js unavailable; trying native HLS", e);
          }
        }
      }

      video.preload = playbackMode === "data-saver" ? "metadata" : "auto";
      video.src = isHls ? src.url : applySaverUrlFlag(src.url);
      video.addEventListener("loadedmetadata", ready, { once: true });
      if (autoplay) {
        safePlayWithFallback();
      }
    }

    if (initial) {
      if (allSources.length > 1 && playbackMode !== "data-saver") {
        const mountTok = ++sourceToken;
        raceFastestServerSource(rankAllCandidates(allSources), initial).then(win => {
          if (mountTok === sourceToken && !activeSource) {
            setSource(win || initial, false, true);
          }
        });
      } else {
        setSource(initial, false, true);
      }
    }
    quality.value = "auto";

    quality.addEventListener("change", () => {
      preferredQuality = quality.value;
      activeSelect = false;
      const src = quality.value === "auto" ? best() : ordered.find(x => x.quality === quality.value);
      if (src) setSource(src, true, true);
      emitState();
      scheduleHide(1200);
    });

    [quality, subs, speedSelect].forEach(sel => {
      if (!sel) return;
      sel.addEventListener("focus", () => {
        activeSelect = true;
        clearTimeout(hideTimer);
      });
      sel.addEventListener("blur", () => {
        activeSelect = false;
        scheduleHide(1200);
      });
    });

    [seek, volume].forEach(rangeEl => {
      if (!rangeEl) return;
      const startDrag = () => {
        isDraggingControl = true;
        clearTimeout(hideTimer);
      };
      const endDrag = () => {
        if (!isDraggingControl) return;
        isDraggingControl = false;
        scheduleHide();
      };
      rangeEl.addEventListener("pointerdown", startDrag, { passive: true });
      rangeEl.addEventListener("touchstart", startDrag, { passive: true });
      rangeEl.addEventListener("pointerup", endDrag, { passive: true });
      rangeEl.addEventListener("touchend", endDrag, { passive: true });
      rangeEl.addEventListener("change", () => {
        isDraggingControl = false;
        scheduleHide();
      });
    });

    window.addEventListener("pointerup", () => {
      if (isDraggingControl) {
        isDraggingControl = false;
        scheduleHide();
      }
    });

    play.addEventListener("click", () => {
      if (video.paused) safePlayWithFallback();
      else video.pause();
    });
    centerPlay.addEventListener("click", () => {
      if (video.paused) safePlayWithFallback();
      else video.pause();
    });

    wrap.addEventListener(
      "pointerdown",
      e => {
        uiVisibleAtPointerDown = wrap.classList.contains("cv-ui-visible");
        if (e.target !== video && !locked && e.target !== wrap) {
          clearTimeout(hideTimer);
        }
      },
      { passive: true }
    );

    wrap.addEventListener("click", e => {
      if (locked && e.target !== lockButton && !lockButton.contains(e.target)) {
        if (uiVisibleAtPointerDown) hideControls();
        else revealControls();
        return;
      }
      if (e.target === wrap) {
        if (uiVisibleAtPointerDown) hideControls();
        else revealControls();
      }
    });

    video.addEventListener("click", () => {
      if (!topMenu.hidden) {
        closeTopMenu();
        scheduleHide(1200);
        return;
      }
      if (suppressNextVideoClick) {
        suppressNextVideoClick = false;
        return;
      }
      if (locked) {
        if (uiVisibleAtPointerDown) hideControls();
        else revealControls();
        return;
      }
      if (video.paused) {
        safePlayWithFallback();
        return;
      }
      if (uiVisibleAtPointerDown) {
        hideControls();
      } else {
        revealControls();
      }
    });

    video.addEventListener("play", () => {
      clearTimeout(pauseStopTimer);
      if (activeHls && activeHlsStopped) {
        activeHlsStopped = false;
        try { activeHls.startLoad(); } catch {}
      }
      if (soundBoostPct > 100) applyAudioBoost(soundBoostPct);
      wrap.classList.remove("cv-ended");
      play.textContent = "Ⅱ";
      centerPlay.innerHTML = '<span style="margin-left:0;letter-spacing:-1px">❚❚</span>';
      centerPlay.setAttribute("aria-label", "Pause video");
      centerPlay.classList.remove("visible");
      wrap.classList.add("cv-playing");
      scheduleAmbientLoop();
      if (!hasShownInitial) {
        hasShownInitial = true;
        hideControls();
      } else if (wrap.classList.contains("cv-ui-visible")) {
        scheduleHide(1200);
      }
    });
    video.addEventListener("pause", () => {
      play.textContent = "▶";
      centerPlay.innerHTML = "<span>▶</span>";
      centerPlay.setAttribute("aria-label", "Play video");
      centerPlay.classList.add("visible");
      wrap.classList.remove("cv-playing");
      stopAmbientLoop();
      clearTimeout(hideTimer);
      wrap.classList.add("cv-ui-visible");
      clearTimeout(pauseStopTimer);
      if (activeHls && playbackMode === "data-saver") {
        pauseStopTimer = setTimeout(() => {
          if (video.paused && activeHls && playbackMode === "data-saver") {
            activeHlsStopped = true;
            try { activeHls.stopLoad(); } catch {}
          }
        }, 3500);
      }
    });

    wrap.addEventListener(
      "pointermove",
      e => {
        if (e.pointerType === "touch") return;
        const now = Date.now();
        if (now - lastMouseMoveAt < 180) return;
        lastMouseMoveAt = now;
        revealControls();
      },
      { passive: true }
    );
    wrap.addEventListener("mouseleave", () => {
      if (!video.paused && !isDraggingControl && !activeSelect) hideControls();
    });
    video.addEventListener("ended", () => {
      centerPlay.classList.add("visible");
      wrap.classList.add("cv-ui-visible");
      wrap.classList.add("cv-ended");
      stopAmbientLoop();
      clearTimeout(hideTimer);
    });
    video.addEventListener("loadeddata", () => drawAmbientSample(true));
    video.addEventListener("seeked", () => drawAmbientSample(true));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAmbientLoop();
        if (activeHls && playbackMode === "data-saver" && video.paused) {
          activeHlsStopped = true;
          try { activeHls.stopLoad(); } catch {}
        }
      } else {
        scheduleAmbientLoop();
      }
    });

    const jump = delta => {
      video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
      showSkip(delta);
      revealControls();
    };
    $(".cv-back").addEventListener("click", () => jump(-10));
    $(".cv-forward").addEventListener("click", () => jump(10));
    skipControls.querySelector(".cv-mid-back").addEventListener("click", () => jump(-10));
    skipControls.querySelector(".cv-mid-forward").addEventListener("click", () => jump(10));

    let saveAt = 0;
    video.addEventListener("timeupdate", () => {
      if (Math.abs(video.currentTime - lastProgressTime) > 0.25) {
        lastProgressTime = video.currentTime;
        lastProgressAt = Date.now();
        clearTimeout(stallWatchTimer);
        if (stallTimestamps.length && Date.now() - stallTimestamps[stallTimestamps.length - 1] > 15000) {
          stallTimestamps = [];
        }
      }
      if (video.duration) {
        seek.value = Math.round((video.currentTime / video.duration) * 1000);
        time.textContent = fmt(video.currentTime) + " / " + fmt(video.duration);
      }
      if (video.currentTime - saveAt > 6) {
        saveAt = video.currentTime;
        localStorage.setItem(storageKey, String(Math.floor(saveAt)));
        saveHistoryEntry(currentMeta, video.currentTime, video.duration);
      }
    });

    seek.addEventListener("input", () => {
      if (video.duration) video.currentTime = (Number(seek.value) / 1000) * video.duration;
      revealControls();
    });

    volume.addEventListener("input", e => {
      video.volume = Number(e.target.value);
      video.muted = false;
      userMutedByToggle = false;
      localStorage.setItem("cv-player-volume", String(video.volume));
      syncSound();
      revealControls();
    });

    mute.addEventListener("click", () => {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        userMutedByToggle = false;
        if (video.volume === 0) {
          video.volume = Math.max(0.5, Number(localStorage.getItem("cv-player-volume") || 1));
          volume.value = String(video.volume);
        }
      } else {
        video.muted = true;
        userMutedByToggle = true;
      }
      syncSound();
      revealControls();
    });
    video.addEventListener("volumechange", syncSound);

    speedSelect.addEventListener("change", e => {
      video.playbackRate = Number(e.target.value) || 1;
      activeSelect = false;
      emitState();
      scheduleHide(1200);
    });

    async function enterFullscreen() {
      try {
        if (!document.fullscreenElement) {
          if (wrap.requestFullscreen) await wrap.requestFullscreen();
          else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
            return;
          }
        }
        if (screen.orientation?.lock) {
          try {
            await screen.orientation.lock("landscape");
          } catch {}
        }
      } catch (e) {
        console.warn("Fullscreen unavailable", e);
      }
    }

    async function exitFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {}
      try {
        screen.orientation?.unlock?.();
      } catch {}
    }

    $(".cv-full").addEventListener("click", () => (document.fullscreenElement ? exitFullscreen() : enterFullscreen()));
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement === wrap) {
        if (screen.orientation?.lock) screen.orientation.lock("landscape").catch(() => {});
      } else {
        try {
          screen.orientation?.unlock?.();
        } catch {}
      }
      applyAmbientState();
    });

    $(".cv-pip").addEventListener("click", async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {}
    });

    async function setSubtitles(list = []) {
      video.querySelectorAll("track[data-cv-dynamic-subtitle]").forEach(t => t.remove());
      subs.innerHTML = '<option value="-1">CC: Off</option>';
      subtitleItems = [];
      activeSubtitleIdx = -1;

      const valid = (Array.isArray(list) ? list : []).filter(t => t?.url);
      for (let i = 0; i < valid.length; i++) {
        const t = valid[i];
        let src = String(t.url);
        const isDirectVtt = /\.vtt(?:$|[?#])/i.test(src) || /vtt=1/i.test(src);
        if (!isDirectVtt && /\.srt(?:$|[?#])/i.test(src)) {
          try {
            const r = await fetch(src, { cache: "default" });
            if (!r.ok) continue;
            src = URL.createObjectURL(new Blob([srtToVtt(await r.text())], { type: "text/vtt" }));
          } catch {
            continue;
          }
        }
        const el = document.createElement("track");
        el.kind = "subtitles";
        el.label = t.label || t.language || "Subtitle " + (i + 1);
        el.srclang = String(t.language || "und").slice(0, 2);
        el.src = src;
        el.dataset.cvDynamicSubtitle = "1";
        video.appendChild(el);
        subtitleItems.push({ index: subtitleItems.length, label: el.label, language: String(t.language || "und"), url: src });
      }

      const domTracks = [...video.querySelectorAll("track")];
      domTracks.forEach((el, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = el.label || el.srclang || "Subtitle " + (i + 1);
        subs.appendChild(o);
      });
      applyTrackSelection(-1);
    }

    setSubtitles(subtitles);
    subs.addEventListener("change", () => {
      activeSelect = false;
      applyTrackSelection(Number(subs.value));
      scheduleHide(1200);
    });

    const onBufferingEvent = () => {
      $(".cv-buffer").hidden = false;
      if (video.paused || video.ended || !activeSource) return;
      const now = Date.now();
      stallTimestamps = stallTimestamps.filter(ts => now - ts < 25000);
      stallTimestamps.push(now);
      if (stallTimestamps.length >= 3 && allSources.length > 1) {
        stallTimestamps = [];
        if (switchToFasterServer("frequent-buffering")) return;
      }
      clearTimeout(stallWatchTimer);
      const snapshotPos = video.currentTime;
      const curTok = sourceToken;
      stallWatchTimer = setTimeout(() => {
        if (curTok !== sourceToken || video.paused || video.ended) return;
        if (Math.abs(video.currentTime - snapshotPos) < 0.35 && video.readyState < 3) {
          switchToFasterServer("stalled-4s");
        }
      }, 4200);
    };
    video.addEventListener("waiting", onBufferingEvent);
    video.addEventListener("stalled", onBufferingEvent);
    video.addEventListener("playing", () => {
      clearTimeout(stallWatchTimer);
      $(".cv-buffer").hidden = true;
      if (activeSource?.url) {
        writeClientServerScore(sourceServerKey(activeSource.url), Math.min(350, Number(activeSource.serverLatencyMs || 280)), true);
      }
    });
    video.addEventListener("canplay", () => {
      clearTimeout(stallWatchTimer);
      $(".cv-buffer").hidden = true;
    });
    video.addEventListener("loadedmetadata", () => {
      if (saved > 15 && saved < video.duration - 2 && video.currentTime < 5) {
        const oldBtn = wrap.querySelector(".cv-resume");
        if (oldBtn) oldBtn.remove();
        const resume = document.createElement("button");
        resume.className = "cv-resume";
        resume.textContent = "▶ Resume from " + fmt(saved);
        wrap.appendChild(resume);
        resume.addEventListener(
          "click",
          () => {
            video.currentTime = saved;
            resume.remove();
            safePlayWithFallback();
          },
          { once: true }
        );
      }
    });
    video.addEventListener("ended", () => localStorage.removeItem(storageKey));

    wrap.tabIndex = 0;
    wrap.addEventListener("keydown", e => {
      if (["INPUT", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        video.paused ? safePlayWithFallback() : video.pause();
      } else if (e.key === "ArrowRight") video.currentTime += 10;
      else if (e.key === "ArrowLeft") video.currentTime -= 10;
      else if (e.key.toLowerCase() === "f") $(".cv-full").click();
    });

    let tap = 0;
    let lastTapX = 0;
    video.addEventListener(
      "touchend",
      e => {
        if (locked) return;
        const x = e.changedTouches[0].clientX;
        const r = video.getBoundingClientRect();
        if (Math.abs(x - (r.left + r.width / 2)) < r.width * 0.12) {
          tap = 0;
          return;
        }
        const now = Date.now();
        if (now - tap < 320 && Math.abs(x - lastTapX) < 70) {
          const delta = x < r.left + r.width / 2 ? -10 : 10;
          video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + delta));
          showSkip(delta);
          tap = 0;
          suppressNextVideoClick = true;
          revealControls();
        } else {
          tap = now;
          lastTapX = x;
        }
      },
      { passive: true }
    );

    function setSuggestions(markup) {
      let panel = wrap.querySelector(".cv-end-suggestions");
      if (!markup) {
        panel?.remove();
        return;
      }
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "cv-end-suggestions";
        wrap.appendChild(panel);
      }
      panel.innerHTML =
        '<div class="cv-end-heading">Up Next · Suggested for you</div><div class="cv-end-grid">' +
        markup +
        '</div><button type="button" class="cv-end-replay">↻ Replay</button>';
      panel.querySelector(".cv-end-replay").addEventListener("click", () => {
        video.currentTime = 0;
        safePlayWithFallback();
      });
      if (video.ended) wrap.classList.add("cv-ended");
    }

    function setSources(next, opts = {}) {
      const seekTo = opts.seekTo != null ? Number(opts.seekTo) : 0;
      const shouldAutoplay = opts.autoplay !== false;
      allSources = normalizeSources(next);
      ordered = dedupeByQuality(allSources);
      failedSources.clear();
      slowSources.clear();
      stallTimestamps = [];
      clearTimeout(stallWatchTimer);
      retriedUrls.clear();
      activeSource = null;
      errorNotice.hidden = true;
      closeTopMenu();
      if (opts.storageKey) storageKey = opts.storageKey;
      if (opts.title) {
        const tEl = topbar.querySelector(".cv-title");
        if (tEl) tEl.textContent = opts.title;
      }
      if (opts.historyMeta) currentMeta = { ...opts.historyMeta };
      ambientHasVideoFrame = false;
      ambientCorsTainted = false;
      syncAmbientPoster();
      quality.innerHTML =
        '<option value="auto">Auto</option>' +
        ordered.map(x => '<option value="' + esc(x.quality) + '">' + esc(x.quality) + "</option>").join("");
      if (allSources.length) {
        const ranked = rankAllCandidates(allSources);
        const chosen =
          preferredQuality !== "auto"
            ? ranked.find(x => x.quality === preferredQuality) || best() || ranked[0]
            : best() || ranked[0];
        if (preferredQuality === "auto" && ranked.length > 1 && playbackMode !== "data-saver") {
          const raceTok = ++sourceToken;
          raceFastestServerSource(ranked, chosen).then(win => {
            if (raceTok !== sourceToken) return;
            setSource(win || chosen, false, shouldAutoplay, seekTo);
            quality.value = "auto";
          });
        } else {
          setSource(chosen, false, shouldAutoplay, seekTo);
          quality.value = preferredQuality === "auto" ? "auto" : chosen.quality;
        }
      }
      emitState();
    }

    function selectQuality(q) {
      preferredQuality = q || "auto";
      const src = preferredQuality === "auto" ? best() : ordered.find(x => x.quality === preferredQuality);
      if (quality) quality.value = preferredQuality === "auto" ? "auto" : src?.quality || "auto";
      if (src) setSource(src, true, true);
      emitState();
    }

    function setSpeed(rate) {
      const num = Math.max(0.25, Math.min(2, Number(rate) || 1));
      video.playbackRate = num;
      if (speedSelect) speedSelect.value = String(num);
      emitState();
    }

    function toggleBanglaSubtitle() {
      if (!subtitleItems.length) return -1;
      if (activeSubtitleIdx >= 0) {
        applyTrackSelection(-1);
        return -1;
      }
      const bn = subtitleItems.find(s => /^bn\b/i.test(s.language) || /বাংলা|bengali|bangla/i.test(s.label));
      const en = subtitleItems.find(s => /^en\b/i.test(s.language) || /english/i.test(s.label));
      const target = bn ? bn.index : en ? en.index : 0;
      applyTrackSelection(target);
      return target;
    }

    function setScreenMode(mode) {
      if (mode === "portrait") {
        exitFullscreen();
      } else if (mode === "landscape") {
        enterFullscreen();
      } else if (mode === "pip") {
        $(".cv-pip")?.click();
      }
    }

    function setAudioTrack(idx) {
      const target = Number(idx);
      if (activeHls && Array.isArray(activeHls.audioTracks)) {
        if (Number.isInteger(target) && target >= 0 && target < activeHls.audioTracks.length) {
          userSelectedAudio = true;
          activeHls.audioTrack = target;
          emitState();
        }
        return;
      }
      if (video.audioTracks && video.audioTracks.length > 0 && Number.isInteger(target) && target >= 0 && target < video.audioTracks.length) {
        userSelectedAudio = true;
        for (let i = 0; i < video.audioTracks.length; i++) {
          video.audioTracks[i].enabled = i === target;
        }
        emitState();
      }
    }

    function setAmbientMode(enabled, opts = {}) {
      ambientMode = Boolean(enabled);
      try {
        localStorage.setItem(AMBIENT_KEY, ambientMode ? "1" : "0");
      } catch {}
      applyAmbientState();
      if (!opts.silent) {
        showOsd("✦", "Ambient Mode", ambientMode ? 100 : 0, 0, 100, ambientMode ? "#f87171" : "#64748b");
      }
      emitState();
      return ambientMode;
    }

    function toggleAmbientMode() {
      return setAmbientMode(!ambientMode);
    }

    function setAmbientLevel(level) {
      const next = ["soft", "cinema", "vivid"].includes(level) ? level : "cinema";
      ambientLevel = next;
      try {
        localStorage.setItem(AMBIENT_LEVEL_KEY, next);
      } catch {}
      if (!ambientMode) {
        ambientMode = true;
        try { localStorage.setItem(AMBIENT_KEY, "1"); } catch {}
      }
      applyAmbientState();
      emitState();
      return ambientLevel;
    }

    function applyPlaybackModeChange(nextMode, opts = {}) {
      const normalized = nextMode === "data-saver" ? "data-saver" : "high-quality";
      const changed = playbackMode !== normalized;
      playbackMode = normalized;
      if (!opts.fromEvent) {
        writePlaybackMode(normalized);
      }
      if (!opts.silent) {
        showOsd(
          normalized === "data-saver" ? "⚡" : "✨",
          normalized === "data-saver" ? "Data Saver" : "High Quality",
          normalized === "data-saver" ? 45 : 100,
          0,
          100,
          normalized === "data-saver" ? "#10b981" : "#f87171"
        );
      }
      if (activeHls) {
        applyHlsPlaybackProfile(activeHls);
      }
      if (changed && ordered.length) {
        preferredQuality = "auto";
        const nextSrc = best() || ordered[0];
        if (nextSrc) {
          const isCurrentHls =
            activeSource &&
            (/\.m3u8(?:$|[?#])/i.test(activeSource.url) || /\/api\/(?:sports-hls|mlbd-hls)\//i.test(activeSource.url));
          if (!isCurrentHls || nextSrc.url !== activeSource?.url) {
            setSource(nextSrc, true, !video.paused);
          }
        }
      }
      emitState();
      return playbackMode;
    }

    function setPlaybackMode(mode, opts = {}) {
      return applyPlaybackModeChange(mode, opts);
    }

    function togglePlaybackMode() {
      return setPlaybackMode(playbackMode === "data-saver" ? "high-quality" : "data-saver");
    }

    window.addEventListener("cv:playback-mode-change", ev => {
      const mode = ev?.detail?.mode || readPlaybackMode();
      if (mode !== playbackMode) {
        applyPlaybackModeChange(mode, { fromEvent: true, silent: true });
      }
    });

    function getState() {
      let audioTracks = [];
      let activeAudioIdx = 0;
      if (activeHls && Array.isArray(activeHls.audioTracks)) {
        audioTracks = activeHls.audioTracks.map((t, i) => ({
          index: i,
          label: t.name || t.lang || `Audio ${i + 1}`,
          lang: t.lang || ""
        }));
        activeAudioIdx = Number(activeHls.audioTrack ?? 0);
      } else if (video.audioTracks && video.audioTracks.length > 0) {
        audioTracks = Array.from(video.audioTracks).map((t, i) => {
          if (t.enabled) activeAudioIdx = i;
          return {
            index: i,
            label: t.label || t.language || `Audio ${i + 1}`,
            lang: t.language || ""
          };
        });
      }
      return {
        qualities: ordered.map(x => x.quality),
        preferredQuality,
        playbackMode,
        activeQuality: activeSource?.quality || initial?.quality || "Auto",
        soundBoost: soundBoostPct,
        brightness: brightnessPct,
        ambientMode,
        ambientLevel,
        subtitles: subtitleItems,
        activeSubtitleIdx,
        audioTracks,
        activeAudioIdx,
        speed: Number(video.playbackRate || 1)
      };
    }

    return {
      video,
      wrap,
      setSource,
      setSources,
      setSubtitles,
      setSuggestions,
      selectQuality,
      getPlaybackMode: () => playbackMode,
      setPlaybackMode,
      togglePlaybackMode,
      setSoundBoost: pct => {
        applyAudioBoost(pct);
        showOsd("🔊", "Sound Boost", soundBoostPct, 100, 400, "#10b981");
        emitState();
      },
      setBrightness: pct => {
        applyBrightness(pct);
        showOsd("☀", "Brightness", brightnessPct, 30, 180, "#eab308");
        emitState();
      },
      setAmbientMode,
      toggleAmbientMode,
      setAmbientLevel,
      setActiveSubtitle: applyTrackSelection,
      setAudioTrack,
      toggleBanglaSubtitle,
      setSpeed,
      setScreenMode,
      getState
    };
  }

  window.CineVersePlayer = { mount };
})();