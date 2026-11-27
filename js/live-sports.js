(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const grid = $("#sportsGrid");
  const status = $("#sportsStatus");
  const box = $("#sportsPlayerBox");
  const video = $("#sportsVideo");
  const title = $("#sportsPlayerTitle");
  let hls = null;
  let items = [];
  let playSeq = 0;

  const val = (o, keys) => {
    for (const k of keys) {
      const v = o?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };

  const safe = u => {
    const raw = String(u || "").trim();
    if (!raw) return "";
    if (/^\/api\//i.test(raw)) return raw;
    try {
      const x = new URL(raw, location.href);
      return x.origin === location.origin || x.protocol === "https:" ? x.href : "";
    } catch {
      return "";
    }
  };

  const NAME = [
    "name",
    "title",
    "channelName",
    "channel_name",
    "channelTitle",
    "channel_title",
    "displayName",
    "display_name",
    "matchName",
    "eventName",
    "teamName",
    "channel"
  ];
  const LOGO = [
    "logo",
    "logoUrl",
    "logo_url",
    "channelLogo",
    "channel_logo",
    "channelImage",
    "channel_image",
    "image",
    "imageUrl",
    "image_url",
    "poster",
    "posterUrl",
    "poster_url",
    "thumbnail",
    "thumb",
    "icon",
    "cover",
    "coverUrl",
    "cover_url",
    "banner"
  ];

  function findArray(d, depth = 0) {
    if (depth > 5 || !d) return [];
    if (Array.isArray(d)) {
      if (d.length && d.some(x => x && typeof x === "object")) return d;
      return [];
    }
    if (typeof d !== "object") return [];
    for (const k of [
      "channels",
      "channelList",
      "channel_list",
      "sports",
      "matches",
      "events",
      "items",
      "results",
      "list",
      "data",
      "result",
      "live",
      "liveChannels",
      "live_channels"
    ]) {
      const a = findArray(d[k], depth + 1);
      if (a.length) return a;
    }
    for (const v of Object.values(d)) {
      const a = findArray(v, depth + 1);
      if (a.length) return a;
    }
    return [];
  }

  function deepValues(obj, keys, depth = 0, out = []) {
    if (!obj || typeof obj !== "object" || depth > 4) return out;
    if (Array.isArray(obj)) {
      for (const v of obj) deepValues(v, keys, depth + 1, out);
      return out;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (keys.includes(k)) {
        if (typeof v === "string" && v.trim()) out.push(v.trim());
        else if (v && typeof v === "object") {
          deepValues(
            v,
            ["url", "src", "file", "link", "value", "href", "m3u8", "hls", "streamUrl", "playUrl"],
            depth + 1,
            out
          );
        }
      }
      if (v && typeof v === "object") deepValues(v, keys, depth + 1, out);
    }
    return out;
  }

  function streams(x) {
    return [
      ...new Set(
        deepValues(x, [
          "url",
          "src",
          "file",
          "streamUrl",
          "stream_url",
          "m3u8",
          "hls",
          "link",
          "playUrl",
          "play_url",
          "stream",
          "source",
          "sources",
          "streams",
          "server",
          "playback",
          "urlList"
        ])
          .map(safe)
          .filter(Boolean)
      )
    ];
  }

  function isHls(u, x) {
    return (
      /\.m3u8(?:$|[?#])/i.test(u) ||
      /\/api\/sports-hls\//i.test(u) ||
      /m3u8|hls/i.test(val(x, ["type", "format", "protocol", "streamType", "stream_type"]))
    );
  }

  function streamOf(x) {
    const all = streams(x);
    return all.find(u => isHls(u, x)) || all[0] || "";
  }

  function nameOf(x) {
    const direct =
      val(x, NAME) ||
      val(x?.info, NAME) ||
      val(x?.channelInfo, NAME) ||
      val(x?.channel, NAME) ||
      val(x?.event, NAME) ||
      val(x?.match, NAME);
    if (direct) return direct;
    const nested = deepValues(x, NAME);
    return nested[0] || val(x, ["id", "slug", "key"]) || "Live Channel";
  }

  function logoOf(x) {
    const direct =
      val(x, LOGO) ||
      val(x?.info, LOGO) ||
      val(x?.channelInfo, LOGO) ||
      val(x?.images, ["logo", "poster", "cover"]);
    return safe(direct || deepValues(x, LOGO)[0] || "");
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function card(x, i) {
    const name = nameOf(x);
    const logo = logoOf(x);
    const stream = streamOf(x);
    const sub = val(x, ["league", "category", "sport", "group", "country", "quality"]);
    return (
      '<article class="sports-card" tabindex="0" role="button" data-index="' +
      i +
      '">' +
      (logo
        ? '<img ' +
          (i < 4 ? 'loading="eager" ' : 'loading="lazy" ') +
          'decoding="async" referrerpolicy="no-referrer" src="' +
          esc(logo) +
          '" alt="' +
          esc(name) +
          '" onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false"><div class="sports-fallback" hidden>📺</div>'
        : '<div class="sports-fallback">📺</div>') +
      '<div class="sports-card-body"><span class="sports-live">' +
      (x?.live ? "● LIVE" : x?.quality || "MATCH") +
      "</span><h3>" +
      esc(name) +
      "</h3><small>" +
      esc(sub || "Live Sports") +
      "</small>" +
      (stream ? "" : '<small class="sports-no-stream">Stream unavailable</small>') +
      "</div></article>"
    );
  }

  function loadHlsScript() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (window.__cvSportsHlsPromise) return window.__cvSportsHlsPromise;
    window.__cvSportsHlsPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js";
      sc.onload = () => resolve(window.Hls);
      sc.onerror = reject;
      document.head.appendChild(sc);
    });
    return window.__cvSportsHlsPromise;
  }

  async function tryAutoplay(matchName, seq) {
    try {
      video.muted = false;
      await video.play();
      if (seq === playSeq) status.textContent = "● LIVE: " + matchName;
    } catch {
      try {
        video.muted = true;
        await video.play();
        if (seq === playSeq) status.textContent = "● LIVE (Muted): " + matchName + " — সাউন্ড চালু করতে স্পিকার চাপুন।";
      } catch {
        if (seq === playSeq) status.textContent = "Stream প্রস্তুত — ভিডিওতে ▶ Play চাপুন।";
      }
    }
  }

  async function play(item) {
    const url = streamOf(item);
    const matchName = nameOf(item);
    if (!url) {
      status.textContent = "এই চ্যানেলের stream URL পাওয়া যায়নি।";
      return;
    }
    const seq = ++playSeq;
    if (hls) {
      hls.destroy();
      hls = null;
    }
    video.pause();
    video.removeAttribute("src");
    video.load();

    // Prevent gray native play icon placeholder on Android/desktop before frames arrive
    video.poster =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#090c12"/></svg>'
      );

    title.textContent = matchName;
    box.hidden = false;
    status.textContent = "Stream সংযোগ করা হচ্ছে…";
    box.scrollIntoView({ behavior: "smooth", block: "start" });

    video.onplaying = () => {
      if (seq === playSeq) status.textContent = "● LIVE: " + matchName;
    };
    video.onerror = () => {
      if (seq !== playSeq) return;
      const e = video.error;
      status.textContent = item?.live
        ? "ভিডিও চালু হয়নি (error " + (e?.code || "unknown") + ")। কিছুক্ষণ পর আবার চেষ্টা করুন।"
        : "এই ম্যাচটি এখনো শুরু হয়নি বা শেষ হয়ে গেছে — ● LIVE লেখা ম্যাচ সিলেক্ট করুন।";
    };

    const ua = navigator.userAgent || "";
    const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/i.test(ua);

    // Prefer Hls.js over native HLS on Chromium/Android (Chrome returns "maybe" for canPlayType but stalls)
    let HlsCtor = window.Hls;
    if (!HlsCtor && !isSafari) {
      try {
        HlsCtor = await loadHlsScript();
      } catch {}
    }
    if (seq !== playSeq) return;

    const isDataSaverMode = () => {
      try {
        const saved = localStorage.getItem("cv_playback_quality_mode_v1");
        if (saved === "data-saver") return true;
        if (saved === "high-quality") return false;
      } catch {}
      return Boolean(navigator.connection?.saveData);
    };

    const applySportsHlsCap = hlsInst => {
      if (!hlsInst) return;
      const saver = isDataSaverMode();
      if (hlsInst.config) {
        hlsInst.config.maxBufferLength = saver ? 10 : 30;
        hlsInst.config.maxMaxBufferLength = saver ? 18 : 60;
        hlsInst.config.capLevelToPlayerSize = saver;
      }
      if (Array.isArray(hlsInst.levels) && hlsInst.levels.length > 0) {
        if (saver) {
          let capIdx = -1;
          for (let i = 0; i < hlsInst.levels.length; i++) {
            const h = Number(hlsInst.levels[i]?.height || 0);
            if (h > 0 && h <= 480) capIdx = i;
          }
          if (capIdx < 0) capIdx = 0;
          hlsInst.autoLevelCapping = capIdx;
          if (hlsInst.currentLevel > capIdx || hlsInst.nextLevel > capIdx) hlsInst.nextLevel = capIdx;
        } else {
          hlsInst.autoLevelCapping = -1;
        }
      }
    };

    if (!isSafari && HlsCtor && HlsCtor.isSupported()) {
      let mediaRecoveries = 0;
      let netRecoveries = 0;
      const saverInit = isDataSaverMode();
      hls = new HlsCtor({
        enableWorker: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: saverInit ? 10 : 30,
        maxMaxBufferLength: saverInit ? 18 : 60,
        backBufferLength: saverInit ? 30 : 60,
        capLevelToPlayerSize: saverInit,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        xhrSetup: xhr => {
          xhr.withCredentials = false;
        }
      });

      hls.on(HlsCtor.Events.ERROR, (_, d) => {
        if (seq !== playSeq || !d.fatal) return;
        if (d.type === HlsCtor.ErrorTypes.NETWORK_ERROR && netRecoveries < 2) {
          netRecoveries++;
          status.textContent = "Stream পুনরায় সংযোগ করা হচ্ছে…";
          hls?.startLoad();
          return;
        }
        if (d.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries++;
          hls?.recoverMediaError();
          return;
        }
        status.textContent = item?.live
          ? "HLS error: " + d.details + " — এই ম্যাচের স্ট্রিম সাময়িকভাবে অফলাইন থাকতে পারে। অন্য ● LIVE ম্যাচ চেষ্টা করুন।"
          : "এই ম্যাচের লাইভ স্ট্রিম বর্তমানে চালু নেই (ম্যাচ শেষ বা শুরু হয়নি)। ● LIVE লেখা ম্যাচ দেখুন।";
        hls?.destroy();
        hls = null;
      });

      hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
        if (seq === playSeq && hls) hls.loadSource(url);
      });
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        if (seq !== playSeq) return;
        applySportsHlsCap(hls);
        tryAutoplay(matchName, seq);
      });
      if (!window.__cvSportsSaverBound) {
        window.__cvSportsSaverBound = true;
        window.addEventListener("cv:playback-mode-change", () => applySportsHlsCap(hls));
      }
      hls.attachMedia(video);
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (seq === playSeq) tryAutoplay(matchName, seq);
        },
        { once: true }
      );
      tryAutoplay(matchName, seq);
      return;
    }

    status.textContent = "এই ব্রাউজারে HLS লাইভ স্ট্রিম সমর্থিত নয়।";
  }

  function renderSportsList(list, { autoSelectRequested = false } = {}) {
    items = list;
    grid.innerHTML = items.map(card).join("");
    const liveCount = items.filter(x => x.live).length;
    status.textContent =
      items.length + "টি ম্যাচ পাওয়া গেছে (" + liveCount + "টি ● LIVE)। LIVE ম্যাচে ক্লিক করে দেখুন।";
    grid.onclick = e => {
      const c = e.target.closest("[data-index]");
      if (c) {
        grid.querySelectorAll(".sports-card.active").forEach(el => el.classList.remove("active"));
        c.classList.add("active");
        play(items[Number(c.dataset.index)]);
      }
    };
    grid.onkeydown = e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-index]")) {
        e.preventDefault();
        grid.querySelectorAll(".sports-card.active").forEach(el => el.classList.remove("active"));
        e.target.classList.add("active");
        play(items[Number(e.target.dataset.index)]);
      }
    };

    if (autoSelectRequested) {
      const requestedMatch = (new URLSearchParams(location.search).get("match") || "").trim().toLowerCase();
      if (requestedMatch) {
        const matchIdx = items.findIndex(item => {
          const id = String(item?.id || "").trim().toLowerCase();
          const nm = nameOf(item).trim().toLowerCase();
          const tPair = `${item?.team1Name || ""}-${item?.team2Name || ""}`.trim().toLowerCase();
          return (id && id === requestedMatch) || tPair === requestedMatch || nm.includes(requestedMatch);
        });
        if (matchIdx >= 0) {
          const matchedCard = grid.querySelector(`[data-index="${matchIdx}"]`);
          matchedCard?.classList.add("active");
          const matchedItem = items[matchIdx];
          if (streamOf(matchedItem)) {
            play(matchedItem);
          } else {
            status.textContent = `${nameOf(matchedItem)} — ${matchedItem?.league || "এই ম্যাচটি এখনো শুরু হয়নি বা স্ট্রিম এখনো আসেনি"}।`;
            matchedCard?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    }
  }

  async function load() {
    let paintedCached = false;
    try {
      const cached = JSON.parse(localStorage.getItem("cv_sports_cache_v1") || "null");
      if (cached && cached.ts && Date.now() - cached.ts < 3 * 60 * 1000 && Array.isArray(cached.channels) && cached.channels.length) {
        renderSportsList(cached.channels, { autoSelectRequested: false });
        paintedCached = true;
      }
    } catch {}
    if (!paintedCached) {
      status.textContent = "Live Sports চ্যানেল লোড হচ্ছে…";
      grid.innerHTML = "";
    }
    try {
      const r = await fetch("/api/movie-api/sports");
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "HTTP " + r.status);
      const freshItems = findArray(data);
      if (!freshItems.length) {
        if (!paintedCached) status.textContent = "API connected, কিন্তু channel list পাওয়া যায়নি।";
        return;
      }
      try {
        localStorage.setItem("cv_sports_cache_v1", JSON.stringify({ ts: Date.now(), channels: freshItems.slice(0, 32) }));
      } catch {}
      renderSportsList(freshItems, { autoSelectRequested: true });
    } catch (e) {
      if (!paintedCached) status.textContent = "Live Sports লোড হয়নি: " + e.message;
    }
  }

  $("#sportsRefresh")?.addEventListener("click", load);
  load();
})();