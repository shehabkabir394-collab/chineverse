(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");
  const RECENT_KEY = "cv_recent_searches_v1";

  function loadRecent() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(list) ? list.filter(x => typeof x === "string" && x.trim()).slice(0, 12) : [];
    } catch {
      return [];
    }
  }

  function saveRecent(term) {
    const clean = String(term || "").trim();
    if (clean.length < 2) return;
    const prev = loadRecent().filter(x => x.toLowerCase() !== clean.toLowerCase());
    const next = [clean, ...prev].slice(0, 10);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }

  function clearRecent() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {}
  }

  function createOverlay() {
    let overlay = $("#cvSearchOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "cvSearchOverlay";
    overlay.className = "cv-search-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Search movies, series, short dramas and anime");

    overlay.innerHTML = `
      <div class="cv-search-overlay-head">
        <button type="button" id="cvSearchBack" class="cv-icon-btn" aria-label="Close search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <form id="cvSearchOverlayForm" class="cv-search-overlay-input-box" role="search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:#98a2b3;flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="cvSearchOverlayInput" type="search" placeholder="Search movies, K-Drama, anime or type…" autocomplete="off" aria-label="Search titles">
          <button type="button" id="cvSearchOverlayClear" class="cv-clear-btn" hidden aria-label="Clear input">×</button>
        </form>
      </div>
      <div class="cv-search-overlay-tabs" role="tablist" aria-label="Filter search by format">
        <button type="button" class="cv-nav-tab active" data-search-type="0" role="tab" aria-selected="true">All</button>
        <button type="button" class="cv-nav-tab" data-search-type="1,2" role="tab" aria-selected="false">Movie/Series</button>
        <button type="button" class="cv-nav-tab" data-search-type="7" role="tab" aria-selected="false">ShortTV</button>
        <button type="button" class="cv-nav-tab" data-search-type="6" role="tab" aria-selected="false">Anime</button>
      </div>
      <div id="cvSearchOverlayBody" class="cv-search-overlay-body"></div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  let activeType = "0";
  let hotCache = null;
  let searchTimer = 0;
  let reqSeq = 0;

  async function fetchHot() {
    if (hotCache) return hotCache;
    try {
      const r = await fetch("/api/movie-api/hot-search");
      const d = await r.json();
      hotCache = Array.isArray(d?.items) ? d.items.filter(x => typeof x === "string" || x?.title).slice(0, 14) : [];
    } catch {
      hotCache = ["Hindi", "Squid Game", "Anime", "K-Drama", "Action", "Bollywood"];
    }
    return hotCache;
  }

  function renderIdleState(body) {
    const recent = loadRecent();
    const hot = hotCache || [];
    body.innerHTML = `
      ${recent.length ? `
        <div class="cv-recent-head">
          <h3>Recent Searches</h3>
          <button type="button" id="cvRecentClearBtn" class="cv-clear-btn">Clear</button>
        </div>
        <div class="cv-chip-wrap">
          ${recent.map(q => `<button type="button" class="cv-search-chip" data-pick-query="${esc(q)}">${esc(q)}</button>`).join("")}
        </div>
      ` : ""}
      <div class="cv-recent-head">
        <h3>Trending Searches</h3>
      </div>
      <div class="cv-chip-wrap">
        ${(hot.length ? hot : ["Hindi", "Action", "Anime", "K-Drama", "Comedy", "Thriller"])
          .map(x => {
            const q = typeof x === "string" ? x : String(x.title || x.word || "");
            return q ? `<button type="button" class="cv-search-chip" data-pick-query="${esc(q)}">${esc(q)}</button>` : "";
          })
          .join("")}
      </div>
    `;
  }

  function renderResults(body, items, query) {
    if (!items.length) {
      body.innerHTML = `
        <div class="cv-status-banner">
          No results found for “${esc(query)}” in this filter. Try switching to <b>All</b> or searching another keyword.
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="cv-recent-head">
        <h3>Results (${items.length})</h3>
        <a class="cv-more-link" href="catalog.html?q=${encodeURIComponent(query)}">Full catalog ›</a>
      </div>
      <div class="cv-search-result-list">
        ${items
          .slice(0, 30)
          .map(item => {
            const img = safeImg(item.poster || item.previewImage || item.cover);
            const path = item.path || "";
            const href = path ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(item.title || "")}` : `catalog.html?q=${encodeURIComponent(item.title || query)}`;
            const rating = item.rating ? `<span class="cv-star">★ ${esc(item.rating)}</span>` : "";
            const meta = [item.year, item.country, item.genre].filter(Boolean).slice(0, 3).map(esc);
            const metaHtml = [rating, ...meta].filter(Boolean).join('<span aria-hidden="true">·</span>');
            return `
              <a class="cv-search-result-row" href="${esc(href)}">
                ${img
                  ? `<img class="cv-search-result-thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(img)}" alt="${esc(item.title || "Poster")}" onerror="this.style.visibility='hidden'">`
                  : `<div class="cv-search-result-thumb"></div>`}
                <div class="cv-search-result-copy">
                  <b>${esc(item.title || "Untitled")}</b>
                  <div class="cv-search-result-meta">
                    <span>${esc(item.typeBadge || "Movie")}</span>
                    ${metaHtml ? `<span aria-hidden="true">·</span>${metaHtml}` : ""}
                  </div>
                </div>
                <span class="cv-search-play-circle" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </span>
              </a>
            `;
          })
          .join("")}
      </div>
    `;
  }

  async function runSearch(query, body) {
    const q = String(query || "").trim();
    if (q.length < 2) {
      await fetchHot();
      renderIdleState(body);
      return;
    }
    const id = ++reqSeq;
    body.innerHTML = `<div class="cv-status-banner">Searching “${esc(q)}”…</div>`;
    try {
      const r = await fetch(`/api/movie-api/search?q=${encodeURIComponent(q)}&subjectType=${encodeURIComponent(activeType)}`);
      const d = await r.json();
      if (id !== reqSeq) return;
      const items = Array.isArray(d?.items) ? d.items : [];
      renderResults(body, items, q);
    } catch {
      if (id !== reqSeq) return;
      body.innerHTML = `<div class="cv-status-banner">Search could not complete right now. Please try again.</div>`;
    }
  }

  function openSearchOverlay(initialQuery = "") {
    const overlay = createOverlay();
    const input = $("#cvSearchOverlayInput");
    const clearBtn = $("#cvSearchOverlayClear");
    const body = $("#cvSearchOverlayBody");

    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (initialQuery) input.value = initialQuery;
    clearBtn.hidden = !input.value;
    setTimeout(() => input.focus(), 40);

    fetchHot().then(() => {
      if (!overlay.hidden) {
        if (input.value.trim().length >= 2) runSearch(input.value, body);
        else renderIdleState(body);
      }
    });
  }

  function closeSearchOverlay() {
    const overlay = $("#cvSearchOverlay");
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = "";
  }

  function bindTriggers() {
    const overlay = createOverlay();
    const input = $("#cvSearchOverlayInput");
    const clearBtn = $("#cvSearchOverlayClear");
    const body = $("#cvSearchOverlayBody");

    // Wire existing search inputs on page (Home, Watch, Catalog)
    document.querySelectorAll("#movieApiSearch, #siteGlobalSearch, [data-open-search]").forEach(el => {
      if (el.tagName === "INPUT") {
        el.addEventListener("focus", () => openSearchOverlay(el.value));
        el.addEventListener("click", () => openSearchOverlay(el.value));
        el.form?.addEventListener("submit", e => {
          e.preventDefault();
          openSearchOverlay(el.value);
        });
      } else {
        el.addEventListener("click", e => {
          e.preventDefault();
          openSearchOverlay("");
        });
      }
    });

    $("#cvSearchBack")?.addEventListener("click", closeSearchOverlay);

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      clearBtn.hidden = true;
      input.focus();
      renderIdleState(body);
    });

    $("#cvSearchOverlayForm")?.addEventListener("submit", e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      saveRecent(q);
      runSearch(q, body);
    });

    input?.addEventListener("input", () => {
      clearBtn.hidden = !input.value;
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 2) {
        renderIdleState(body);
        return;
      }
      searchTimer = setTimeout(() => {
        saveRecent(q);
        runSearch(q, body);
      }, 240);
    });

    overlay.addEventListener("click", e => {
      const tab = e.target.closest("[data-search-type]");
      if (tab) {
        activeType = tab.dataset.searchType || "0";
        overlay.querySelectorAll("[data-search-type]").forEach(t => {
          const active = t === tab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", String(active));
        });
        runSearch(input.value, body);
        return;
      }
      const pick = e.target.closest("[data-pick-query]");
      if (pick) {
        const q = pick.dataset.pickQuery || "";
        input.value = q;
        clearBtn.hidden = !q;
        saveRecent(q);
        runSearch(q, body);
        return;
      }
      if (e.target.closest("#cvRecentClearBtn")) {
        clearRecent();
        renderIdleState(body);
        return;
      }
      const row = e.target.closest(".cv-search-result-row");
      if (row && input.value.trim()) {
        saveRecent(input.value.trim());
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !overlay.hidden) closeSearchOverlay();
    });
  }

  window.CineVerseSearch = { open: openSearchOverlay, close: closeSearchOverlay };
  bindTriggers();
})();
