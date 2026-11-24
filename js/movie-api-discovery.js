(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");
  const RECENT_KEY = "cv_recent_searches_v1";
  const MAX_HISTORY = 15;

  function normalizeEntry(raw) {
    if (typeof raw === "string") {
      const q = raw.trim();
      return q ? { q, type: "0", ts: 0 } : null;
    }
    if (raw && typeof raw === "object") {
      const q = String(raw.q || raw.query || "").trim();
      if (!q) return null;
      return {
        q,
        type: String(raw.type || "0"),
        ts: Number(raw.ts) || 0
      };
    }
    return null;
  }

  function loadHistory() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (!Array.isArray(list)) return [];
      const seen = new Set();
      const out = [];
      for (const raw of list) {
        const entry = normalizeEntry(raw);
        if (!entry) continue;
        const key = entry.q.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        if (out.length >= MAX_HISTORY) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function persistHistory(list) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
    } catch {}
    window.dispatchEvent(new CustomEvent("cv:search-history-change"));
  }

  function saveRecent(term, type = activeType) {
    const clean = String(term || "").trim();
    if (clean.length < 2) return;
    const prev = loadHistory().filter(x => x.q.toLowerCase() !== clean.toLowerCase());
    const next = [{ q: clean, type: String(type || "0"), ts: Date.now() }, ...prev].slice(0, MAX_HISTORY);
    persistHistory(next);
  }

  function removeRecent(term) {
    const target = String(term || "").trim().toLowerCase();
    if (!target) return;
    const next = loadHistory().filter(x => x.q.toLowerCase() !== target);
    persistHistory(next);
  }

  function clearRecent() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent("cv:search-history-change"));
  }

  function formatAgo(ts) {
    if (!ts) return "";
    const diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
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
  let hotSubjectsCache = [];
  let searchTimer = 0;
  let reqSeq = 0;
  let activeSearchCtrl = null;

  async function fetchHot() {
    if (hotCache) return hotCache;
    try {
      const r = await fetch("/api/movie-api/hot-search");
      const d = await r.json();
      hotCache = Array.isArray(d?.items) ? d.items.filter(x => typeof x === "string" || x?.title).slice(0, 14) : [];
      hotSubjectsCache = Array.isArray(d?.subjects) ? d.subjects.slice(0, 10) : [];
    } catch {
      hotCache = ["Hindi Dubbed Movies", "Hindi Dubbed Series", "South Indian Hindi Dubbed", "K-Drama Hindi", "Anime Hindi Dub", "Bollywood Hindi"];
      hotSubjectsCache = [];
    }
    return hotCache;
  }

  function renderIdleState(body) {
    const history = loadHistory();
    const hot = hotCache || [];
    const clockSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    const suggestedCardsHtml = hotSubjectsCache.length
      ? `
        <div class="cv-recent-head" style="margin-top:20px">
          <h3>Suggested Hindi Dubbed Movies &amp; Dramas</h3>
          <a class="cv-more-link" href="catalog.html?category=%2Flanguage%2Fhindi-dubbed">View All ›</a>
        </div>
        <div class="cv-search-result-list">
          ${hotSubjectsCache.slice(0, 8).map(item => {
            const img = safeImg(item.poster || item.previewImage || item.cover);
            const path = item.path || "";
            const href = path ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(item.title || "")}` : `catalog.html?q=${encodeURIComponent(item.title || "")}`;
            const rating = item.rating ? `<span class="cv-star">★ ${esc(item.rating)}</span>` : "";
            const meta = [item.year, "Hindi Dubbed", item.genre].filter(Boolean).slice(0, 3).map(esc);
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
          }).join("")}
        </div>
      `
      : "";

    body.innerHTML = `
      ${history.length ? `
        <div class="cv-recent-head">
          <h3>Search History (${history.length})</h3>
          <button type="button" id="cvRecentClearBtn" class="cv-clear-btn">Clear All</button>
        </div>
        <div class="cv-history-search-list">
          ${history.map(item => {
            const ago = formatAgo(item.ts);
            return `
              <div class="cv-history-search-row">
                <button type="button" class="cv-history-search-pick" data-pick-query="${esc(item.q)}">
                  <span class="cv-history-search-icon" aria-hidden="true">${clockSvg}</span>
                  <span class="cv-history-search-text">${esc(item.q)}</span>
                  ${ago ? `<span class="cv-history-search-time">${esc(ago)}</span>` : ""}
                </button>
                <button type="button" class="cv-history-search-remove" data-remove-history="${esc(item.q)}" aria-label="Remove ${esc(item.q)} from search history" title="Remove">×</button>
              </div>
            `;
          }).join("")}
        </div>
      ` : `
        <div class="cv-status-banner" style="margin-bottom:18px">
          Your recent searches will appear here automatically.
        </div>
      `}
      <div class="cv-recent-head">
        <h3>Hindi Dubbed Suggestions</h3>
      </div>
      <div class="cv-chip-wrap">
        ${(hot.length ? hot : ["Hindi Dubbed Movies", "Hindi Dubbed Series", "South Indian Hindi Dubbed", "K-Drama Hindi", "Anime Hindi Dub"])
          .map(x => {
            const q = typeof x === "string" ? x : String(x.title || x.word || "");
            return q ? `<button type="button" class="cv-search-chip" data-pick-query="${esc(q)}">${esc(q)}</button>` : "";
          })
          .join("")}
      </div>
      ${suggestedCardsHtml}
    `;
  }

  function renderResults(body, items, query) {
    const historyMatches = loadHistory()
      .filter(h => h.q.toLowerCase().includes(query.toLowerCase()) && h.q.toLowerCase() !== query.toLowerCase())
      .slice(0, 4);

    const historyStrip = historyMatches.length
      ? `<div class="cv-chip-wrap" style="margin-bottom:14px">
          ${historyMatches.map(h => `<button type="button" class="cv-search-chip" data-pick-query="${esc(h.q)}">↺ ${esc(h.q)}</button>`).join("")}
        </div>`
      : "";

    if (!items.length) {
      body.innerHTML = `
        ${historyStrip}
        <div class="cv-status-banner">
          No results found for “${esc(query)}” in this filter. Try switching to <b>All</b> or searching another keyword.
        </div>
      `;
      return;
    }

    body.innerHTML = `
      ${historyStrip}
      <div class="cv-recent-head">
        <h3>Results (${items.length})</h3>
        <a class="cv-more-link" data-save-search href="catalog.html?q=${encodeURIComponent(query)}">Full catalog ›</a>
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

  async function fetchSearchJson(url, signal) {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal
    });
    const text = await r.text();
    let d = null;
    try {
      d = JSON.parse(text);
    } catch {
      throw new Error(`Invalid search response (${r.status})`);
    }
    if (!r.ok || d?.ok === false) {
      throw new Error(d?.error || `HTTP ${r.status}`);
    }
    return d;
  }

  async function runSearch(query, body) {
    const q = String(query || "").trim();
    if (q.length < 2) {
      if (activeSearchCtrl) {
        try { activeSearchCtrl.abort(); } catch {}
        activeSearchCtrl = null;
      }
      await fetchHot();
      renderIdleState(body);
      return;
    }
    const id = ++reqSeq;
    if (activeSearchCtrl) {
      try { activeSearchCtrl.abort(); } catch {}
    }
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    activeSearchCtrl = ctrl;
    body.innerHTML = `<div class="cv-status-banner">Searching “${esc(q)}”…</div>`;

    const candidates = activeType === "0"
      ? [
          `/api/suggest?q=${encodeURIComponent(q)}`,
          `/api/movie-api/search?q=${encodeURIComponent(q)}&subjectType=0`,
          `/api/catalog?path=%2Fsearch&q=${encodeURIComponent(q)}`
        ]
      : [
          `/api/movie-api/search?q=${encodeURIComponent(q)}&subjectType=${encodeURIComponent(activeType)}`,
          `/api/suggest?q=${encodeURIComponent(q)}`
        ];

    try {
      let data = null;
      let lastErr = null;
      for (const endpoint of candidates) {
        try {
          const d = await fetchSearchJson(endpoint, ctrl?.signal);
          if (id !== reqSeq) return;
          data = d;
          if (Array.isArray(d?.items) && d.items.length > 0) break;
        } catch (err) {
          if (err?.name === "AbortError" || id !== reqSeq) return;
          lastErr = err;
        }
      }
      if (id !== reqSeq) return;
      if (!data) throw lastErr || new Error("Search failed");
      const items = Array.isArray(data?.items) ? data.items : [];
      renderResults(body, items, q);
    } catch (err) {
      if (err?.name === "AbortError" || id !== reqSeq) return;
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
    if (typeof initialQuery === "string" && initialQuery.trim()) {
      input.value = initialQuery;
    }
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

    document.querySelectorAll("#movieApiSearch, #siteGlobalSearch, [data-open-search]").forEach(el => {
      if (el.tagName === "INPUT") {
        el.addEventListener("focus", () => openSearchOverlay(el.value));
        el.addEventListener("click", () => openSearchOverlay(el.value));
        el.form?.addEventListener("submit", e => {
          e.preventDefault();
          const q = el.value.trim();
          if (q) saveRecent(q);
          openSearchOverlay(q);
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
      saveRecent(q, activeType);
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
        runSearch(q, body);
      }, 240);
    });

    overlay.addEventListener("click", e => {
      const removeBtn = e.target.closest("[data-remove-history]");
      if (removeBtn) {
        e.stopPropagation();
        removeRecent(removeBtn.dataset.removeHistory || "");
        renderIdleState(body);
        return;
      }
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
        saveRecent(q, activeType);
        runSearch(q, body);
        return;
      }
      if (e.target.closest("#cvRecentClearBtn")) {
        clearRecent();
        renderIdleState(body);
        return;
      }
      if (e.target.closest(".cv-search-result-row") || e.target.closest("[data-save-search]")) {
        if (input.value.trim()) saveRecent(input.value.trim(), activeType);
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !overlay.hidden) closeSearchOverlay();
    });
  }

  window.CineVerseSearch = {
    open: openSearchOverlay,
    close: closeSearchOverlay,
    getHistory: loadHistory,
    saveHistory: saveRecent,
    removeHistory: removeRecent,
    clearHistory: clearRecent
  };
  bindTriggers();
})();
