(() => {
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const HISTORY_KEY = "cv_watch_history_v1";
  const BOOST_KEY = "cv_sound_boost_v1";
  const BRIGHT_KEY = "cv_brightness_v1";

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

    let currentMeta = historyMeta ? { ...historyMeta } : { path: "", title, poster: "", isSeries: false, se: 0, ep: 0 };

    const qualityNumber = x => Number(String(x?.quality || "").match(/\d+/)?.[0] || 0);
    const normalizeSources = list =>
      [...list]
        .filter(x => {
          if (!x || !x.url) return false;
          if (/\.mpd(?:$|[?#])/i.test(String(x.url))) return false;
          if (/\bdash\b|dash\+xml/i.test(String(x.format || x.mime || x.type || ""))) return false;
          return true;
        })
        .map(x => ({ ...x, quality: String(x.quality || "Auto"), mime: String(x.mime || x.type || "") }))
        .sort((a, b) => qualityNumber(a) - qualityNumber(b));

    let ordered = normalizeSources(sources);
    const best = () => {
      const c = navigator.connection || {};
      const down = Number(c.downlink) || 0;
      const verySlow = !!c.saveData || /2g|slow-2g/i.test(c.effectiveType || "") || (down > 0 && down < 1.5);
      const q = verySlow ? "low" : !c.effectiveType && !down || down >= 4 || c.effectiveType === "4g" ? "1080p" : "720p";
      return (verySlow ? ordered[0] : null) || ordered.find(x => x.quality === q) || ordered.find(x => x.quality === "720p") || ordered.find(x => x.quality === "480p") || ordered[0];
    };

    const initial = best();
    const saved = Number(localStorage.getItem(storageKey) || 0);
    const savedVolume = Number(localStorage.getItem("cv-player-volume") || 1);
    video.volume = Math.max(0, Math.min(1, savedVolume));

    let soundBoostPct = Math.max(100, Math.min(400, Number(localStorage.getItem(BOOST_KEY) || 100)));
    let brightnessPct = Math.max(30, Math.min(180, Number(localStorage.getItem(BRIGHT_KEY) || 100)));
    let preferredQuality = "auto";
    let activeSubtitleIdx = -1;
    let subtitleItems = [];

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
      '<div class="cv-progress"><input class="cv-seek" type="range" min="0" max="1000" value="0" aria-label="Seek"></div><div class="cv-control-row"><button type="button" class="cv-play" aria-label="Play">▶</button><button type="button" class="cv-back" aria-label="Back 10 seconds">↶10</button><button type="button" class="cv-forward" aria-label="Forward 10 seconds">10↷</button><span class="cv-time">0:00 / 0:00</span><button type="button" class="cv-mute" aria-label="Mute sound" title="Mute / Unmute">🔊</button><input class="cv-volume" type="range" min="0" max="1" step=".05" value="1" aria-label="Volume"><select class="cv-quality" aria-label="Quality">' +
      qualityOptions +
      '</select><select class="cv-speed" aria-label="Playback speed"><option value="0.5">0.5</option><option value="0.75">0.75</option><option value="1" selected>1</option><option value="1.25">1.25</option><option value="1.5">1.5</option><option value="2">2</option></select><select class="cv-subtitles" aria-label="Subtitles"><option value="-1">Subtitles Off</option></select><button type="button" class="cv-pip" title="Picture in Picture">▣</button><button type="button" class="cv-full" title="Fullscreen">⛶</button></div><div class="cv-buffer" hidden>Buffering…</div>';
    wrap.appendChild(controls);

    const topRight = topbar.querySelector(".cv-top-right");
    const lockButton = document.createElement("button");
    lockButton.type = "button";
    lockButton.className = "cv-lock";
    lockButton.textContent = "🔒";
    lockButton.setAttribute("aria-label", "Lock controls");
    wrap.appendChild(lockButton);

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "cv-settings";
    settingsButton.textContent = "⚙";
    settingsButton.setAttribute("aria-label", "Player settings");
    wrap.appendChild(settingsButton);

    const settingsPanel = document.createElement("div");
    settingsPanel.className = "cv-settings-panel";
    settingsPanel.innerHTML = "<span>Playback speed</span>";
    const speedSelect = controls.querySelector(".cv-speed");
    settingsPanel.appendChild(speedSelect);
    wrap.appendChild(settingsPanel);

    settingsButton.addEventListener("click", () => {
      if (typeof onOpenSettings === "function") {
        onOpenSettings();
      } else {
        settingsPanel.classList.toggle("open");
      }
    });

    let locked = false;
    lockButton.addEventListener("click", () => {
      locked = !locked;
      wrap.classList.toggle("cv-locked", locked);
      lockButton.textContent = locked ? "🔓" : "🔒";
      lockButton.setAttribute("aria-label", locked ? "Unlock controls" : "Lock controls");
      if (!locked) revealControls();
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

    function syncSound() {
      const silent = video.muted || video.volume === 0;
      mute.textContent = silent ? "🔇" : "🔊";
      mute.setAttribute("aria-label", silent ? "Turn sound on" : "Mute sound");
      mute.title = silent ? "Turn sound on" : "Mute sound";
      if (!silent) unmuteBtn.hidden = true;
    }
    syncSound();
    topRight.append(quality, subs);

    function emitState() {
      if (typeof onStateChange === "function") {
        onStateChange(getState());
      }
    }

    let hideTimer = 0;
    function revealControls() {
      wrap.classList.add("cv-ui-visible");
      clearTimeout(hideTimer);
      if (!video.paused && !video.ended) {
        hideTimer = setTimeout(() => wrap.classList.remove("cv-ui-visible"), 2800);
      }
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

    let activeHls = null;
    let sourceToken = 0;
    let activeSource = null;
    let failedSources = new Set();
    let retriedUrls = new Set();

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
      const remaining = ordered.filter(x => x && x.url && !failedSources.has(x.url));
      const next = remaining.find(x => x.quality === "720p") || remaining.find(x => x.quality === "480p") || remaining[remaining.length - 1] || remaining[0];
      if (next) {
        console.warn("Video source failed; trying another source", { quality: failed.quality, code, probeInfo });
        setSource(next, false, true);
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

    async function safePlayWithFallback() {
      try {
        await video.play();
        unmuteBtn.hidden = true;
      } catch (err) {
        if (err && err.name === "NotAllowedError" && !video.muted) {
          try {
            video.muted = true;
            await video.play();
            syncSound();
            unmuteBtn.hidden = false;
          } catch {}
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

    async function setSource(src, keep = true, autoplay = false, seekOverride = null) {
      const token = ++sourceToken;
      const t = seekOverride != null ? Math.max(0, Number(seekOverride) || 0) : keep ? video.currentTime : 0;
      const was = !video.paused;
      errorNotice.hidden = true;
      if (activeHls) {
        activeHls.destroy();
        activeHls = null;
      }
      video.pause();
      activeSource = src;
      quality.value = preferredQuality === "auto" ? "auto" : src.quality || "auto";
      emitState();

      const isHls =
        /\.m3u8(?:$|[?#])/i.test(src.url) ||
        /\/api\/sports-hls\//i.test(src.url) ||
        /mpegurl|m3u8|hls/i.test(String(src.mime || src.type || ""));

      const ready = () => {
        if (token !== sourceToken) return;
        if (t > 0 && Number.isFinite(video.duration)) {
          video.currentTime = Math.min(t, Math.max(0, video.duration - 2));
        }
        if (activeSubtitleIdx >= 0) {
          applyTrackSelection(activeSubtitleIdx);
        }
        if (was || autoplay) safePlayWithFallback();
      };

      if (isHls) {
        const ua = navigator.userAgent || "";
        const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/i.test(ua);
        if (!isSafari) {
          try {
            const Hls = await loadHlsLibrary();
            if (token !== sourceToken) return;
            if (Hls && Hls.isSupported()) {
              activeHls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
              activeHls.on(Hls.Events.MEDIA_ATTACHED, () => {
                if (token === sourceToken) activeHls.loadSource(src.url);
              });
              activeHls.on(Hls.Events.MANIFEST_PARSED, ready);
              activeHls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal && token === sourceToken) {
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

      video.preload = "metadata";
      video.src = src.url;
      video.addEventListener("loadedmetadata", ready, { once: true });
      if (autoplay) {
        safePlayWithFallback();
      }
    }

    setSource(initial, false, true);
    quality.value = "auto";

    quality.addEventListener("change", () => {
      preferredQuality = quality.value;
      const src = quality.value === "auto" ? best() : ordered.find(x => x.quality === quality.value);
      if (src) setSource(src, true, true);
      emitState();
    });

    play.addEventListener("click", () => (video.paused ? safePlayWithFallback() : video.pause()));
    centerPlay.addEventListener("click", () => (video.paused ? safePlayWithFallback() : video.pause()));
    video.addEventListener("click", () => {
      if (video.paused) safePlayWithFallback();
      else revealControls();
    });
    video.addEventListener("play", () => {
      if (soundBoostPct > 100) applyAudioBoost(soundBoostPct);
      wrap.classList.remove("cv-ended");
      play.textContent = "Ⅱ";
      centerPlay.classList.remove("visible");
      wrap.classList.add("cv-playing");
      revealControls();
    });
    video.addEventListener("pause", () => {
      play.textContent = "▶";
      centerPlay.classList.add("visible");
      wrap.classList.remove("cv-playing");
      revealControls();
    });
    ["pointermove", "pointerdown", "touchstart"].forEach(evt => wrap.addEventListener(evt, revealControls, { passive: true }));
    wrap.addEventListener("mouseleave", () => {
      if (!video.paused) wrap.classList.remove("cv-ui-visible");
    });
    video.addEventListener("ended", () => {
      centerPlay.classList.add("visible");
      wrap.classList.add("cv-ui-visible");
      wrap.classList.add("cv-ended");
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
    });

    volume.addEventListener("input", e => {
      video.volume = Number(e.target.value);
      video.muted = false;
      localStorage.setItem("cv-player-volume", String(video.volume));
      syncSound();
    });

    mute.addEventListener("click", () => {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        if (video.volume === 0) {
          video.volume = Math.max(0.5, Number(localStorage.getItem("cv-player-volume") || 1));
          volume.value = String(video.volume);
        }
      } else {
        video.muted = true;
      }
      syncSound();
      revealControls();
    });
    video.addEventListener("volumechange", syncSound);

    speedSelect.addEventListener("change", e => {
      video.playbackRate = Number(e.target.value) || 1;
      emitState();
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
    });

    $(".cv-pip").addEventListener("click", async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {}
    });

    async function setSubtitles(list = []) {
      video.querySelectorAll("track[data-cv-dynamic-subtitle]").forEach(t => t.remove());
      subs.innerHTML = '<option value="-1">Subtitles Off</option>';
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
      applyTrackSelection(Number(subs.value));
    });

    video.addEventListener("waiting", () => ($(".cv-buffer").hidden = false));
    video.addEventListener("playing", () => ($(".cv-buffer").hidden = true));
    video.addEventListener("canplay", () => ($(".cv-buffer").hidden = true));
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
      ordered = normalizeSources(next);
      failedSources.clear();
      retriedUrls.clear();
      activeSource = null;
      errorNotice.hidden = true;
      if (opts.storageKey) storageKey = opts.storageKey;
      if (opts.title) {
        const tEl = topbar.querySelector(".cv-title");
        if (tEl) tEl.textContent = opts.title;
      }
      if (opts.historyMeta) currentMeta = { ...opts.historyMeta };
      quality.innerHTML =
        '<option value="auto">Auto</option>' +
        ordered.map(x => '<option value="' + esc(x.quality) + '">' + esc(x.quality) + "</option>").join("");
      if (ordered.length) {
        const chosen =
          preferredQuality !== "auto"
            ? ordered.find(x => x.quality === preferredQuality) || best() || ordered[0]
            : best() || ordered[0];
        setSource(chosen, false, shouldAutoplay, seekTo);
        quality.value = preferredQuality === "auto" ? "auto" : chosen.quality;
      }
      emitState();
    }

    function selectQuality(q) {
      preferredQuality = q || "auto";
      const src = preferredQuality === "auto" ? best() : ordered.find(x => x.quality === preferredQuality);
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

    function getState() {
      return {
        qualities: ordered.map(x => x.quality),
        preferredQuality,
        activeQuality: activeSource?.quality || initial?.quality || "Auto",
        soundBoost: soundBoostPct,
        brightness: brightnessPct,
        subtitles: subtitleItems,
        activeSubtitleIdx,
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
      setActiveSubtitle: applyTrackSelection,
      toggleBanglaSubtitle,
      setSpeed,
      setScreenMode,
      getState
    };
  }

  window.CineVersePlayer = { mount };
})();