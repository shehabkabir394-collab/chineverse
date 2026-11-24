(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const imageValue = value => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return imageValue(value[0]);
    if (value && typeof value === "object") return imageValue(value.url || value.src || value.imageUrl || value.image_url || value.original || value.large || value.medium || value.path);
    return "";
  };
  const posterOf = item => imageValue(item?.poster || item?.posterUrl || item?.poster_url || item?.previewImage || item?.preview_image || item?.bannerImage || item?.banner_image || item?.cover || item?.coverUrl || item?.coverImage || item?.image || item?.imageUrl || item?.image_url || item?.thumbnail || item?.thumbnailUrl || item?.thumbnail_url || item?.pic || item?.img);
  const safeImg = u => (/^(?:https?:\/\/|\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");
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
  const moreDropdown = $("#cvMoreDropdown");

  const EXPLORE_CATEGORIES = [
    { icon: "🎬", title: "Bollywood", sub: "বলিউড হিন্দি মুভি", href: "catalog.html?category=%2Fbollywood" },
    { icon: "🎥", title: "Hollywood", sub: "হলিউড ব্লকবাস্টার", href: "catalog.html?category=%2Flanguage%2Fenglish" },
    { icon: "🇮🇳", title: "South Indian", sub: "সাউথ ইন্ডিয়ান অ্যাকশন", href: "catalog.html?category=%2FsouthIndian" },
    { icon: "🇰🇷", title: "Korean Drama", sub: "জনপ্রিয় কে-ড্রামা", href: "catalog.html?category=%2Flanguage%2Fkorean" },
    { icon: "🇨🇳", title: "Chinese Drama", sub: "সি-ড্রামা ও ফ্যান্টাসি", href: "catalog.html?category=%2Flanguage%2Fchinese" },
    { icon: "🇯🇵", title: "Japanese Drama", sub: "জে-ড্রামা ও থ্রিলার", href: "catalog.html?category=%2Flanguage%2Fjapanese-drama" },
    { icon: "🍥", title: "Anime", sub: "অ্যানিমে সিরিজ ও মুভি", href: "catalog.html?category=%2Fanime" },
    { icon: "🇧🇩", title: "Bengali", sub: "বাংলা মুভি ও নাটক", href: "catalog.html?category=%2Flanguage%2Fbengali" }
  ];

  const PLATFORMS = [
    { name: "Netflix", short: "N", logo: "https://www.google.com/s2/favicons?domain=netflix.com&sz=128" },
    { name: "Prime Video", short: "PV", logo: "https://www.google.com/s2/favicons?domain=primevideo.com&sz=128" },
    { name: "Disney+", short: "D+", logo: "https://www.google.com/s2/favicons?domain=disneyplus.com&sz=128" },
    { name: "Hoichoi", short: "H", logo: "https://www.google.com/s2/favicons?domain=hoichoi.tv&sz=128" },
    { name: "Zee5", short: "Z5", logo: "https://www.google.com/s2/favicons?domain=zee5.com&sz=128" },
    { name: "Apple TV+", short: "TV+", logo: "https://www.google.com/s2/favicons?domain=tv.apple.com&sz=128" },
    { name: "Viu", short: "Viu", logo: "https://www.google.com/s2/favicons?domain=viu.com&sz=128" },
    { name: "Hulu", short: "hulu", logo: "https://www.google.com/s2/favicons?domain=hulu.com&sz=128" }
  ];

  const releaseTime = item => {
    const raw = item?.releaseDate || item?.appointmentDate || item?.uploadedAtMs || (item?.year && /^\d{4}$/.test(String(item.year)) ? `${item.year}-01-01` : "");
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
    const t = Date.parse(String(raw || ""));
    return Number.isFinite(t) && t > 0 ? t : 0;
  };

  const sortNewestFirst = list => {
    const now = Date.now();
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const ta = releaseTime(a);
      const tb = releaseTime(b);
      const aFuture = ta > now;
      const bFuture = tb > now;
      if (aFuture !== bFuture) return aFuture ? 1 : -1;
      if (aFuture && bFuture) return ta - tb;
      if (tb !== ta) return tb - ta;
      return (Number(b?.views) || 0) - (Number(a?.views) || 0);
    });
  };

  let homeData = null;
  let spotlightTimer = 0;

  function renderCategories() {
    if (!catGrid) return;
    catGrid.innerHTML = EXPLORE_CATEGORIES.map(
      c => `<a class="cv-cat-card" href="${esc(c.href)}">
        <span class="cv-cat-emoji" aria-hidden="true">${c.icon}</span>
        <div class="cv-cat-copy">
          <b>${esc(c.title)}</b>
          <span>${esc(c.sub)}</span>
        </div>
        <span class="cv-cat-arrow" aria-hidden="true">›</span>
      </a>`
    ).join("");
  }

  function renderPlatforms() {
    if (!platformEl) return;
    platformEl.hidden = false;
    platformEl.innerHTML = `
      <div class="cv-platform-logos-bar" role="list" aria-label="Streaming Platforms">
        ${PLATFORMS.map(
          p => `<a class="cv-platform-logo" role="listitem" href="platform.html?name=${encodeURIComponent(p.name)}" aria-label="${esc(p.name)}" title="${esc(p.name)}">
            <img loading="lazy" referrerpolicy="no-referrer" src="${esc(p.logo)}" alt="${esc(p.name)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false">
            <span class="cv-platform-logo-fallback" hidden>${esc(p.short)}</span>
          </a>`
        ).join("")}
      </div>
    `;
  }

  function itemHref(item) {
    const title = String(item.title || "Untitled").trim();
    const path = String(item.path || "");
    return path
      ? `watch.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(title)}`
      : `catalog.html?q=${encodeURIComponent(title)}`;
  }

  function cardMarkup(item) {
    const title = String(item.title || "Untitled").trim();
    const poster = safeImg(posterOf(item));
    const href = itemHref(item);
    const langTag = String(item.language || item.country || item.typeBadge || "").split("·")[0].trim();
    const rating = item.rating && Number(item.rating) > 0 ? `★ ${esc(item.rating)}` : "";
    const metaParts = [item.year, langTag || item.typeBadge, rating].filter(Boolean).join(" · ");

    return `
      <a class="cv-card" href="${esc(href)}">
        <div class="cv-card-thumb">
          ${poster
            ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(title)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cv-card-fallback" hidden>${esc(title)}</div>`
            : `<div class="cv-card-fallback">${esc(title)}</div>`}
          <div class="cv-card-hover-play" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
          ${item.quality ? `<span class="cv-card-quality">${esc(item.quality)}</span>` : ""}
        </div>
        <h3 class="cv-card-title">${esc(title)}</h3>
        ${metaParts ? `<span class="cv-card-sub tabular-nums">${metaParts}</span>` : ""}
      </a>
    `;
  }

  function cardTop10Markup(item, rank) {
    const title = String(item.title || "Untitled").trim();
    const poster = safeImg(posterOf(item));
    const href = itemHref(item);
    const rating = item.rating && Number(item.rating) > 0 ? `★ ${esc(item.rating)}` : "";
    const metaParts = [item.year, item.typeBadge, rating].filter(Boolean).join(" · ");

    return `
      <a class="cv-card cv-card-top10" href="${esc(href)}">
        <div class="cv-top10-stage">
          <span class="cv-top10-rank tabular-nums" aria-hidden="true">${rank}</span>
          <div class="cv-card-thumb">
            ${poster
              ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(title)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cv-card-fallback" hidden>${esc(title)}</div>`
              : `<div class="cv-card-fallback">${esc(title)}</div>`}
            <div class="cv-card-hover-play" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </div>
        <h3 class="cv-card-title">${esc(title)}</h3>
        ${metaParts ? `<span class="cv-card-sub tabular-nums">${metaParts}</span>` : ""}
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
      const img = safeImg(posterOf(item));
      const title = String(item.title || "Featured");
      const year = item.year ? ` (${item.year})` : "";
      const watchHref = itemHref(item);
      const lang = String(item.language || "International").split("·")[0].trim();
      const ratingHtml = item.rating ? `<span class="cv-star">★ ${esc(item.rating)}</span><span aria-hidden="true">·</span>` : "";

      heroEl.innerHTML = `
        <div class="cv-spotlight-stage">
          ${img ? `<img class="cv-spotlight-bg" decoding="async" referrerpolicy="no-referrer" src="${esc(img)}" alt="${esc(title)}">` : ""}
          <div class="cv-spotlight-scrim" aria-hidden="true"></div>

          <div class="cv-spotlight-top">
            <span class="cv-spotlight-label">FEATURED SPOTLIGHT</span>
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
              ${item.genre ? `<span aria-hidden="true">·</span><span>${esc(String(item.genre).split(",").slice(0, 2).join(" / "))}</span>` : ""}
            </div>
            <div class="cv-spotlight-cta-row">
              <a class="cv-btn-blue-grad" href="${esc(watchHref)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                <span>Watch Now</span>
              </a>
              <a class="cv-btn-glass" href="catalog.html?q=${encodeURIComponent(title)}">More Details</a>
            </div>
          </div>

          <div class="cv-spotlight-strip">
            ${slides
              .map((s, i) => {
                const sImg = safeImg(posterOf(s));
                const sHref = itemHref(s);
                const sMeta = [s.year, String(s.genre || s.typeBadge || "").split(",")[0]].filter(Boolean).join(" · ");
                return `
                  <div class="cv-spot-mini ${i === activeIdx ? "active" : ""}" data-spot-card="${i}" role="button" tabindex="0" aria-label="Select ${esc(s.title || "title")}">
                    ${sImg ? `<img class="cv-spot-mini-thumb" decoding="async" referrerpolicy="no-referrer" src="${esc(sImg)}" alt="">` : `<div class="cv-spot-mini-thumb"></div>`}
                    <div class="cv-spot-mini-info">
                      <b>${esc(s.title || "Featured")}</b>
                      <span>${esc(sMeta || lang)}</span>
                    </div>
                    <a class="cv-spot-play-circle" href="${esc(sHref)}" aria-label="Play ${esc(s.title || "title")}">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </a>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
      const strip = heroEl.querySelector(".cv-spotlight-strip");
      const activeMini = heroEl.querySelector(".cv-spot-mini.active");
      if (strip && activeMini) {
        strip.scrollLeft = Math.max(0, activeMini.offsetLeft - Math.max(0, (strip.clientWidth - activeMini.offsetWidth) / 2));
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
      const playLink = e.target.closest("a");
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

  function dedupeList(list) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || isNigerian(item)) continue;
      const key = item.path || item.subjectId || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function renderHomeView() {
    if (!homeData) return;
    catSection.hidden = false;
    renderPlatforms();

    const bannersRaw = [...(homeData.banners || []), ...(homeData.trending || [])];
    const bannerUniq = dedupeList(bannersRaw).filter(item => safeImg(posterOf(item)) && item.hasResource !== false).slice(0, 7);
    renderSpotlight(bannerUniq);

    const curated = homeData.curated || {};
    const sectionsPool = (Array.isArray(homeData.sections) ? homeData.sections : []).flatMap(s => s.items || []);
    const allPool = dedupeList([
      ...(curated.trending || []),
      ...(homeData.trending || []),
      ...(curated.hindiMovies || []),
      ...(curated.latestMovies || []),
      ...(curated.kDramas || []),
      ...(curated.southIndian || []),
      ...(curated.hollywood || []),
      ...(curated.anime || []),
      ...sectionsPool
    ]);

    const matchAny = (pred) => allPool.filter(pred);
    const hasLang = (x, re) => re.test([x.language, x.audioLanguage, x.country, x.title, x.genre].filter(Boolean).join(" "));

    const orderedShelves = [
      {
        title: "🔥 Trending Now",
        items: sortNewestFirst(dedupeList(curated.trending?.length ? curated.trending : homeData.trending)),
        moreHref: "catalog.html?category=%2Fmostwatch%2F7d"
      },
      {
        title: "🏆 Top 10 This Week",
        top10: true,
        items: dedupeList(curated.top10?.length ? curated.top10 : allPool).slice(0, 10),
        moreHref: "catalog.html?category=%2Fmostwatch%2F7d"
      },
      {
        title: "🇮🇳 Hindi Dubbed Movies",
        items: sortNewestFirst(dedupeList(curated.hindiMovies?.length ? curated.hindiMovies : matchAny(x => (x._hindiCatalog || hasLang(x, /hindi/i)) && !x.isSeries))),
        moreHref: "catalog.html?category=%2Flanguage%2Fhindi-dubbed"
      },
      {
        title: "🎬 Latest Movies",
        items: sortNewestFirst(dedupeList(curated.latestMovies?.length ? curated.latestMovies : matchAny(x => x.type === "movie" || x.isMovie))),
        moreHref: "catalog.html?category=%2Ftype%2Fmovies"
      },
      {
        title: "📺 Hindi Dubbed Web Series",
        items: sortNewestFirst(
          dedupeList(
            curated.hindiSeries?.length
              ? curated.hindiSeries
              : matchAny(x => (x._hindiCatalog || hasLang(x, /hindi/i)) && (x.isSeries || x.type === "series"))
          )
        ),
        moreHref: "catalog.html?category=%2Flanguage%2Fhindi-dubbed-series"
      },
      {
        title: "🇰🇷 Popular K-Dramas",
        items: sortNewestFirst(dedupeList(curated.kDramas?.length ? curated.kDramas : matchAny(x => hasLang(x, /korea/i)))),
        moreHref: "catalog.html?category=%2Flanguage%2Fkorean"
      },
      {
        title: "🌏 South Indian Movies",
        items: sortNewestFirst(dedupeList(curated.southIndian?.length ? curated.southIndian : matchAny(x => hasLang(x, /india|tamil|telugu|malayalam/i)))),
        moreHref: "catalog.html?category=%2FsouthIndian"
      },
      {
        title: "🍥 Anime Collection",
        items: sortNewestFirst(dedupeList(curated.anime?.length ? curated.anime : matchAny(x => x.isAnime || x.type === "anime" || /anime/i.test(x.genre || "")))),
        moreHref: "catalog.html?category=%2Fanime"
      },
      {
        title: "🌍 Hollywood Movies",
        items: sortNewestFirst(dedupeList(curated.hollywood?.length ? curated.hollywood : matchAny(x => hasLang(x, /united states|english|usa/i) && !x.isSeries))),
        moreHref: "catalog.html?category=%2Flanguage%2Fenglish"
      },
      {
        title: "🇧🇩 Bengali Movies",
        items: sortNewestFirst(dedupeList(curated.bengali?.length ? curated.bengali : matchAny(x => hasLang(x, /bengali|bangla|bangladesh/i)))),
        moreHref: "catalog.html?category=%2Flanguage%2Fbengali"
      },
      {
        title: "🆕 Recently Added",
        items: sortNewestFirst(dedupeList(curated.recentlyAdded?.length ? curated.recentlyAdded : allPool)),
        moreHref: "catalog.html?category=%2Fnew"
      },
      {
        title: "🔄 Recently Updated",
        items: sortNewestFirst(dedupeList(curated.recentlyUpdated?.length ? curated.recentlyUpdated : matchAny(x => x.isSeries || x.type === "series"))),
        moreHref: "catalog.html?category=%2Frecently-updated"
      },
      {
        title: "⭐ IMDb Top Rated",
        items: dedupeList(
          curated.imdbTopRated?.length
            ? curated.imdbTopRated
            : [...allPool].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
        ),
        moreHref: "catalog.html?category=%2Ftop-rated"
      },
      {
        title: "⏳ Upcoming Movies",
        items: dedupeList(curated.upcoming?.length ? curated.upcoming : homeData.upcoming),
        moreHref: "catalog.html?category=%2Fupcoming"
      }
    ];

    const html = orderedShelves
      .filter(s => s.items.length > 0)
      .map(s => {
        const visible = s.items.slice(0, s.top10 ? 10 : 14);
        const rowClass = s.top10 ? "cv-shelf-row cv-shelf-top10" : "cv-shelf-row";
        const cardsHtml = s.top10
          ? visible.map((item, idx) => cardTop10Markup(item, idx + 1)).join("")
          : visible.map(cardMarkup).join("");

        return `
          <section class="cv-section">
            <div class="cv-section-header">
              <div class="cv-section-title-group">
                <h2 class="cv-section-title">${esc(s.title)}</h2>
              </div>
              <a class="cv-more-link" href="${esc(s.moreHref)}">View All ›</a>
            </div>
            <div class="${rowClass}">
              ${cardsHtml}
            </div>
          </section>
        `;
      })
      .join("");

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
      const items = sortNewestFirst((Array.isArray(d?.items) ? d.items : []).filter(x => x && !isNigerian(x)));
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

  function closeMoreDropdown() {
    if (!moreDropdown || moreDropdown.hidden) return;
    moreDropdown.hidden = true;
    $$("[data-more-trigger]").forEach(btn => btn.setAttribute("aria-expanded", "false"));
  }

  function openMoreDropdown(trigger) {
    if (!moreDropdown || !trigger) return;
    const isSameOpen = !moreDropdown.hidden && moreDropdown._trigger === trigger;
    if (isSameOpen) {
      closeMoreDropdown();
      return;
    }
    moreDropdown._trigger = trigger;
    moreDropdown.hidden = false;
    $$("[data-more-trigger]").forEach(btn => btn.setAttribute("aria-expanded", btn === trigger ? "true" : "false"));

    const rect = trigger.getBoundingClientRect();
    const dropWidth = Math.min(440, window.innerWidth - 24);
    moreDropdown.style.width = `${dropWidth}px`;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - dropWidth - 12));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 160);
    moreDropdown.style.left = `${left}px`;
    moreDropdown.style.top = `${top}px`;
  }

  function setActiveTab(tabKey) {
    $$("[data-home-tab]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.homeTab === tabKey);
    });
  }

  document.addEventListener("click", e => {
    const moreBtn = e.target.closest("[data-more-trigger]");
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      openMoreDropdown(moreBtn);
      return;
    }
    if (moreDropdown && !moreDropdown.hidden && !e.target.closest("#cvMoreDropdown")) {
      closeMoreDropdown();
    }

    const tabBtn = e.target.closest("button[data-home-tab]");
    if (tabBtn) {
      closeMoreDropdown();
      const tabKey = tabBtn.dataset.homeTab;
      setActiveTab(tabKey);
      if (tabKey === "home") {
        renderHomeView();
      } else {
        renderFilteredTab(tabKey, tabBtn.textContent.trim());
      }
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMoreDropdown();
  });

  window.addEventListener("resize", closeMoreDropdown, { passive: true });

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
