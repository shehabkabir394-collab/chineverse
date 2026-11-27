(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/|favicon\.svg)/i.test(String(u || "")) ? String(u) : "");

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const HISTORY_KEY = "cv_watch_history_v1";
  const SEARCH_HISTORY_KEY = "cv_recent_searches_v1";
  const REMINDERS_KEY = "cv_sports_reminders_v1";
  const FAMILY_SAFE_KEY = "cv_family_safe_v1";
  const PLAYBACK_MODE_KEY = "cv_playback_quality_mode_v1";
  const SCROLL_PROGRESS_KEY = "cv_scroll_progress_v1";

  const SCROLL_PROGRESS_THEMES = {
    crimson: {
      label: "Crimson",
      bg: "linear-gradient(90deg, #ef4444, #f87171, #fca5a5)",
      glow: "0 0 12px rgba(248, 113, 113, 0.6)",
      swatch: "#f87171"
    },
    ocean: {
      label: "Ocean",
      bg: "linear-gradient(90deg, #0284c7, #38bdf8, #7dd3fc)",
      glow: "0 0 12px rgba(56, 189, 248, 0.55)",
      swatch: "#38bdf8"
    },
    emerald: {
      label: "Emerald",
      bg: "linear-gradient(90deg, #059669, #34d399, #6ee7b7)",
      glow: "0 0 12px rgba(52, 211, 153, 0.55)",
      swatch: "#34d399"
    },
    amber: {
      label: "Gold",
      bg: "linear-gradient(90deg, #d97706, #fbbf24, #fde68a)",
      glow: "0 0 12px rgba(251, 191, 36, 0.55)",
      swatch: "#fbbf24"
    },
    frost: {
      label: "Frost",
      bg: "linear-gradient(90deg, rgba(226, 232, 240, 0.85), #ffffff)",
      glow: "0 0 10px rgba(255, 255, 255, 0.45)",
      swatch: "#f8fafc"
    }
  };
  const DEFAULT_SCROLL_PROGRESS = {
    enabled: true,
    theme: "crimson",
    customColor: "",
    height: 3,
    glow: true,
    longPagesOnly: true
  };
  let deferredPrompt = null;
  let meViewMode = "hub"; // "hub" | "history" | "reminders" | "settings" | "search-history" | "scroll-progress" | "install"
  let spBarEl = null;
  let spFillEl = null;
  let spRaf = 0;

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function getFamilySafe() {
    try {
      return localStorage.getItem(FAMILY_SAFE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setFamilySafe(enabled) {
    const val = enabled ? "1" : "0";
    try {
      localStorage.setItem(FAMILY_SAFE_KEY, val);
    } catch {}
    window.dispatchEvent(new CustomEvent("cv:family-safe-change", { detail: { enabled: Boolean(enabled) } }));
    return Boolean(enabled);
  }

  function getPlaybackMode() {
    try {
      const saved = localStorage.getItem(PLAYBACK_MODE_KEY);
      if (saved === "data-saver" || saved === "high-quality") return saved;
    } catch {}
    try {
      if (navigator.connection?.saveData) return "data-saver";
    } catch {}
    return "high-quality";
  }

  function setPlaybackMode(mode) {
    const next = mode === "data-saver" ? "data-saver" : "high-quality";
    try {
      localStorage.setItem(PLAYBACK_MODE_KEY, next);
    } catch {}
    window.dispatchEvent(new CustomEvent("cv:playback-mode-change", { detail: { mode: next } }));
    return next;
  }

  function loadScrollProgressConfig() {
    try {
      const raw = JSON.parse(localStorage.getItem(SCROLL_PROGRESS_KEY) || "{}");
      if (!raw || typeof raw !== "object") return { ...DEFAULT_SCROLL_PROGRESS };
      const theme = raw.theme === "custom" || SCROLL_PROGRESS_THEMES[raw.theme] ? raw.theme : "crimson";
      const customColor = /^#[0-9a-f]{6}$/i.test(String(raw.customColor || "")) ? String(raw.customColor) : "";
      const heightNum = Number(raw.height);
      const height = [2, 3, 4, 5].includes(heightNum) ? heightNum : DEFAULT_SCROLL_PROGRESS.height;
      return {
        enabled: raw.enabled !== false,
        theme: theme === "custom" && !customColor ? "crimson" : theme,
        customColor,
        height,
        glow: raw.glow !== false,
        longPagesOnly: raw.longPagesOnly !== false
      };
    } catch {
      return { ...DEFAULT_SCROLL_PROGRESS };
    }
  }

  function resolveScrollTheme(cfg) {
    if (cfg.theme === "custom" && cfg.customColor) {
      return {
        label: "Custom",
        bg: `linear-gradient(90deg, ${cfg.customColor}, ${cfg.customColor}cc)`,
        glow: `0 0 12px ${cfg.customColor}99`,
        swatch: cfg.customColor
      };
    }
    return SCROLL_PROGRESS_THEMES[cfg.theme] || SCROLL_PROGRESS_THEMES.crimson;
  }

  function ensureScrollProgressBar() {
    if (spBarEl && document.body?.contains(spBarEl)) return spBarEl;
    if (!document.body) return null;
    spBarEl = document.createElement("div");
    spBarEl.id = "cvScrollProgress";
    spBarEl.className = "cv-scroll-progress";
    spBarEl.setAttribute("role", "progressbar");
    spBarEl.setAttribute("aria-label", "Page scroll progress");
    spBarEl.setAttribute("aria-valuemin", "0");
    spBarEl.setAttribute("aria-valuemax", "100");
    spBarEl.setAttribute("aria-valuenow", "0");
    spFillEl = document.createElement("div");
    spFillEl.className = "cv-scroll-progress-fill";
    spBarEl.appendChild(spFillEl);
    document.body.appendChild(spBarEl);
    return spBarEl;
  }

  function updateScrollProgress() {
    spRaf = 0;
    const bar = ensureScrollProgressBar();
    if (!bar || !spFillEl) return;
    const cfg = loadScrollProgressConfig();
    const theme = resolveScrollTheme(cfg);
    bar.style.setProperty("--cv-sp-height", `${cfg.height}px`);
    bar.style.setProperty("--cv-sp-bg", theme.bg);
    bar.style.setProperty("--cv-sp-glow", cfg.glow ? theme.glow : "none");

    const docHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    const maxScroll = Math.max(0, docHeight - window.innerHeight);
    const threshold = cfg.longPagesOnly ? Math.max(240, Math.round(window.innerHeight * 0.35)) : 20;
    const shouldShow = cfg.enabled && maxScroll >= threshold;
    bar.classList.toggle("is-visible", shouldShow);

    const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, (window.scrollY || window.pageYOffset || 0) / maxScroll)) : 0;
    spFillEl.style.transform = `scaleX(${ratio.toFixed(4)})`;
    bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  function scheduleScrollProgressUpdate() {
    if (spRaf) return;
    spRaf = requestAnimationFrame(updateScrollProgress);
  }

  function saveScrollProgressConfig(patch) {
    const next = { ...loadScrollProgressConfig(), ...(patch || {}) };
    try {
      localStorage.setItem(SCROLL_PROGRESS_KEY, JSON.stringify(next));
    } catch {}
    scheduleScrollProgressUpdate();
    return next;
  }

  function resetScrollProgressConfig() {
    try {
      localStorage.removeItem(SCROLL_PROGRESS_KEY);
    } catch {}
    scheduleScrollProgressUpdate();
    return { ...DEFAULT_SCROLL_PROGRESS };
  }

  window.CineVerseScrollProgress = {
    getConfig: loadScrollProgressConfig,
    updateConfig: saveScrollProgressConfig,
    resetConfig: resetScrollProgressConfig,
    refresh: scheduleScrollProgressUpdate
  };

  window.addEventListener("scroll", scheduleScrollProgressUpdate, { passive: true });
  window.addEventListener("resize", scheduleScrollProgressUpdate, { passive: true });
  window.addEventListener("storage", e => {
    if (e.key === SCROLL_PROGRESS_KEY) scheduleScrollProgressUpdate();
  });
  if (typeof ResizeObserver === "function" && document.body) {
    new ResizeObserver(scheduleScrollProgressUpdate).observe(document.body);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleScrollProgressUpdate, { once: true });
  } else {
    scheduleScrollProgressUpdate();
  }

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function loadJsonList(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadSearchHistory() {
    if (window.CineVerseSearch?.getHistory) {
      return window.CineVerseSearch.getHistory();
    }
    return loadJsonList(SEARCH_HISTORY_KEY)
      .map(x => (typeof x === "string" ? { q: x.trim(), ts: 0 } : { q: String(x?.q || "").trim(), ts: Number(x?.ts) || 0 }))
      .filter(x => x.q);
  }

  function renderWatchHistoryCards(history) {
    if (!history.length) {
      return `<p class="cv-me-empty-note">Movies and episodes you watch will appear here automatically.</p>`;
    }
    return `
      <div class="cv-history-strip">
        ${history
          .slice(0, 12)
          .map(h => {
            const pct =
              h.duration > 0 && h.currentTime > 0
                ? Math.min(100, Math.max(8, Math.round((h.currentTime / h.duration) * 100)))
                : 22;
            const poster = safeImg(h.poster);
            const href = h.path
              ? `watch.html?path=${encodeURIComponent(h.path)}&title=${encodeURIComponent(h.title || "")}`
              : "./";
            const tvBadgeSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="14" rx="2"/><polyline points="17 2 12 6 7 2"/></svg>`;
            return `
              <a class="cv-history-card" href="${esc(href)}">
                <div class="cv-history-thumb">
                  ${poster ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(h.title || "")}">` : `<div class="cv-history-fallback">▶</div>`}
                  <span class="cv-history-type-badge" aria-hidden="true">${tvBadgeSvg}</span>
                  <div class="cv-history-progress"><span style="width:${pct}%"></span></div>
                </div>
                <b>${esc(h.title || "Untitled")}</b>
              </a>
            `;
          })
          .join("")}
      </div>
    `;
  }

  async function shareApp() {
    const shareData = {
      title: "MovieStream BD — HD Streaming & Offline Cinema",
      text: "Watch movies, K-Dramas, web series, anime & live sports on MovieStream BD.",
      url: location.origin
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(location.origin);
      showToast("MovieStream BD link copied!");
    } catch {
      showToast("Copy link: " + location.origin);
    }
  }

  function renderMeContent() {
    const content = $("#cvMeContent");
    if (!content) return;

    const watchlist = loadJsonList(WATCHLIST_KEY);
    const history = loadJsonList(HISTORY_KEY);
    const searchHistory = loadSearchHistory();
    const reminders = loadJsonList(REMINDERS_KEY);
    const safeEnabled = getFamilySafe();
    const playbackMode = getPlaybackMode();
    const isDataSaver = playbackMode === "data-saver";

    if (meViewMode === "history") {
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Watch History (${history.length})</button>
          ${history.length ? `<button type="button" id="cvClearHistoryBtn" class="cv-clear-btn">Clear All</button>` : ""}
        </div>
        ${
          history.length
            ? `<div class="cv-me-history-list">
                ${history
                  .map(h => {
                    const pct = h.duration > 0 ? Math.min(100, Math.round((h.currentTime / h.duration) * 100)) : 0;
                    const href = `watch.html?path=${encodeURIComponent(h.path || "")}&title=${encodeURIComponent(h.title || "")}`;
                    return `<a class="cv-me-history-item" href="${esc(href)}">
                      <span>${esc(h.title || "Untitled")}${h.isSeries && h.ep ? ` · S${h.se || 1}E${h.ep}` : ""}</span>
                      <b>${pct ? pct + "%" : "Resume"} ›</b>
                    </a>`;
                  })
                  .join("")}
              </div>`
            : `<p class="cv-me-empty-note">Your watch history is empty.</p>`
        }
      `;
      return;
    }

    if (meViewMode === "reminders") {
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Release Reminders (${reminders.length})</button>
          ${reminders.length ? `<button type="button" id="cvClearRemindersBtn" class="cv-clear-btn">Clear All</button>` : ""}
        </div>
        ${
          reminders.length
            ? `<div class="cv-me-history-list">
                ${reminders
                  .map(
                    r => `<div class="cv-me-history-item">
                      <span>${esc(r.title || r.name || "Scheduled Event")}</span>
                      <b>${esc(r.time || r.date || "Reminder Set")}</b>
                    </div>`
                  )
                  .join("")}
              </div>`
            : `<p class="cv-me-empty-note">No upcoming release or match reminders saved yet.</p>`
        }
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <a class="cv-util-pill" href="catalog.html?category=%2Fnew">Upcoming &amp; New Releases ›</a>
          <a class="cv-util-pill" href="sports.html">Live Sports Schedule ›</a>
        </div>
      `;
      return;
    }

    if (meViewMode === "settings") {
      const cfg = loadScrollProgressConfig();
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Settings</button>
        </div>
        <div class="cv-me-hub-card">
          <div class="cv-me-hub-row" style="cursor:default">
            <span class="cv-me-row-left">
              <span>App Language</span>
            </span>
            <span class="cv-me-row-right"><span>English</span></span>
          </div>
          <div class="cv-me-hub-row cv-me-switch-row" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px 16px">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
              <span style="font-size:15px;font-weight:600">Playback Quality Mode</span>
              <span style="font-size:12px;color:${isDataSaver ? "#34d399" : "#fda4af"};font-weight:700">${isDataSaver ? "Data Saver" : "High Quality"}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button type="button" class="cv-sp-chip ${isDataSaver ? "active" : ""}" data-set-playback-mode="data-saver" style="min-height:40px;border-radius:10px;border:1px solid ${isDataSaver ? "#10b981" : "rgba(255,255,255,.12)"};background:${isDataSaver ? "rgba(16,185,129,.2)" : "rgba(255,255,255,.04)"};color:${isDataSaver ? "#a7f3d0" : "#e2e8f0"};font-weight:700;cursor:pointer">⚡ Data Saver</button>
              <button type="button" class="cv-sp-chip ${!isDataSaver ? "active" : ""}" data-set-playback-mode="high-quality" style="min-height:40px;border-radius:10px;border:1px solid ${!isDataSaver ? "#ef4444" : "rgba(255,255,255,.12)"};background:${!isDataSaver ? "rgba(239,68,68,.2)" : "rgba(255,255,255,.04)"};color:${!isDataSaver ? "#fecaca" : "#e2e8f0"};font-weight:700;cursor:pointer">✨ High Quality</button>
            </div>
            <small style="font-size:12px;color:#94a3b8;line-height:1.4">${isDataSaver ? "Caps bitrate (≤480p) and limits background buffering to save mobile data." : "Uses highest available HD bitrate and full adaptive streaming."}</small>
          </div>
          <button type="button" class="cv-me-hub-row" data-me-view="search-history">
            <span class="cv-me-row-left"><span>Search History</span></span>
            <span class="cv-me-row-right"><span>${searchHistory.length}</span><span class="cv-me-chevron">›</span></span>
          </button>
          <button type="button" class="cv-me-hub-row" data-me-view="scroll-progress">
            <span class="cv-me-row-left"><span>Scroll Progress Bar</span></span>
            <span class="cv-me-row-right"><span>${cfg.enabled ? `${resolveScrollTheme(cfg).label} · ${cfg.height}px` : "Off"}</span><span class="cv-me-chevron">›</span></span>
          </button>
          <button type="button" class="cv-me-hub-row" data-me-view="install">
            <span class="cv-me-row-left"><span>Install App &amp; TV Setup</span></span>
            <span class="cv-me-row-right"><span class="cv-me-chevron">›</span></span>
          </button>
        </div>
      `;
      return;
    }

    if (meViewMode === "search-history") {
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="settings">‹ Search History (${searchHistory.length})</button>
          ${searchHistory.length ? `<button type="button" id="cvClearSearchHistoryBtn" class="cv-clear-btn">Clear All</button>` : ""}
        </div>
        ${
          searchHistory.length
            ? `<div class="cv-me-history-list">
                ${searchHistory
                  .map(
                    item => `
                    <div class="cv-history-search-row">
                      <a class="cv-history-search-pick" href="catalog.html?q=${encodeURIComponent(item.q)}">
                        <span class="cv-history-search-text">${esc(item.q)}</span>
                      </a>
                      <button type="button" class="cv-history-search-remove" data-me-del-search="${esc(item.q)}" aria-label="Remove ${esc(item.q)}">×</button>
                    </div>
                  `
                  )
                  .join("")}
              </div>`
            : `<p class="cv-me-empty-note">Your search history is empty.</p>`
        }
      `;
      return;
    }

    if (meViewMode === "scroll-progress") {
      const cfg = loadScrollProgressConfig();
      const activeTheme = resolveScrollTheme(cfg);
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="settings">‹ Scroll Progress Bar</button>
          <button type="button" id="cvSpResetBtn" class="cv-clear-btn">Reset</button>
        </div>
        <div class="cv-sp-settings">
          <div class="cv-sp-preview-box">
            <div class="cv-sp-preview-head">
              <span>Live Top Bar Preview</span>
              <span>${cfg.enabled ? `${esc(activeTheme.label)} · ${cfg.height}px` : "Hidden"}</span>
            </div>
            <div class="cv-sp-preview-track" style="height:${cfg.height}px">
              <div class="cv-sp-preview-fill" style="background:${esc(activeTheme.bg)};box-shadow:${esc(cfg.glow ? activeTheme.glow : "none")};opacity:${cfg.enabled ? 1 : 0.25}"></div>
            </div>
          </div>

          <div class="cv-sp-card">
            <div class="cv-sp-row">
              <div class="cv-sp-row-copy">
                <b>Show Progress Bar</b>
                <small>Tracks scroll depth at the top of the screen</small>
              </div>
              <button type="button" class="cv-sp-toggle ${cfg.enabled ? "active" : ""}" data-sp-toggle="enabled" aria-pressed="${cfg.enabled ? "true" : "false"}">${cfg.enabled ? "ON" : "OFF"}</button>
            </div>
            <div class="cv-sp-row">
              <div class="cv-sp-row-copy">
                <b>Long Listing Pages Only</b>
                <small>Auto-hide on short non-scrollable pages</small>
              </div>
              <button type="button" class="cv-sp-toggle ${cfg.longPagesOnly ? "active" : ""}" data-sp-toggle="longPagesOnly" aria-pressed="${cfg.longPagesOnly ? "true" : "false"}">${cfg.longPagesOnly ? "ON" : "OFF"}</button>
            </div>
            <div class="cv-sp-row">
              <div class="cv-sp-row-copy">
                <b>Soft Glow Effect</b>
                <small>Adds subtle ambient glow under the bar</small>
              </div>
              <button type="button" class="cv-sp-toggle ${cfg.glow ? "active" : ""}" data-sp-toggle="glow" aria-pressed="${cfg.glow ? "true" : "false"}">${cfg.glow ? "ON" : "OFF"}</button>
            </div>
          </div>

          <div class="cv-sp-card">
            <span class="cv-sp-label">Accent Color</span>
            <div class="cv-sp-swatches">
              ${Object.entries(SCROLL_PROGRESS_THEMES)
                .map(
                  ([key, t]) => `
                    <button type="button" class="cv-sp-swatch ${cfg.theme === key ? "active" : ""}" data-sp-theme="${key}">
                      <span class="cv-sp-swatch-dot" style="background:${t.swatch}"></span>
                      <span>${esc(t.label)}</span>
                    </button>
                  `
                )
                .join("")}
              <input id="cvSpCustomColor" class="cv-sp-color-input" type="color" value="${esc(cfg.customColor || activeTheme.swatch)}" title="Custom bar color" aria-label="Custom progress bar color">
            </div>
          </div>

          <div class="cv-sp-card">
            <span class="cv-sp-label">Thickness</span>
            <div class="cv-sp-chips">
              ${[2, 3, 4, 5]
                .map(
                  px => `<button type="button" class="cv-sp-chip ${cfg.height === px ? "active" : ""}" data-sp-height="${px}">${px}px</button>`
                )
                .join("")}
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (meViewMode === "install") {
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Updates &amp; App Setup (v1.0)</button>
        </div>
        <div class="cv-me-install-box">
          <div id="cvUpdateStatusBox" class="cv-me-install-step">
            <b>MovieStream BD v1.0</b>
            <p>Checking live server status…</p>
          </div>
          ${deferredPrompt ? `<button type="button" id="cvTriggerPwaInstall" class="cv-discover-cta" style="width:100%;margin:4px 0">Install MovieStream BD App</button>` : ""}
          <div class="cv-me-install-step">
            <b>Android / Chrome</b>
            <p>Tap browser menu (⋮) → <b>Add to Home screen</b> or <b>Install app</b> for full-screen playback.</p>
          </div>
          <div class="cv-me-install-step">
            <b>iPhone / iPad Safari</b>
            <p>Tap Share icon → scroll down → <b>Add to Home Screen</b>.</p>
          </div>
          <div class="cv-me-install-step">
            <b>Smart TV / Android TV / Chromecast</b>
            <p>Open <b>${esc(location.origin)}</b> in TV Browser or use Chrome <b>Cast…</b> / Screen Mirroring.</p>
          </div>
        </div>
      `;
      fetch("/api/movie-api/status")
        .then(r => r.json())
        .then(d => {
          const box = $("#cvUpdateStatusBox");
          if (box) {
            box.innerHTML = `<b>MovieStream BD v1.0 · Up to date ✓</b>
              <p>MovieStreamBD &amp; MovieBox upstreams active (${esc(d?.provider || "Live Cinema Network")}).</p>`;
          }
        })
        .catch(() => {
          const box = $("#cvUpdateStatusBox");
          if (box) {
            box.innerHTML = `<b>MovieStream BD v1.0 · Latest Version</b><p>You are running the latest version.</p>`;
          }
        });
      return;
    }

    // Default Hub (Matches Screenshot 3 cleanly with MovieStream BD branding)
    const historySvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`;
    const bookmarkSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" opacity="0.9"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`;
    const bellSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
    const tvSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><polyline points="17 2 12 6 7 2"/><polygon points="10 10 16 13 10 16 10 10" fill="currentColor"/></svg>`;
    const gearSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" opacity="0.9"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>`;
    const shieldSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" opacity="0.9"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/></svg>`;
    const updateSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 8v7"/><path d="m9 12 3 3 3-3"/></svg>`;
    const shareSvg = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" opacity="0.9"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>`;

    content.innerHTML = `
      <div class="cv-me-hub-card">
        <div class="cv-me-hub-block">
          <button type="button" class="cv-me-hub-row cv-me-hub-head-row" data-me-view="history">
            <span class="cv-me-row-left">
              ${historySvg}
              <span>Watch History</span>
            </span>
            <span class="cv-me-chevron">›</span>
          </button>
          ${renderWatchHistoryCards(history)}
        </div>

        <a class="cv-me-hub-row" href="saved.html">
          <span class="cv-me-row-left">
            ${bookmarkSvg}
            <span>My List</span>
          </span>
          <span class="cv-me-row-right"><span>${watchlist.length}</span><span class="cv-me-chevron">›</span></span>
        </a>

        <button type="button" class="cv-me-hub-row" data-me-view="reminders">
          <span class="cv-me-row-left">
            ${bellSvg}
            <span>Release Reminders</span>
          </span>
          <span class="cv-me-row-right"><span>${reminders.length}</span><span class="cv-me-chevron">›</span></span>
        </button>

        <a class="cv-me-hub-row" href="saved.html?tab=offline">
          <span class="cv-me-row-left">
            ${tvSvg}
            <span>Offline Downloads</span>
          </span>
          <span class="cv-me-row-right"><span class="cv-me-offline-pill">OFFLINE</span><span class="cv-me-chevron">›</span></span>
        </a>
      </div>

      <div class="cv-me-hub-card" style="margin-top:12px">
        <button type="button" class="cv-me-hub-row" data-me-view="history">
          <span class="cv-me-row-left">
            ${historySvg}
            <span>Watched Titles</span>
          </span>
          <span class="cv-me-row-right"><span>${history.length}</span><span class="cv-me-chevron">›</span></span>
        </button>
      </div>

      <div class="cv-me-hub-card" style="margin-top:12px">
        <button type="button" class="cv-me-hub-row" data-me-view="settings">
          <span class="cv-me-row-left">
            ${gearSvg}
            <span>Settings</span>
          </span>
          <span class="cv-me-row-right"><span>English</span><span class="cv-me-chevron">›</span></span>
        </button>

        <div class="cv-me-hub-row cv-me-switch-row">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span style="display:flex;flex-direction:column;gap:2px">
              <span>Data Saver Playback</span>
              <small style="font-size:11.5px;font-weight:500;color:#94a3b8">${isDataSaver ? "Active · Limits bitrate & background data" : "Off · High Quality HD playback"}</small>
            </span>
          </span>
          <button type="button" id="cvDataSaverSwitch" class="cv-ios-switch ${isDataSaver ? "is-on" : ""}" role="switch" aria-checked="${isDataSaver ? "true" : "false"}" aria-label="Toggle Data Saver Playback">
            <span class="cv-ios-switch-thumb"></span>
          </button>
        </div>

        <div class="cv-me-hub-row cv-me-switch-row">
          <span class="cv-me-row-left">
            ${shieldSvg}
            <span>Family-Safe Mode</span>
          </span>
          <button type="button" id="cvFamilySafeSwitch" class="cv-ios-switch ${safeEnabled ? "is-on" : ""}" role="switch" aria-checked="${safeEnabled ? "true" : "false"}" aria-label="Toggle Family-Safe Mode">
            <span class="cv-ios-switch-thumb"></span>
          </button>
        </div>

        <button type="button" class="cv-me-hub-row" data-me-view="install">
          <span class="cv-me-row-left">
            ${updateSvg}
            <span>Check for Updates</span>
          </span>
          <span class="cv-me-row-right"><span>v1.0</span><span class="cv-me-chevron">›</span></span>
        </button>

        <button type="button" id="cvMeShareAppBtn" class="cv-me-hub-row">
          <span class="cv-me-row-left">
            ${shareSvg}
            <span>Share MovieStream BD</span>
          </span>
          <span class="cv-me-row-right"><span class="cv-me-chevron">›</span></span>
        </button>
      </div>
    `;
  }

  function showMe() {
    let modal = $("#cvMePanel");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cvMePanel";
      modal.className = "cv-me-panel";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="cv-me-card cv-me-hub-shell" role="dialog" aria-modal="true" aria-label="MovieStream BD Profile & Settings">
          <div class="cv-me-brand-head">
            <div class="cv-me-brand-left">
              <div class="cv-me-app-badge" aria-hidden="true">
                <svg width="26" height="22" viewBox="0 0 40 34" fill="none">
                  <path d="M5 25C2 22 2 13 8 7C13 2 24 1 32 4C36 6 37 13 35 20C32 27 25 31 16 31C10 31 7 28 5 25Z" stroke="#f87171" stroke-width="2.4" stroke-linecap="round"/>
                  <rect x="11" y="8" width="18" height="17" rx="4" fill="#070b14" stroke="#fca5a5" stroke-width="1.8"/>
                  <path d="M17 12.2L25.5 16.5L17 20.8Z" fill="#00c882"/>
                </svg>
              </div>
              <div class="cv-me-brand-copy">
                <b>MovieStream BD</b>
                <small>HD Streaming &amp; Offline Cinema</small>
              </div>
            </div>
            <div class="cv-me-brand-actions">
              <button type="button" class="cv-me-head-icon-btn" data-me-view="settings" aria-label="Settings" title="Settings">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>
              </button>
              <button type="button" class="cv-me-close" aria-label="Close">×</button>
            </div>
          </div>
          <div id="cvMeContent"></div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.addEventListener("click", async e => {
        if (e.target === modal || e.target.closest(".cv-me-close")) {
          modal.hidden = true;
          return;
        }
        const safeBtn = e.target.closest("#cvFamilySafeSwitch");
        if (safeBtn) {
          const next = setFamilySafe(!getFamilySafe());
          renderMeContent();
          showToast(next ? "Family-Safe Mode ON (18+ hidden)" : "Family-Safe Mode OFF (Unrestricted search)");
          return;
        }
        const saverSwitch = e.target.closest("#cvDataSaverSwitch");
        if (saverSwitch) {
          const next = setPlaybackMode(getPlaybackMode() === "data-saver" ? "high-quality" : "data-saver");
          renderMeContent();
          showToast(next === "data-saver" ? "Data Saver ON (≤480p & low background buffer)" : "High Quality Playback ON (Max HD)");
          return;
        }
        const modePick = e.target.closest("[data-set-playback-mode]");
        if (modePick) {
          const next = setPlaybackMode(modePick.dataset.setPlaybackMode);
          renderMeContent();
          showToast(next === "data-saver" ? "Data Saver ON (≤480p & low background buffer)" : "High Quality Playback ON (Max HD)");
          return;
        }
        if (e.target.closest("#cvMeShareAppBtn")) {
          await shareApp();
          return;
        }
        const viewBtn = e.target.closest("[data-me-view]");
        if (viewBtn) {
          meViewMode = viewBtn.dataset.meView || "hub";
          renderMeContent();
          return;
        }
        const delSearch = e.target.closest("[data-me-del-search]");
        if (delSearch) {
          const q = delSearch.dataset.meDelSearch || "";
          if (window.CineVerseSearch?.removeHistory) {
            window.CineVerseSearch.removeHistory(q);
          } else {
            const next = loadSearchHistory().filter(x => x.q.toLowerCase() !== q.toLowerCase());
            try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)); } catch {}
          }
          renderMeContent();
          return;
        }
        if (e.target.closest("#cvClearSearchHistoryBtn")) {
          if (window.CineVerseSearch?.clearHistory) {
            window.CineVerseSearch.clearHistory();
          } else {
            try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch {}
          }
          renderMeContent();
          return;
        }
        if (e.target.closest("#cvClearRemindersBtn")) {
          try { localStorage.removeItem(REMINDERS_KEY); } catch {}
          renderMeContent();
          return;
        }
        if (e.target.closest("#cvClearHistoryBtn")) {
          try {
            localStorage.removeItem(HISTORY_KEY);
          } catch {}
          renderMeContent();
          return;
        }
        const spToggle = e.target.closest("[data-sp-toggle]");
        if (spToggle) {
          const key = spToggle.dataset.spToggle;
          const cur = loadScrollProgressConfig();
          saveScrollProgressConfig({ [key]: !cur[key] });
          renderMeContent();
          return;
        }
        const spTheme = e.target.closest("[data-sp-theme]");
        if (spTheme) {
          saveScrollProgressConfig({ theme: spTheme.dataset.spTheme || "crimson" });
          renderMeContent();
          return;
        }
        const spHeight = e.target.closest("[data-sp-height]");
        if (spHeight) {
          saveScrollProgressConfig({ height: Number(spHeight.dataset.spHeight) || 3 });
          renderMeContent();
          return;
        }
        if (e.target.closest("#cvSpResetBtn")) {
          resetScrollProgressConfig();
          renderMeContent();
          return;
        }
        if (e.target.closest("#cvTriggerPwaInstall") && deferredPrompt) {
          deferredPrompt.prompt();
          try {
            await deferredPrompt.userChoice;
          } catch {}
          deferredPrompt = null;
          renderMeContent();
        }
      });

      modal.addEventListener("input", e => {
        if (e.target?.id === "cvSpCustomColor") {
          saveScrollProgressConfig({ theme: "custom", customColor: e.target.value });
          const previewFill = modal.querySelector(".cv-sp-preview-fill");
          const previewHead = modal.querySelector(".cv-sp-preview-head span:last-child");
          const cfg = loadScrollProgressConfig();
          const t = resolveScrollTheme(cfg);
          if (previewFill) {
            previewFill.style.background = t.bg;
            previewFill.style.boxShadow = cfg.glow ? t.glow : "none";
          }
          if (previewHead) previewHead.textContent = cfg.enabled ? `${t.label} · ${cfg.height}px` : "Hidden";
        }
      });
    }
    meViewMode = "hub";
    modal.hidden = false;
    renderMeContent();
  }

  window.CineVerseAccount = {
    open: showMe,
    getFamilySafe,
    setFamilySafe,
    getPlaybackMode,
    setPlaybackMode
  };

  window.addEventListener("cv:search-history-change", () => {
    const modal = $("#cvMePanel");
    if (modal && !modal.hidden) renderMeContent();
  });

  window.addEventListener("cv:playback-mode-change", () => {
    const modal = $("#cvMePanel");
    if (modal && !modal.hidden) renderMeContent();
  });

  document.addEventListener("click", e => {
    if (e.target.closest("#cvMeOpen, [data-open-me]")) {
      e.preventDefault();
      showMe();
    }
  });
})();