(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const HISTORY_KEY = "cv_watch_history_v1";
  let deferredPrompt = null;
  let meViewMode = "hub"; // "hub" | "history" | "install"
  let recentUploadsCount = null;

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

    // Default Hub View matching reference screenshot WA0067
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
        if (e.target.closest("#cvClearHistoryBtn")) {
          try {
            localStorage.removeItem(HISTORY_KEY);
          } catch {}
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
    }
    meViewMode = "hub";
    modal.hidden = false;
    renderMeContent();
  }

  document.addEventListener("click", e => {
    if (e.target.closest("#cvMeOpen, [data-open-me]")) {
      e.preventDefault();
      showMe();
    }
  });
})();