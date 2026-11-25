(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const HISTORY_KEY = "cv_watch_history_v1";
  const SEARCH_HISTORY_KEY = "cv_recent_searches_v1";
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
  let meViewMode = "hub"; // "hub" | "history" | "search-history" | "scroll-progress" | "install"
  let recentUploadsCount = null;
  let spBarEl = null;
  let spFillEl = null;
  let spRaf = 0;

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

  async function fetchRecentCount() {
    if (recentUploadsCount !== null) return recentUploadsCount;
    try {
      const r = await fetch("/api/movie-api/home");
      const d = await r.json();
      const set = new Set();
      (d?.trending || []).forEach(x => x?.path && set.add(x.path));
      (d?.sections || []).forEach(s => (s?.items || []).forEach(x => x?.path && set.add(x.path)));
      recentUploadsCount = set.size || 24;
    } catch {
      recentUploadsCount = 24;
    }
    return recentUploadsCount;
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
                ? Math.min(100, Math.max(5, Math.round((h.currentTime / h.duration) * 100)))
                : 15;
            const poster = safeImg(h.poster);
            const href = h.path
              ? `watch.html?path=${encodeURIComponent(h.path)}&title=${encodeURIComponent(h.title || "")}`
              : "./";
            const typeIcon = h.isSeries
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`;
            return `
              <a class="cv-history-card" href="${esc(href)}">
                <div class="cv-history-thumb">
                  ${poster ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(h.title || "")}">` : `<div class="cv-history-fallback">▶</div>`}
                  <span class="cv-history-type-badge" aria-hidden="true">${typeIcon}</span>
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

  function renderMeContent() {
    const content = $("#cvMeContent");
    if (!content) return;

    const watchlist = loadJsonList(WATCHLIST_KEY);
    const history = loadJsonList(HISTORY_KEY);
    const searchHistory = loadSearchHistory();

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

    if (meViewMode === "search-history") {
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Search History (${searchHistory.length})</button>
          ${searchHistory.length ? `<button type="button" id="cvClearSearchHistoryBtn" class="cv-clear-btn">Clear All</button>` : ""}
        </div>
        ${
          searchHistory.length
            ? `<div class="cv-me-history-list">
                ${searchHistory
                  .map(item => `
                    <div class="cv-history-search-row">
                      <a class="cv-history-search-pick" href="catalog.html?q=${encodeURIComponent(item.q)}">
                        <span class="cv-history-search-text">${esc(item.q)}</span>
                      </a>
                      <button type="button" class="cv-history-search-remove" data-me-del-search="${esc(item.q)}" aria-label="Remove ${esc(item.q)}">×</button>
                    </div>
                  `)
                  .join("")}
              </div>`
            : `<p class="cv-me-empty-note">Your search history is empty. Search any movie, drama, or anime to save it here.</p>`
        }
      `;
      return;
    }

    if (meViewMode === "scroll-progress") {
      const cfg = loadScrollProgressConfig();
      const activeTheme = resolveScrollTheme(cfg);
      content.innerHTML = `
        <div class="cv-me-subhead">
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Scroll Progress Bar</button>
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
          <button type="button" class="cv-me-back-btn" data-me-view="hub">‹ Install App &amp; TV Setup</button>
        </div>
        <div class="cv-me-install-box">
          ${deferredPrompt ? `<button type="button" id="cvTriggerPwaInstall" class="cv-discover-cta" style="width:100%;margin-bottom:14px">Install MovieStream BD App</button>` : ""}
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
            <p>Open <b>${esc(location.origin)}</b> in TV Browser or use Chrome <b>Cast…</b> / Screen Mirroring, then switch Player Settings → <b>Landscape</b>.</p>
          </div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="cv-me-hub-card">
        <div class="cv-me-hub-block">
          <button type="button" class="cv-me-hub-row cv-me-hub-head-row" data-me-view="history">
            <span class="cv-me-row-left">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Watch History</span>
            </span>
            <span class="cv-me-chevron">›</span>
          </button>
          ${renderWatchHistoryCards(history)}
        </div>

        <button type="button" class="cv-me-hub-row" data-me-view="search-history">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>Search History</span>
          </span>
          <span class="cv-me-row-right"><span>${searchHistory.length}</span><span class="cv-me-chevron">›</span></span>
        </button>

        <a class="cv-me-hub-row" href="saved.html">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>My List</span>
          </span>
          <span class="cv-me-row-right"><span>${watchlist.length}</span><span class="cv-me-chevron">›</span></span>
        </a>

        <a class="cv-me-hub-row" href="catalog.html?category=%2Fmostwatch%2F7d">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span>New Uploads · Last 24h</span>
          </span>
          <span class="cv-me-row-right"><span id="cvNewUploadsPill" class="cv-me-red-pill">${recentUploadsCount ?? "LIVE"}</span><span class="cv-me-chevron">›</span></span>
        </a>

        <button type="button" class="cv-me-hub-row" data-me-view="scroll-progress">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><rect x="3" y="10" width="18" height="4" rx="2"/><line x1="3" y1="18" x2="15" y2="18"/></svg>
            <span>Scroll Progress Bar</span>
          </span>
          <span class="cv-me-row-right">
            <span>${(() => { const c = loadScrollProgressConfig(); return c.enabled ? `${resolveScrollTheme(c).label} · ${c.height}px` : "Off"; })()}</span>
            <span class="cv-me-chevron">›</span>
          </span>
        </button>

        <button type="button" class="cv-me-hub-row" data-me-view="install">
          <span class="cv-me-row-left">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>Install App &amp; TV Setup</span>
          </span>
          <span class="cv-me-chevron">›</span>
        </button>
      </div>
    `;

    fetchRecentCount().then(cnt => {
      const pill = $("#cvNewUploadsPill");
      if (pill) pill.textContent = String(cnt);
    });
  }

  function showMe() {
    let modal = $("#cvMePanel");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cvMePanel";
      modal.className = "cv-me-panel";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="cv-me-card cv-me-hub-shell" role="dialog" aria-modal="true" aria-label="Account and History Hub">
          <div class="cv-me-topbar-actions">
            <span class="cv-me-shell-brand">MovieStream BD</span>
            <button type="button" class="cv-me-close" aria-label="Close">×</button>
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

  window.addEventListener("cv:search-history-change", () => {
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