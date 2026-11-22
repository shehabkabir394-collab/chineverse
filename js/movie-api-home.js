(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const isNigerian = item =>
    /nigeria|nigerian|nollywood|naija/i.test(
      [item?.country, item?.title, item?.language, item?.description].filter(Boolean).join(" ")
    );

  const heroEl = $("#cvHeroSpotlight");
  const catSection = $("#cvCategorySection");
  const catGrid = $("#cvCategoryGrid");
  const sectionsRoot = $("#movieApiSections");
  const statusEl = $("#movieApiStatus");
  const platformEl = $("#cvPlatformsSection");
  const navTabs = $("#cvHomeNavTabs");

  const CATEGORIES = [
    { title: "Hollywood", sub: "হলিউড মুভি", href: "catalog.html?category=%2Flanguage%2Fenglish" },
    { title: "Bollywood", sub: "বলিউড হিন্দি", href: "catalog.html?category=%2Fbollywood" },
    { title: "Bengali Movies", sub: "বাংলা মুভি ও নাটক", href: "catalog.html?category=%2Flanguage%2Fbengali" },
    { title: "Hindi Dubbed", sub: "হিন্দি ডাবড", href: "catalog.html?category=%2Flanguage%2Fhindi-dubbed" },
    { title: "K-Drama", sub: "কোরিয়ান ড্রামা", href: "catalog.html?category=%2Flanguage%2Fkorean" },
    { title: "C-Drama", sub: "চাইনিজ ড্রামা", href: "catalog.html?category=%2Flanguage%2Fchinese" },
    { title: "Anime", sub: "অ্যানিমে ও কার্টুন", href: "catalog.html?category=%2Fanime" },
    { title: "Live Sports", sub: "লাইভ ফুটবল ও ম্যাচ", href: "sports.html" }
  ];

  const PLATFORMS = [
    { name: "Netflix", logo: "https://www.google.com/s2/favicons?domain=netflix.com&sz=64" },
    { name: "Hoichoi", logo: "https://www.google.com/s2/favicons?domain=hoichoi.tv&sz=64" },
    { name: "Zee5", logo: "https://www.google.com/s2/favicons?domain=zee5.com&sz=64" },
    { name: "Prime Video", logo: "https://www.google.com/s2/favicons?domain=primevideo.com&sz=64" },
    { name: "Disney+", logo: "https://www.google.com/s2/favicons?domain=disneyplus.com&sz=64" },
    { name: "Apple TV+", logo: "https://www.google.com/s2/favicons?domain=tv.apple.com&sz=64" }
  ];

  let homeData = null;
  let spotlightTimer = 0;

  function renderCategories() {
    if (!catGrid) return;
    catGrid.innerHTML = CATEGORIES.map(
      c => `<a class="cv-cat-card" href="${esc(c.href)}"><b>${esc(c.title)}</b><span>${esc(c.sub)}</span></a>`
    ).join("");
  }

  function renderPlatforms() {
    if (!platformEl) return;
    platformEl.hidden = false;
    platformEl.innerHTML = `
      <div class="cv-section-header">
        <div class="cv-section-title-group">
          <h2 class="cv-section-title">Streaming Platforms</h2>
          <span class="cv-section-sub">· Explore OTT originals</span>
        </div>
      </div>
      <div class="cv-platform-strip">
        ${PLATFORMS.map(
          p => `<a class="cv-platform-pill" href="platform.html?name=${encodeURIComponent(p.name)}">
            <img loading="lazy" referrerpolicy="no-referrer" src="${esc(p.logo)}" alt="" onerror="this.style.display='none'">
            <span>${esc(p.name)}</span>
          </a>`
        ).join("")}
      </div>
    `;
  }

  function cardMarkup(item) {
    const title = String(item.title || "Untitled").trim();
    const path = String(item.path || "");
    const poster = safeImg(item.poster || item.previewImage || item.cover);
    const href = path ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(title)}` : `catalog.html?q=${encodeURIComponent(title)}`;
    const langTag = String(item.language || item.country || item.typeBadge || "").split("·")[0].trim();
    const rating = item.rating && Number(item.rating) > 0 ? `★ ${esc(item.rating)}` : "";
    const subParts = [item.year, item.typeBadge].filter(Boolean).join(" · ");

    return `
      <a class="cv-card" href="${esc(href)}">
        <div class="cv-card-thumb">
          ${poster
            ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(title)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cv-card-fallback" hidden>${esc(title)}</div>`
            : `<div class="cv-card-fallback">${esc(title)}</div>`}
          <div class="cv-card-top">
            ${langTag ? `<span class="cv-card-lang">${esc(langTag)}</span>` : ""}
            ${rating ? `<span class="cv-card-rate">${rating}</span>` : ""}
          </div>
        </div>
        <h3 class="cv-card-title">${esc(title)}</h3>
        ${subParts ? `<span class="cv-card-sub tabular-nums">${esc(subParts)}</span>` : ""}
      </a>
    `;
  }

  function renderSpotlight(slides) {
    if (!heroEl || !slides.length) {
      if (heroEl) heroEl.hidden = true;
      return;
    }
    heroEl.hidden = false;
    let activeIdx = 0;

    const draw = () => {
      const item = slides[activeIdx];
      const img = safeImg(item.poster || item.previewImage || item.cover);
      const title = String(item.title || "Featured");
      const year = item.year ? ` (${item.year})` : "";
      const path = String(item.path || "");
      const watchHref = path ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(title)}` : `catalog.html?q=${encodeURIComponent(title)}`;
      const lang = String(item.language || "International").split("·")[0].trim();
      const ratingHtml = item.rating ? `<span class="cv-star">★ ${esc(item.rating)}</span><span aria-hidden="true">·</span>` : "";

      heroEl.innerHTML = `
        <div class="cv-spotlight-stage">
          ${img ? `<img class="cv-spotlight-bg" referrerpolicy="no-referrer" src="${esc(img)}" alt="${esc(title)}">` : ""}
          <div class="cv-spotlight-scrim" aria-hidden="true"></div>

          <div class="cv-spotlight-top">
            <span class="cv-spotlight-label">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.7 3.2-.8 5.4-2.5 7.2-1.4 1.5-2.5 2.8-2.5 4.8a5 5 0 0 0 10 0c0-3.4-2.2-6.1-5-12Z"/></svg>
              SPOTLIGHT
            </span>
            <div class="cv-spotlight-dots">
              ${slides
                .map((_, i) => `<button type="button" class="cv-spotlight-dot ${i === activeIdx ? "active" : ""}" data-spot-dot="${i}" aria-label="Spotlight slide ${i + 1}"></button>`)
                .join("")}
            </div>
          </div>

          <div class="cv-spotlight-content">
            <h1 class="cv-spotlight-title">${esc(title)}${esc(year)}</h1>
            <div class="cv-spotlight-meta">
              ${ratingHtml}
              <span class="cv-lang-text">${esc(lang)}</span>
              <span aria-hidden="true">·</span>
              <span>${esc(item.quality || "1080p HD")}</span>
            </div>
          </div>

          <div class="cv-spotlight-strip">
            ${slides
              .map((s, i) => {
                const sImg = safeImg(s.poster || s.previewImage || s.cover);
                const sPath = String(s.path || "");
                const sHref = sPath ? `watch.html?path=${encodeURIComponent(sPath)}&title=${encodeURIComponent(s.title || "")}` : watchHref;
                const sMeta = [s.year, String(s.genre || s.typeBadge || "").split(",")[0]].filter(Boolean).join(" · ");
                return `
                  <div class="cv-spot-mini ${i === activeIdx ? "active" : ""}" data-spot-card="${i}" role="button" tabindex="0" aria-label="Select ${esc(s.title || "title")}">
                    ${sImg ? `<img class="cv-spot-mini-thumb" referrerpolicy="no-referrer" src="${esc(sImg)}" alt="">` : `<div class="cv-spot-mini-thumb"></div>`}
                    <div class="cv-spot-mini-info">
                      <b>${esc(s.title || "Featured")}</b>
                      <span>${esc(sMeta || lang)}</span>
                    </div>
                    <a class="cv-spot-play-circle" href="${esc(sHref)}" aria-label="Play ${esc(s.title || "title")}">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </a>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
      const activeMini = heroEl.querySelector(".cv-spot-mini.active");
      if (activeMini) {
        activeMini.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    };

    const go = idx => {
      activeIdx = (idx + slides.length) % slides.length;
      draw();
      resetTimer();
    };

    const resetTimer = () => {
      clearInterval(spotlightTimer);
      if (slides.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        spotlightTimer = setInterval(() => {
          if (!document.hidden) go(activeIdx + 1);
        }, 7000);
      }
    };

    heroEl.onclick = e => {
      const dot = e.target.closest("[data-spot-dot]");
      if (dot) {
        go(Number(dot.dataset.spotDot));
        return;
      }
      const playLink = e.target.closest("a.cv-spot-play-circle");
      if (playLink) return;
      const mini = e.target.closest("[data-spot-card]");
      if (mini) {
        const idx = Number(mini.dataset.spotCard);
        if (idx === activeIdx) {
          const link = mini.querySelector("a.cv-spot-play-circle");
          if (link) location.href = link.href;
        } else {
          go(idx);
        }
      }
    };

    let startX = 0;
    heroEl.addEventListener("pointerdown", e => { startX = e.clientX; }, { passive: true });
    heroEl.addEventListener("pointerup", e => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 55 && !e.target.closest(".cv-spotlight-strip")) {
        go(activeIdx + (dx < 0 ? 1 : -1));
      }
    }, { passive: true });

    draw();
    resetTimer();
  }

  function renderHomeView() {
    if (!homeData) return;
    catSection.hidden = false;
    renderPlatforms();

    const bannersRaw = [...(homeData.banners || []), ...(homeData.trending || [])];
    const bannerUniq = new Map();
    for (const item of bannersRaw) {
      if (!item || isNigerian(item)) continue;
      const key = item.path || item.subjectId || item.title;
      if (key && safeImg(item.poster || item.previewImage) && !bannerUniq.has(key)) {
        bannerUniq.set(key, item);
      }
      if (bannerUniq.size >= 7) break;
    }
    renderSpotlight([...bannerUniq.values()]);

    const renderedIds = new Set();
    const buildShelf = (title, sub, items, moreHref) => {
      const filtered = (Array.isArray(items) ? items : []).filter(item => {
        if (!item || isNigerian(item)) return false;
        const key = item.path || item.subjectId || item.title;
        if (!key || renderedIds.has(key)) return false;
        renderedIds.add(key);
        return true;
      });
      if (!filtered.length) return "";
      const visible = filtered.slice(0, 14);
      return `
        <section class="cv-section">
          <div class="cv-section-header">
            <div class="cv-section-title-group">
              <h2 class="cv-section-title">${esc(title)}</h2>
              ${sub ? `<span class="cv-section-sub">· ${esc(sub)}</span>` : ""}
            </div>
            <a class="cv-more-link" href="${esc(moreHref)}">More ›</a>
          </div>
          <div class="cv-shelf-row">
            ${visible.map(cardMarkup).join("")}
          </div>
        </section>
      `;
    };

    const rawSections = Array.isArray(homeData.sections) ? homeData.sections : [];
    let html = "";

    // Prioritize popular & South Asia / Hindi / K-Drama / Movie / Anime shelves cleanly
    const trending = Array.isArray(homeData.trending) ? homeData.trending : [];
    const hindiSection = rawSections.find(s => /hindi/i.test(s.title));
    if (hindiSection) {
      html += buildShelf("Hindi Dubbed Movies & Series", "হিন্দি ডাবড", hindiSection.items, "catalog.html?category=%2Flanguage%2Fhindi-dubbed");
    }
    if (trending.length) {
      html += buildShelf("Trending Now", "জনপ্রিয়", trending, "catalog.html?category=%2Fmostwatch%2F7d");
    }

    for (const s of rawSections) {
      if (s === hindiSection) continue;
      const t = String(s.title || "Featured").trim();
      if (/nollywood|black shows|bl story/i.test(t)) continue;
      const target = s.categoryPath || "/type/movies";
      html += buildShelf(t, "", s.items, `catalog.html?category=${encodeURIComponent(target)}`);
    }

    sectionsRoot.innerHTML = html || `<div class="cv-status-banner">No titles available right now.</div>`;
    statusEl.hidden = true;
  }

  async function renderFilteredTab(tabKey, label) {
    clearInterval(spotlightTimer);
    heroEl.hidden = true;
    catSection.hidden = true;
    if (platformEl) platformEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = `Loading ${label}…`;
    sectionsRoot.innerHTML = "";

    try {
      const endpoint =
        tabKey === "trending"
          ? "/api/movie-api/trending?page=1&perPage=24"
          : `/api/movie-api/catalog?category=${encodeURIComponent(tabKey)}&page=1`;
      const r = await fetch(endpoint);
      const d = await r.json();
      const items = (Array.isArray(d?.items) ? d.items : []).filter(x => x && !isNigerian(x));
      statusEl.hidden = true;
      sectionsRoot.innerHTML = `
        <section class="cv-section">
          <div class="cv-section-header">
            <div class="cv-section-title-group">
              <h2 class="cv-section-title">${esc(label)}</h2>
              <span class="cv-section-sub tabular-nums">· ${items.length} titles</span>
            </div>
            <a class="cv-more-link" href="${tabKey === "trending" ? "catalog.html?category=%2Fmostwatch%2F7d" : `catalog.html?category=${encodeURIComponent(tabKey)}`}">View A–Z ›</a>
          </div>
          ${items.length ? `<div class="cv-poster-grid">${items.map(cardMarkup).join("")}</div>` : `<div class="cv-status-banner">No titles found in ${esc(label)}.</div>`}
        </section>
      `;
    } catch {
      statusEl.textContent = `Could not load ${label}. Please try again.`;
    }
  }

  navTabs?.addEventListener("click", e => {
    const btn = e.target.closest("button[data-home-tab]");
    if (!btn) return;
    navTabs.querySelectorAll(".cv-nav-tab").forEach(t => t.classList.toggle("active", t === btn));
    const tabKey = btn.dataset.homeTab;
    if (tabKey === "home") {
      renderHomeView();
    } else {
      renderFilteredTab(tabKey, btn.textContent.trim());
    }
  });

  async function init() {
    renderCategories();
    statusEl.hidden = false;
    statusEl.textContent = "Loading featured movies and dramas…";
    try {
      const r = await fetch("/api/movie-api/home");
      const d = await r.json();
      if (!r.ok || d.ok !== true) throw new Error(d.error || "API unavailable");
      homeData = d;
      renderHomeView();
    } catch (err) {
      statusEl.textContent = "Could not load catalog: " + (err?.message || "Network error");
    }
  }

  init();
})();
