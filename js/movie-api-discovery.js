(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/|favicon\.svg)/i.test(String(u || "")) ? String(u) : "");
  const rawPosterOf = item => {
    const u = String(item?.rawPoster || "");
    return /^(?:https?:\/\/|\/\/|\/api\/)/i.test(u) ? u : "";
  };
  const RECENT_KEY = "cv_recent_searches_v1";
  const FAMILY_SAFE_KEY = "cv_family_safe_v1";
  const MAX_HISTORY = 15;

  function isFamilySafe() {
    try {
      return localStorage.getItem(FAMILY_SAFE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function isAdultItem(item) {
    if (!item || typeof item !== "object") return false;
    if (item.isAdult === true) return true;
    const hay = `${item.title || ""} ${item.genre || ""} ${item.category || ""} ${item.platform || ""}`;
    return /\b(?:adult|erotic|18\+|xxx|porn|softcore|vivamax)\b/i.test(hay) || /^(?:hot|midnight)$/i.test(String(item.genre || "").trim());
  }

  function isNigerianItem(item) {
    if (!item || typeof item !== "object") return false;
    const country = String(item.country || item.countryName || "").trim();
    if (/\b(?:nigeria|nollywood|ghana)\b/i.test(country)) return true;
    const title = String(item.title || "").trim();
    const hay = `${title} ${item.language || ""} ${item.genre || ""} ${item.platform || ""} ${country} ${item.description || item.storyline || ""}`;
    if (/\b(?:nollywood|nigeria|nigerian|yoruba|igbo|hausa|naija|lagos|abuja|odunlade|funke\s+akindele|iyabo\s+ojo|osita\s+iheme|pete\s+edochie|ramsey\s+nouah|genevieve\s+nnaji|omoni\s+oboli|akotagiri|jagun\s+jagun|anik[uo]lapo|omo\s+ghetto|king\s+of\s+boys)\b/i.test(hay)) return true;
    if (/^(?:akotagiri|save\s+my\s+life\s*2|the\s+wrong\s+boyfriend|love\s+is\s+blind|husband\s+on\s+lease)$/i.test(title) && !/\b(?:india|korean|japan|china|bangla|hindi|united\s+states|uk|turkey)\b/i.test(`${country} ${item.language || ""}`)) return true;
    return false;
  }

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
    if (clean.length < 1) return;
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

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
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
    overlay.setAttribute("aria-label", "Search movies, series, drama and anime");

    overlay.innerHTML = `
      <div class="cv-search-overlay-head">
        <button type="button" id="cvSearchBack" class="cv-search-back-btn" aria-label="Close search">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <form id="cvSearchOverlayForm" class="cv-search-overlay-input-box" role="search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:#8b95a7;flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="cvSearchOverlayInput" type="search" placeholder="Search movies, series, south movie, anime…" autocomplete="off" aria-label="Search titles">
          <button type="button" id="cvSearchOverlayClear" class="cv-search-input-clear" hidden aria-label="Clear input">×</button>
          <button type="submit" class="cv-search-inline-submit">Search</button>
        </form>
        <button type="button" id="cvSearchMicBtn" class="cv-search-mic-btn" aria-label="Voice search" title="Voice search">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 1 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z"/></svg>
        </button>
      </div>
      <div id="cvSearchResultsTabs" class="cv-search-overlay-tabs" role="tablist" aria-label="Filter search results" hidden>
        <button type="button" class="cv-search-tab active" data-search-type="0" role="tab" aria-selected="true">All</button>
        <button type="button" class="cv-search-tab" data-search-type="1" role="tab" aria-selected="false">Movie</button>
        <button type="button" class="cv-search-tab" data-search-type="2" role="tab" aria-selected="false">Series</button>
        <button type="button" class="cv-search-tab" data-search-type="6" role="tab" aria-selected="false">Anime</button>
        <button type="button" class="cv-search-tab" data-search-type="2,7" role="tab" aria-selected="false">Drama</button>
      </div>
      <div id="cvSearchOverlayBody" class="cv-search-overlay-body"></div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  let activeType = "0";
  let activeRankTab = "movie";
  let hotCache = null;
  let hotSubjectsCache = [];
  let rankingsCache = { movie: [], series: [], anime: [], drama: [] };
  let searchTimer = 0;
  let reqSeq = 0;
  let activeSearchCtrl = null;
  let hotLoadedSafeState = null;

  async function fetchHot(force = false) {
    const safe = isFamilySafe();
    if (!force && hotCache && hotLoadedSafeState === safe) return hotCache;
    try {
      const r = await fetch(`/api/movie-api/hot-search${safe ? "?safe=1" : ""}`);
      const d = await r.json();
      hotLoadedSafeState = safe;
      hotCache = Array.isArray(d?.items) ? d.items.filter(x => typeof x === "string" || (x?.title && !isNigerianItem(x))).slice(0, 14) : [];
      hotSubjectsCache = Array.isArray(d?.subjects) ? d.subjects.filter(x => !isNigerianItem(x) && (!safe || !isAdultItem(x))).slice(0, 12) : [];
      const rk = d?.rankings || {};
      const cleanList = list => (Array.isArray(list) ? list : []).filter(x => !isNigerianItem(x) && (!safe || !isAdultItem(x))).slice(0, 12);
      rankingsCache = {
        movie: cleanList(rk.movie?.length ? rk.movie : hotSubjectsCache),
        series: cleanList(rk.series),
        anime: cleanList(rk.anime),
        drama: cleanList(rk.drama)
      };
    } catch {
      hotCache = ["South Indian Hindi", "Bangla Movies", "K-Drama", "Hindi Dubbed", "Anime Hindi Dub", "Web Series"];
      hotSubjectsCache = [];
      rankingsCache = { movie: [], series: [], anime: [], drama: [] };
    }
    return hotCache;
  }

  function renderRankingCards() {
    const list = rankingsCache[activeRankTab] || [];
    if (!list.length) {
      return `<div class="cv-status-banner" style="margin-top:10px">Loading top ${esc(activeRankTab)} charts…</div>`;
    }
    const tvSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`;
    const chunks = [];
    for (let i = 0; i < list.length; i += 3) {
      chunks.push(list.slice(i, i + 3));
    }

    return `
      <div class="cv-rank-scroller" id="cvRankScroller">
        ${chunks
          .map((group, groupIdx) => `
            <div class="cv-rank-card">
              ${group
                .map((item, idxInGroup) => {
                  const rank = groupIdx * 3 + idxInGroup + 1;
                  const rankClass = rank === 1 ? "r1" : rank === 2 ? "r2" : rank === 3 ? "r3" : "rn";
                  const img = safeImg(item.poster || item.previewImage || item.cover || item.rawPoster);
                  const rawFb = rawPosterOf(item);
                  const fbAttr = rawFb && rawFb !== img ? ` data-fallback-src="${esc(rawFb)}"` : "";
                  const path = item.path || "";
                  const href = path
                    ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(item.title || "")}`
                    : `catalog.html?q=${encodeURIComponent(item.title || "")}`;
                  const langLabel = String(item.language || "").split("·")[0].trim() || item.typeBadge || "HD";
                  const ratingHtml = item.rating && Number(item.rating) > 0
                    ? `<span class="cv-rank-star">★ ${esc(item.rating)}</span>`
                    : "";
                  const metaParts = [
                    item.year,
                    item.country,
                    item.genre ? String(item.genre).split(",")[0].trim() : ""
                  ].filter(Boolean).slice(0, 3).map(esc);
                  const metaTail = [ratingHtml, ...metaParts].filter(Boolean).join(`<span class="cv-rank-sep">|</span>`);
                  return `
                    <a class="cv-rank-row" href="${esc(href)}">
                      <div class="cv-rank-thumb-wrap">
                        ${img
                          ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(img)}"${fbAttr} data-poster-img="1" alt="${esc(item.title || "")}"><div class="cv-rank-thumb-fallback" hidden>▶</div>`
                          : `<div class="cv-rank-thumb-fallback">▶</div>`}
                        <span class="cv-rank-badge ${rankClass}">${rank}</span>
                        <span class="cv-rank-thumb-lang">${esc(langLabel)}</span>
                      </div>
                      <div class="cv-rank-copy">
                        <b>${esc(item.title || "Untitled")}</b>
                        <div class="cv-rank-meta">
                          <span class="cv-rank-tv">${tvSvg}</span>
                          ${metaTail || `<span>${esc(item.typeBadge || "Movie")}</span>`}
                        </div>
                      </div>
                    </a>
                  `;
                })
                .join("")}
            </div>
          `)
          .join("")}
      </div>
    `;
  }

  function renderIdleState(body) {
    const resultsTabs = $("#cvSearchResultsTabs");
    if (resultsTabs) resultsTabs.hidden = true;

    const history = loadHistory();
    const hot = hotCache || [];
    const trashSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const flameSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.5 2C12.5 2 18 6.4 18 12.2a6 6 0 1 1-12 0c0-2.6 1.2-5.1 2.7-6.8 0 0 .2 2.4 1.8 2.9-.2-2.7 1-5 2-6.3z" fill="#f97316"/><path d="M12 10.5c1.8 1.5 2.5 3.1 2.5 4.7a2.5 2.5 0 1 1-5 0c0-1.1.5-2.1 1.3-2.9 0 0 .2 1 1 1.2-.1-1 .1-2 .2-3z" fill="#fde047"/></svg>`;
    const chartSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="11" width="4.5" height="9" rx="1" fill="#ec4899"/><rect x="9.75" y="5" width="4.5" height="15" rx="1" fill="#f43f5e"/><rect x="16.5" y="14" width="4.5" height="6" rx="1" fill="#ec4899"/></svg>`;

    const rankTabs = [
      { key: "movie", label: "Movie" },
      { key: "series", label: "Series" },
      { key: "anime", label: "Anime" },
      { key: "drama", label: "Drama" }
    ];

    body.innerHTML = `
      ${history.length ? `
        <div class="cv-recent-head">
          <h3>Recent</h3>
          <button type="button" id="cvRecentClearBtn" class="cv-search-clear-action">
            ${trashSvg}
            <span>Clear</span>
          </button>
        </div>
        <div class="cv-chip-wrap">
          ${history
            .map(item => `<button type="button" class="cv-search-chip" data-pick-query="${esc(item.q)}">${esc(item.q)}</button>`)
            .join("")}
        </div>
      ` : ""}

      <div class="cv-recent-head cv-hot-head">
        <span class="cv-hot-title-group">
          ${flameSvg}
          <h3>Everyone is searching</h3>
        </span>
      </div>
      <div class="cv-chip-wrap">
        ${(hot.length ? hot : ["South Indian Hindi", "Bangla Movies", "K-Drama", "Hindi Dubbed", "Anime Hindi Dub"])
          .map(x => {
            const q = typeof x === "string" ? x : String(x.title || x.word || "");
            return q ? `<button type="button" class="cv-search-chip" data-pick-query="${esc(q)}">${esc(q)}</button>` : "";
          })
          .join("")}
      </div>

      <div class="cv-rank-header">
        <span class="cv-rank-chart-icon">${chartSvg}</span>
        <div class="cv-rank-tabs" role="tablist" aria-label="Trending rankings">
          ${rankTabs
            .map(t => `<button type="button" class="cv-rank-tab ${activeRankTab === t.key ? "active" : ""}" data-rank-tab="${t.key}" role="tab" aria-selected="${activeRankTab === t.key ? "true" : "false"}">${t.label}</button>`)
            .join("")}
        </div>
      </div>
      <div id="cvRankPanel">${renderRankingCards()}</div>
    `;
  }

  function renderResults(body, items, query, suggestions = []) {
    const resultsTabs = $("#cvSearchResultsTabs");
    if (resultsTabs) resultsTabs.hidden = false;

    const safe = isFamilySafe();
    const visibleItems = (Array.isArray(items) ? items : []).filter(it => !isNigerianItem(it) && (!safe || !isAdultItem(it)));

    const suggTitles = [...new Set([
      ...(Array.isArray(suggestions) ? suggestions : []),
      ...visibleItems.map(it => it.title)
    ].map(s => String(s || "").trim()).filter(s => s && s.toLowerCase() !== String(query || "").trim().toLowerCase()))].slice(0, 8);

    const suggStrip = suggTitles.length
      ? `<div class="cv-search-sugg-wrap">
          <div class="cv-search-sugg-label">Suggestions</div>
          <div class="cv-search-sugg-list">
            ${suggTitles.map(title => `<button type="button" class="cv-search-sugg-btn" data-pick-query="${esc(title)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span>${esc(title)}</span></button>`).join("")}
          </div>
        </div>`
      : "";

    const historyMatches = loadHistory()
      .filter(h => h.q.toLowerCase().includes(query.toLowerCase()) && h.q.toLowerCase() !== query.toLowerCase())
      .slice(0, 4);

    const historyStrip = historyMatches.length
      ? `<div class="cv-chip-wrap" style="margin-bottom:14px">
          ${historyMatches.map(h => `<button type="button" class="cv-search-chip" data-pick-query="${esc(h.q)}">↺ ${esc(h.q)}</button>`).join("")}
        </div>`
      : "";

    if (!visibleItems.length) {
      body.innerHTML = `
        ${suggStrip}
        ${historyStrip}
        <div class="cv-status-banner">
          ${safe ? `No Family-Safe results found for “${esc(query)}”.` : `No results found for “${esc(query)}” in this tab. Try tapping a suggestion above or switching to <b>All</b>.`}
        </div>
      `;
      return;
    }

    body.innerHTML = `
      ${suggStrip}
      ${historyStrip}
      <div class="cv-recent-head">
        <h3>Search Results (${visibleItems.length})</h3>
        <a class="cv-more-link" data-save-search href="catalog.html?q=${encodeURIComponent(query)}">Full catalog ›</a>
      </div>
      <div class="cv-search-result-list">
        ${visibleItems
          .slice(0, 50)
          .map(item => {
            const img = safeImg(item.poster || item.previewImage || item.cover || item.rawPoster);
            const rawFb = rawPosterOf(item);
            const fbAttr = rawFb && rawFb !== img ? ` data-fallback-src="${esc(rawFb)}"` : "";
            const path = item.path || "";
            const href = path
              ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(item.title || "")}`
              : `catalog.html?q=${encodeURIComponent(item.title || query)}`;
            const rating = item.rating ? `<span class="cv-star">★ ${esc(item.rating)}</span>` : "";
            const meta = [item.year, item.language ? String(item.language).split("·")[0].trim() : "", item.country, item.genre]
              .filter(Boolean)
              .slice(0, 3)
              .map(esc);
            const metaHtml = [rating, ...meta].filter(Boolean).join('<span aria-hidden="true">·</span>');
            return `
              <a class="cv-search-result-row" href="${esc(href)}">
                ${img
                  ? `<img class="cv-search-result-thumb" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(img)}"${fbAttr} data-poster-img="1" alt="${esc(item.title || "Poster")}">`
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
    if (!q) {
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

    const resultsTabs = $("#cvSearchResultsTabs");
    if (resultsTabs) resultsTabs.hidden = false;
    body.innerHTML = `<div class="cv-status-banner">Searching “${esc(q)}”…</div>`;

    const safeQs = isFamilySafe() ? "&safe=1" : "";
    const typeQs = `&subjectType=${encodeURIComponent(activeType)}`;

    try {
      const [suggRes, searchRes] = await Promise.allSettled([
        fetchSearchJson(`/api/suggest?q=${encodeURIComponent(q)}${typeQs}${safeQs}`, ctrl?.signal),
        fetchSearchJson(`/api/movie-api/search?q=${encodeURIComponent(q)}${typeQs}${safeQs}`, ctrl?.signal)
      ]);
      if (id !== reqSeq) return;

      const mergedMap = new Map();
      const addAll = list => {
        for (const it of Array.isArray(list) ? list : []) {
          if (!it || isNigerianItem(it)) continue;
          const k = it.path || it.subjectId || String(it.title || "").toLowerCase();
          if (k && !mergedMap.has(k)) mergedMap.set(k, it);
        }
      };

      const searchData = searchRes.status === "fulfilled" ? searchRes.value : null;
      const suggData = suggRes.status === "fulfilled" ? suggRes.value : null;
      addAll(searchData?.items);
      addAll(suggData?.items);

      let items = [...mergedMap.values()];
      const suggestions = [
        ...(Array.isArray(suggData?.suggestions) ? suggData.suggestions : []),
        ...(Array.isArray(searchData?.suggestions) ? searchData.suggestions : [])
      ];

      if (!items.length && !searchData && !suggData) {
        const catData = await fetchSearchJson(`/api/catalog?path=%2Fsearch&q=${encodeURIComponent(q)}`, ctrl?.signal);
        if (id !== reqSeq) return;
        addAll(catData?.items);
        items = [...mergedMap.values()];
      }
      renderResults(body, items, q, suggestions);
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
        if (input.value.trim().length >= 1) runSearch(input.value, body);
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

  function startVoiceSearch(input, clearBtn, body) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast("Voice search is not supported in this browser");
      input?.focus();
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      showToast("Listening… Speak movie or drama title");
      rec.onresult = ev => {
        const transcript = String(ev?.results?.[0]?.[0]?.transcript || "").trim();
        if (!transcript) return;
        input.value = transcript;
        clearBtn.hidden = false;
        saveRecent(transcript, activeType);
        runSearch(transcript, body);
      };
      rec.onerror = () => {
        showToast("Could not hear voice input. Try typing.");
      };
      rec.start();
    } catch {
      showToast("Microphone access unavailable");
    }
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

    $("#cvSearchMicBtn")?.addEventListener("click", () => {
      startVoiceSearch(input, clearBtn, body);
    });

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
      if (!q) {
        renderIdleState(body);
        return;
      }
      searchTimer = setTimeout(() => {
        runSearch(q, body);
      }, 240);
    });

    overlay.addEventListener("click", e => {
      const rankTab = e.target.closest("[data-rank-tab]");
      if (rankTab) {
        activeRankTab = rankTab.dataset.rankTab || "movie";
        overlay.querySelectorAll("[data-rank-tab]").forEach(t => {
          const active = t === rankTab;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", String(active));
        });
        const panel = $("#cvRankPanel");
        if (panel) panel.innerHTML = renderRankingCards();
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

    window.addEventListener("cv:family-safe-change", () => {
      hotCache = null;
      if (!overlay.hidden) {
        fetchHot(true).then(() => {
          if (input.value.trim()) runSearch(input.value, body);
          else renderIdleState(body);
        });
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
    clearHistory: clearRecent,
    isFamilySafe
  };
  if (!window.__cvPosterRecoveryInstalled) {
    window.__cvPosterRecoveryInstalled = true;
    document.addEventListener("error", e => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.posterImg) return;
      const fb = img.dataset.fallbackSrc || "";
      if (fb && !img.dataset.triedFb) {
        img.dataset.triedFb = "1";
        img.src = fb;
        return;
      }
      const sib = img.nextElementSibling;
      if (sib && (sib.classList?.contains("cv-card-fallback") || sib.classList?.contains("cv-rank-thumb-fallback"))) {
        img.style.display = "none";
        sib.hidden = false;
      } else {
        img.style.visibility = "hidden";
      }
    }, true);
  }

  function bindSpeculativePrefetch() {
    const prefetched = new Set();
    let lastAt = 0;
    const isSaver = () => {
      try {
        if (navigator.connection?.saveData) return true;
        if (localStorage.getItem("cv_playback_quality_mode_v1") === "data-saver") return true;
      } catch {}
      return false;
    };
    const maybePrefetch = target => {
      if (isSaver()) return;
      const now = Date.now();
      if (now - lastAt < 120) return;
      const a = target?.closest?.("a[href]");
      if (!a) return;
      const rawHref = a.getAttribute("href") || "";
      if (!rawHref || rawHref.startsWith("#") || /^(?:https?:|mailto:|tel:|javascript:)/i.test(rawHref)) return;
      let u;
      try { u = new URL(rawHref, location.href); } catch { return; }
      if (u.origin !== location.origin) return;

      if (u.pathname.endsWith("/watch.html") || u.pathname === "/watch.html") {
        const p = u.searchParams.get("path") || "";
        const t = u.searchParams.get("title") || "";
        if (!/^\/(?:mb|mlbd|movie|series|drama|anime)\//i.test(p)) return;
        const cacheKey = `watch:${p}`;
        if (prefetched.has(cacheKey)) return;
        prefetched.add(cacheKey);
        lastAt = now;
        fetch(`/api/movie-api/details?path=${encodeURIComponent(p)}&title=${encodeURIComponent(t)}`, { priority: "low" })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (d?.ok && d?.detail && d.detail.hasResource !== false && Array.isArray(d.detail.episodes) && d.detail.episodes.length > 0) {
              try {
                const m = JSON.parse(sessionStorage.getItem("cv_watch_detail_v1") || "{}");
                delete m[p];
                m[p] = { ts: Date.now(), detail: d.detail };
                const ks = Object.keys(m);
                while (ks.length > 8) delete m[ks.shift()];
                sessionStorage.setItem("cv_watch_detail_v1", JSON.stringify(m));
              } catch {}
            }
          })
          .catch(() => {});
      } else if (u.pathname.endsWith("/catalog.html") || u.pathname === "/catalog.html") {
        if (u.searchParams.has("q")) return;
        const cat = u.searchParams.get("category") || "/all";
        const pg = Math.max(1, Number(u.searchParams.get("page")) || 1);
        const cacheKey = `cat:${cat}:${pg}`;
        if (prefetched.has(cacheKey)) return;
        prefetched.add(cacheKey);
        lastAt = now;
        fetch(`/api/movie-api/catalog?category=${encodeURIComponent(cat)}&page=${pg}`, { priority: "low" }).catch(() => {});
      }
    };
    document.addEventListener("pointerdown", e => maybePrefetch(e.target), { passive: true, capture: true });
    document.addEventListener("mouseenter", e => maybePrefetch(e.target), { passive: true, capture: true });
  }

  bindTriggers();
  bindSpeculativePrefetch();
})();
