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
  const isNigerian = () => false;

  const heroEl = $("#cvHeroSpotlight");
  const catSection = $("#cvCategorySection");
  const catGrid = $("#cvCategoryGrid");
  const sectionsRoot = $("#movieApiSections");
  const statusEl = $("#movieApiStatus");
  const platformEl = $("#cvPlatformsSection");
  const liveSportsEl = $("#cvLiveSportsSection");
  const moreDropdown = $("#cvMoreDropdown");

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const SPORTS_REMINDER_KEY = "cv_sports_reminders_v1";

  const EXPLORE_CATEGORIES = [
    { icon: "🇧🇩", title: "Bangla", href: "catalog.html?category=%2Flanguage%2Fbangla" },
    { icon: "🎙️", title: "Bangla Dubbed", href: "catalog.html?category=%2Flanguage%2Fbangla-dubbed" },
    { icon: "🎧", title: "Dual Audio", href: "catalog.html?category=%2Flanguage%2Fdual-audio" },
    { icon: "🎤", title: "Hindi Dubbed", href: "catalog.html?category=%2Flanguage%2Fhindi-dubbed" },
    { icon: "🎬", title: "Bollywood", href: "catalog.html?category=%2Fbollywood" },
    { icon: "🎥", title: "Hollywood", href: "catalog.html?category=%2Flanguage%2Fenglish" },
    { icon: "🌏", title: "South Indian", href: "catalog.html?category=%2FsouthIndian" },
    { icon: "🇰🇷", title: "K-Drama", href: "catalog.html?category=%2Flanguage%2Fkorean" },
    { icon: "🇨🇳", title: "C-Drama", href: "catalog.html?category=%2Flanguage%2Fchinese" },
    { icon: "🇯🇵", title: "J-Drama", href: "catalog.html?category=%2Flanguage%2Fjapanese-drama" },
    { icon: "🍥", title: "Anime", href: "catalog.html?category=%2Fanime" },
    { icon: "🎨", title: "Animation", href: "catalog.html?category=%2Fgenre%2Fanimation" },
    { icon: "🤼", title: "WWE", href: "catalog.html?category=%2Fcategory%2Fwwe" },
    { icon: "🛡️", title: "MCU", href: "catalog.html?category=%2Fcollection%2Fmcu-marvel-cinematic-universe" },
    { icon: "🦇", title: "DC Universe", href: "catalog.html?category=%2Fcollection%2Fdc-universe-dceu-dcu" },
    { icon: "👻", title: "Horror", href: "catalog.html?category=%2Fgenre%2Fhorror" }
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
  let sportsChannels = [];
  let spotlightSlides = [];
  let spotlightTimer = 0;
  let resumeSpotlightFn = null;
  let detailsModalSeq = 0;
  let isHomeView = true;

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function loadJsonList(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveJsonList(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {}
  }

  function isInWatchlist(path) {
    if (!path) return false;
    return loadJsonList(WATCHLIST_KEY).some(x => x && x.path === path);
  }

  function toggleWatchlist(item) {
    const path = String(item?.path || "");
    if (!path) {
      showToast("Watchlist unavailable for this item");
      return false;
    }
    const list = loadJsonList(WATCHLIST_KEY);
    const exists = list.some(x => x && x.path === path);
    if (exists) {
      saveJsonList(WATCHLIST_KEY, list.filter(x => x && x.path !== path));
      showToast("Removed from My List");
      return false;
    }
    const entry = {
      path,
      title: String(item.title || "Untitled"),
      poster: safeImg(posterOf(item)),
      typeBadge: String(item.typeBadge || item.quality || ""),
      rating: item.rating || "",
      folder: "watchLater",
      savedAt: Date.now()
    };
    saveJsonList(WATCHLIST_KEY, [entry, ...list].slice(0, 100));
    showToast("Saved to My List");
    return true;
  }

  function getSportsReminders() {
    return new Set(loadJsonList(SPORTS_REMINDER_KEY).map(String));
  }

  function toggleSportsReminder(key, matchName) {
    const set = getSportsReminders();
    let added = false;
    if (set.has(key)) {
      set.delete(key);
      showToast(`Reminder removed for ${matchName}`);
    } else {
      set.add(key);
      added = true;
      showToast(`Notification set for ${matchName}`);
    }
    saveJsonList(SPORTS_REMINDER_KEY, [...set].slice(0, 60));
    return added;
  }

  function initialsOf(name) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "SP";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function formatMatchTime(ch) {
    const desc = String(ch?.timeDesc || "").trim();
    if (desc) return desc;
    const rawTs = Number(ch?.startTime || 0);
    if (rawTs > 0) {
      const ms = rawTs < 1e12 ? rawTs * 1000 : rawTs;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        try {
          return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }).format(d);
        } catch {}
      }
    }
    return ch?.live ? "LIVE NOW" : ch?.quality || "Upcoming";
  }

  function parseMatchTeams(ch) {
    let t1 = String(ch?.team1Name || "").trim();
    let t2 = String(ch?.team2Name || "").trim();
    if (!t1 || !t2) {
      const rawName = String(ch?.name || ch?.title || "").replace(/\([^)]*\)$/, "").trim();
      const parts = rawName.split(/\s+vs\.?\s+/i);
      t1 = t1 || parts[0] || "Team A";
      t2 = t2 || parts[1] || "Team B";
    }
    return { t1, t2 };
  }

  function renderLiveSportsSection() {
    if (!liveSportsEl) return;
    if (!isHomeView || !sportsChannels.length) {
      liveSportsEl.hidden = true;
      return;
    }
    const reminders = getSportsReminders();
    const visible = sportsChannels.slice(0, 12);
    liveSportsEl.hidden = false;
    liveSportsEl.innerHTML = `
      <div class="cv-section-header">
        <div class="cv-section-title-group">
          <h2 class="cv-section-title">Live Sports</h2>
        </div>
        <a class="cv-more-link" href="sports.html">All ›</a>
      </div>
      <div class="cv-live-sports-row" role="list" aria-label="Live and upcoming sports matches">
        ${visible.map(ch => {
          const { t1, t2 } = parseMatchTeams(ch);
          const matchKey = String(ch.id || `${t1}-${t2}`).trim();
          const matchHref = `sports.html?match=${encodeURIComponent(matchKey)}`;
          const league = String(ch.leagueName || ch.sportType || ch.category || "Sports").trim();
          const s1 = ch.team1Score !== undefined && ch.team1Score !== "" ? String(ch.team1Score) : "";
          const s2 = ch.team2Score !== undefined && ch.team2Score !== "" ? String(ch.team2Score) : "";
          const hasScore = s1 !== "" && s2 !== "";
          const centerScore = hasScore ? `${s1} - ${s2}` : "VS";
          const timeText = formatMatchTime(ch);
          const logo1 = safeImg(ch.team1Logo || ch.logo);
          const logo2 = safeImg(ch.team2Logo || ch.logo);
          const isLive = Boolean(ch.live);
          const isReminded = reminders.has(matchKey);

          const actionHtml = isLive && ch.streamUrl
            ? `<a class="cv-match-btn cv-match-btn-live" href="${esc(matchHref)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                <span>Watch Live</span>
              </a>`
            : `<button type="button" class="cv-match-btn ${isReminded ? "active" : ""}" data-sports-remind="${esc(matchKey)}" data-sports-name="${esc(`${t1} vs ${t2}`)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span>${isReminded ? "Notified" : "Notify Me"}</span>
              </button>`;

          return `
            <article class="cv-match-card ${isLive ? "is-live" : ""}" role="listitem">
              <div class="cv-match-league">
                <span class="cv-match-dot ${isLive ? "live" : ""}" aria-hidden="true"></span>
                <span class="cv-match-league-name">${esc(league)}</span>
              </div>
              <a class="cv-match-scoreboard" href="${esc(matchHref)}" aria-label="${esc(`${t1} vs ${t2}`)}">
                <div class="cv-match-team">
                  <div class="cv-match-crest">
                    ${logo1 ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(logo1)}" alt="${esc(t1)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span hidden>${esc(initialsOf(t1))}</span>` : `<span>${esc(initialsOf(t1))}</span>`}
                  </div>
                  <span class="cv-match-team-name">${esc(t1)}</span>
                </div>
                <div class="cv-match-center">
                  <b class="cv-match-score tabular-nums">${esc(centerScore)}</b>
                  <span class="cv-match-time tabular-nums">${esc(timeText)}</span>
                </div>
                <div class="cv-match-team">
                  <div class="cv-match-crest">
                    ${logo2 ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(logo2)}" alt="${esc(t2)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span hidden>${esc(initialsOf(t2))}</span>` : `<span>${esc(initialsOf(t2))}</span>`}
                  </div>
                  <span class="cv-match-team-name">${esc(t2)}</span>
                </div>
              </a>
              ${actionHtml}
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderCategories() {
    if (!catGrid) return;
    const perSlide = 4;
    const slides = [];
    for (let i = 0; i < EXPLORE_CATEGORIES.length; i += perSlide) {
      slides.push(EXPLORE_CATEGORIES.slice(i, i + perSlide));
    }

    catGrid.innerHTML = slides
      .map(
        group => `<div class="cv-cat-slide">
          ${group
            .map(
              c => `<a class="cv-cat-card" href="${esc(c.href)}">
                <span class="cv-cat-emoji" aria-hidden="true">${c.icon}</span>
                <div class="cv-cat-copy">
                  <b>${esc(c.title)}</b>
                </div>
                <span class="cv-cat-arrow" aria-hidden="true">›</span>
              </a>`
            )
            .join("")}
        </div>`
      )
      .join("");

    const dotsEl = $("#cvCategoryDots");
    const prevBtn = $("#cvCatPrev");
    const nextBtn = $("#cvCatNext");
    const totalSlides = slides.length;

    if (dotsEl) {
      dotsEl.innerHTML = slides
        .map((_, idx) => `<button type="button" class="cv-cat-dot ${idx === 0 ? "active" : ""}" data-cat-slide="${idx}" aria-label="Category page ${idx + 1}"></button>`)
        .join("");
    }

    const slideWidth = () => {
      const first = catGrid.querySelector(".cv-cat-slide");
      return (first ? first.getBoundingClientRect().width : catGrid.clientWidth) + 12;
    };

    const updateNavState = () => {
      const step = slideWidth();
      const idx = step > 0 ? Math.max(0, Math.min(totalSlides - 1, Math.round(catGrid.scrollLeft / step))) : 0;
      if (dotsEl) {
        dotsEl.querySelectorAll(".cv-cat-dot").forEach((dot, i) => dot.classList.toggle("active", i === idx));
      }
      if (prevBtn) prevBtn.disabled = idx <= 0;
      if (nextBtn) nextBtn.disabled = idx >= totalSlides - 1;
    };

    const goToSlide = idx => {
      const clamped = Math.max(0, Math.min(totalSlides - 1, idx));
      catGrid.scrollTo({ left: clamped * slideWidth(), behavior: "smooth" });
    };

    if (!catGrid.dataset.sliderBound) {
      catGrid.dataset.sliderBound = "1";
      let scrollRaf = 0;
      catGrid.addEventListener(
        "scroll",
        () => {
          if (scrollRaf) cancelAnimationFrame(scrollRaf);
          scrollRaf = requestAnimationFrame(updateNavState);
        },
        { passive: true }
      );
      prevBtn?.addEventListener("click", () => {
        const step = slideWidth();
        const cur = step > 0 ? Math.round(catGrid.scrollLeft / step) : 0;
        goToSlide(cur - 1);
      });
      nextBtn?.addEventListener("click", () => {
        const step = slideWidth();
        const cur = step > 0 ? Math.round(catGrid.scrollLeft / step) : 0;
        goToSlide(cur + 1);
      });
      dotsEl?.addEventListener("click", e => {
        const dot = e.target.closest("[data-cat-slide]");
        if (dot) goToSlide(Number(dot.dataset.catSlide) || 0);
      });
      window.addEventListener("resize", updateNavState, { passive: true });
    }
    updateNavState();
  }

  function renderMoreCategories(cats) {
    const list = Array.isArray(cats) ? cats : [];
    const seen = new Set();
    const deduped = [];
    for (const c of list) {
      const path = String(c?.path || "").trim();
      const label = String(c?.label || "").trim();
      if (!path || !label || seen.has(path)) continue;
      seen.add(path);
      deduped.push({ path, label, group: c.group || "Collections", icon: c.icon || "🎬" });
    }
    if (!deduped.length) return;

    const allCatsLink = $("#cvAllCategoriesLink");
    if (allCatsLink) allCatsLink.textContent = `All Categories (${deduped.length}) ›`;

    const dropBody = $("#cvMoreDropdownBody");
    if (!dropBody) return;
    const groupsOrder = ["Collections", "Languages & Regions", "Genres"];
    const grouped = new Map();
    for (const c of deduped) {
      if (!grouped.has(c.group)) grouped.set(c.group, []);
      grouped.get(c.group).push(c);
    }
    const orderedGroups = [...new Set([...groupsOrder, ...grouped.keys()])].filter(g => grouped.has(g));
    dropBody.innerHTML = orderedGroups
      .map(groupName => {
        const items = grouped.get(groupName) || [];
        return `
          <div class="cv-more-group-label">${esc(groupName)} (${items.length})</div>
          <div class="cv-more-dropdown-grid">
            ${items
              .map(
                c => `<a class="cv-more-item" role="menuitem" href="catalog.html?category=${encodeURIComponent(c.path)}">${esc(c.icon)} ${esc(c.label)}</a>`
              )
              .join("")}
          </div>
        `;
      })
      .join("");
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

  function downloadHref(item) {
    const title = String(item.title || "Untitled").trim();
    const path = String(item.path || "");
    return path
      ? `download.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(title)}`
      : `catalog.html?q=${encodeURIComponent(title)}`;
  }

  function formatRuntime(dur) {
    const n = Number(dur || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    const mins = n > 300 ? Math.round(n / 60) : Math.round(n);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function closeSpotlightDetails() {
    const modal = $("#cvSpotlightDetailsModal");
    if (!modal) return;
    modal.remove();
    document.body.classList.remove("cv-modal-open");
    if (typeof resumeSpotlightFn === "function") resumeSpotlightFn();
  }

  function renderDetailsModalBody(modal, item, detail, isLoading) {
    const d = detail || item || {};
    const title = String(d.title || item.title || "Featured");
    const year = d.year || item.year || "";
    const poster = safeImg(posterOf(d) || posterOf(item));
    const rating = d.rating && Number(d.rating) > 0 ? `★ ${esc(d.rating)}` : "";
    const lang = String(d.language || item.language || "International").split("·")[0].trim();
    const runtime = formatRuntime(d.duration || item.duration);
    const quality = d.quality || item.quality || "HD";
    const country = d.country || item.country || "";
    const genres = String(d.genre || item.genre || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 4).join(" · ");
    const epSummary = Number(d.totalEpisodes) > 1 ? `${d.totalEpisodes} Episodes` : (d.typeBadge || item.typeBadge || "Movie");
    const metaLine = [rating, year, runtime, epSummary, quality, lang, country].filter(Boolean).join(" · ");
    const storyline = String(d.description || item.description || "").trim();
    const dubs = Array.isArray(d.dubs) ? d.dubs.map(x => x.language || x.lanName).filter(Boolean) : [];
    const staff = Array.isArray(d.staff) ? d.staff.filter(st => st && st.name) : [];
    const inList = isInWatchlist(d.path || item.path);

    const bodyEl = modal.querySelector(".cv-details-dynamic");
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <div class="cv-details-hero">
        <div class="cv-details-poster">
          ${poster ? `<img referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(title)}">` : `<div class="cv-card-fallback">${esc(title)}</div>`}
        </div>
        <div class="cv-details-head">
          <h2 id="cvDetailsTitle" class="cv-details-title">${esc(title)}</h2>
          ${metaLine ? `<p class="cv-details-meta tabular-nums">${esc(metaLine)}</p>` : ""}
          ${genres ? `<p class="cv-details-genres">${esc(genres)}</p>` : ""}
          ${dubs.length ? `<p class="cv-details-dubs"><b>Audio:</b> ${esc([...new Set(dubs)].join(", "))}</p>` : ""}
          <div class="cv-details-actions">
            <a class="cv-btn-blue-grad" href="${esc(itemHref(d))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
              <span>Watch Now</span>
            </a>
            <a class="cv-btn-glass" href="${esc(downloadHref(d))}">Download</a>
            <button type="button" class="cv-btn-glass ${inList ? "active" : ""}" data-modal-watchlist>
              ${inList ? "✓ In My List" : "+ My List"}
            </button>
          </div>
        </div>
      </div>

      <div class="cv-details-section">
        <h3>Storyline</h3>
        <p class="cv-details-synopsis">
          ${storyline ? esc(storyline) : (isLoading ? "Loading storyline &amp; cast details…" : "Storyline details are not available for this title yet.")}
        </p>
      </div>

      <div class="cv-details-section">
        <h3>Cast &amp; Crew</h3>
        ${isLoading && !staff.length
          ? `<p class="cv-details-loading">Fetching cast &amp; crew…</p>`
          : staff.length
            ? `<div class="cv-details-cast-row">
                ${staff.slice(0, 16).map(st => {
                  const av = safeImg(st.avatarUrl);
                  return `<a class="cv-details-cast-card" href="catalog.html?q=${encodeURIComponent(st.name)}">
                    <div class="cv-details-cast-avatar">
                      ${av ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(av)}" alt="${esc(st.name)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span hidden>${esc(initialsOf(st.name))}</span>` : `<span>${esc(initialsOf(st.name))}</span>`}
                    </div>
                    <b>${esc(st.name)}</b>
                    <span>${esc(st.role || "Cast")}</span>
                  </a>`;
                }).join("")}
              </div>`
            : `<p class="cv-details-loading">Cast &amp; crew information unavailable.</p>`}
      </div>
    `;

    const wlBtn = bodyEl.querySelector("[data-modal-watchlist]");
    if (wlBtn) {
      wlBtn.onclick = () => {
        const saved = toggleWatchlist(d.path ? d : item);
        wlBtn.classList.toggle("active", saved);
        wlBtn.textContent = saved ? "✓ In My List" : "+ My List";
      };
    }
  }

  async function openSpotlightDetails(item) {
    if (!item) return;
    clearInterval(spotlightTimer);
    closeSpotlightDetails();

    const seq = ++detailsModalSeq;
    const modal = document.createElement("div");
    modal.id = "cvSpotlightDetailsModal";
    modal.className = "cv-details-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "cvDetailsTitle");
    modal.innerHTML = `
      <div class="cv-details-backdrop" data-close-details></div>
      <div class="cv-details-sheet">
        <button type="button" class="cv-details-close" data-close-details aria-label="Close details">×</button>
        <div class="cv-details-dynamic"></div>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.classList.add("cv-modal-open");
    renderDetailsModalBody(modal, item, null, true);

    modal.addEventListener("click", e => {
      if (e.target.closest("[data-close-details]")) closeSpotlightDetails();
    });
    modal.querySelector(".cv-details-close")?.focus();

    if (!item.path && !item.title) {
      renderDetailsModalBody(modal, item, null, false);
      return;
    }

    try {
      const qs = new URLSearchParams();
      if (item.path) qs.set("path", item.path);
      if (item.title) qs.set("title", item.title);
      const r = await fetch(`/api/movie-api/details?${qs.toString()}`);
      const d = await r.json();
      if (seq !== detailsModalSeq || !document.body.contains(modal)) return;
      renderDetailsModalBody(modal, item, d?.ok ? d.detail : null, false);
    } catch {
      if (seq === detailsModalSeq && document.body.contains(modal)) {
        renderDetailsModalBody(modal, item, null, false);
      }
    }
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
    spotlightSlides = slides || [];
    if (!heroEl || !slides.length) {
      if (heroEl) heroEl.hidden = true;
      resumeSpotlightFn = null;
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
              <button type="button" class="cv-btn-glass" data-spot-details="${activeIdx}">More Details</button>
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
      if (slides.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches && !$("#cvSpotlightDetailsModal")) {
        spotlightTimer = setInterval(() => {
          if (!document.hidden && !$("#cvSpotlightDetailsModal")) go(activeIdx + 1);
        }, 7000);
      }
    };
    resumeSpotlightFn = resetTimer;

    heroEl.onclick = e => {
      const detailsBtn = e.target.closest("[data-spot-details]");
      if (detailsBtn) {
        e.preventDefault();
        openSpotlightDetails(slides[Number(detailsBtn.dataset.spotDetails)] || slides[activeIdx]);
        return;
      }
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

    heroEl.onkeydown = e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-spot-card]")) {
        e.preventDefault();
        go(Number(e.target.dataset.spotCard));
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
    isHomeView = true;
    catSection.hidden = false;
    renderPlatforms();
    renderLiveSportsSection();

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
    const mlbdSections = Array.isArray(homeData.mlbdSections) ? homeData.mlbdSections : [];
    const mlbdTop10Sec = mlbdSections.find(s => /top\s*10/i.test(String(s?.title || "")));
    const top10Keys = new Set((mlbdTop10Sec?.items || []).map(x => x?.path || x?.subjectId || x?.title).filter(Boolean));
    const mlbdBanglaRaw = dedupeList([
      ...(Array.isArray(homeData.mlbdBangla) ? homeData.mlbdBangla : []),
      ...mlbdSections.flatMap(s => s.items || []).filter(x => /bangla|bengali/i.test(`${x?.language || ""} ${x?.title || ""}`)),
      ...(Array.isArray(homeData.mlbdTrending) ? homeData.mlbdTrending : [])
    ]);
    const mlbdBanglaDistinct = mlbdBanglaRaw.filter(x => !top10Keys.has(x?.path || x?.subjectId || x?.title));
    const mlbdItems = mlbdBanglaDistinct.length ? mlbdBanglaDistinct : mlbdBanglaRaw;
    const hasLang = (x, re) => re.test([x.language, x.audioLanguage, x.country, x.title, x.genre].filter(Boolean).join(" "));

    const mlbdSectionShelves = mlbdSections
      .map(sec => {
        const cleanTitle = String(sec?.title || "").trim();
        const items = dedupeList(sec?.items || []);
        if (!cleanTitle || !items.length) return null;
        return {
          title: cleanTitle,
          items,
          moreHref: `catalog.html?category=${encodeURIComponent(sec.categoryPath || "/new")}`
        };
      })
      .filter(Boolean);

    const orderedShelves = [
      {
        title: "🔥 Trending Now",
        items: sortNewestFirst(dedupeList(curated.trending?.length ? curated.trending : homeData.trending)),
        moreHref: "catalog.html?category=%2Fmostwatch%2F7d"
      },
      ...(mlbdItems.length
        ? [{
            title: "🟢 Latest & Bangla",
            items: mlbdItems,
            moreHref: "catalog.html?category=%2Flanguage%2Fbangla"
          }]
        : []),
      ...mlbdSectionShelves,
      {
        title: "🏆 Top 10 This Week",
        top10: true,
        items: dedupeList(curated.top10?.length ? curated.top10 : allPool).slice(0, 10),
        moreHref: "catalog.html?category=%2Ftop10"
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

    const normShelfTitle = t => String(t || "").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const usedShelfTitles = new Set();
    const usedCategoryPaths = new Set();
    for (const s of orderedShelves) {
      if (s.items.length > 0) {
        usedShelfTitles.add(normShelfTitle(s.title));
        if (s.moreHref) {
          const catMatch = s.moreHref.match(/category=([^&]+)/);
          if (catMatch) usedCategoryPaths.add(decodeURIComponent(catMatch[1]).toLowerCase());
        }
      }
    }

    const extraLiveSections = (Array.isArray(homeData.sections) ? homeData.sections : [])
      .map(sec => {
        const cleanTitle = String(sec?.title || "").trim();
        const items = dedupeList(sec?.items || []);
        if (!cleanTitle || !items.length) return null;
        const nTitle = normShelfTitle(cleanTitle);
        const catPath = String(sec?.categoryPath || "").trim();
        if (usedShelfTitles.has(nTitle)) return null;
        if (catPath && usedCategoryPaths.has(catPath.toLowerCase())) return null;
        usedShelfTitles.add(nTitle);
        if (catPath) usedCategoryPaths.add(catPath.toLowerCase());
        return {
          title: cleanTitle,
          items: sortNewestFirst(items),
          moreHref: catPath ? `catalog.html?category=${encodeURIComponent(catPath)}` : "catalog.html"
        };
      })
      .filter(Boolean);

    const allShelves = [...orderedShelves, ...extraLiveSections];

    const html = allShelves
      .filter(s => s.items.length > 0)
      .map(s => {
        const visible = s.items.slice(0, s.top10 ? 10 : 24);
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

  async function renderFilteredTab(tabKey, label, appendPage = 1, existingItems = []) {
    isHomeView = false;
    clearInterval(spotlightTimer);
    heroEl.hidden = true;
    catSection.hidden = true;
    if (platformEl) platformEl.hidden = true;
    if (liveSportsEl) liveSportsEl.hidden = true;
    if (appendPage === 1) {
      statusEl.hidden = false;
      statusEl.textContent = `Loading ${label}…`;
      sectionsRoot.innerHTML = "";
    }

    try {
      const endpoint =
        tabKey === "trending"
          ? `/api/movie-api/trending?page=${appendPage}&perPage=30`
          : `/api/movie-api/catalog?category=${encodeURIComponent(tabKey)}&page=${appendPage}`;
      const r = await fetch(endpoint);
      const d = await r.json();
      const incoming = (Array.isArray(d?.items) ? d.items : []).filter(x => x && !isNigerian(x));
      const merged = dedupeList([...existingItems, ...incoming]);
      const items = tabKey === "trending" ? merged : sortNewestFirst(merged);
      const hasMore = Boolean(d?.hasMore || (d?.maxPage && appendPage < Number(d.maxPage)) || incoming.length >= 18);
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
          ${hasMore ? `<div style="display:flex;justify-content:center;padding:20px 0 6px"><button type="button" class="cv-btn-glass" id="cvTabLoadMore">Load More Titles</button></div>` : ""}
        </section>
      `;
      const loadMoreBtn = $("#cvTabLoadMore");
      if (loadMoreBtn) {
        loadMoreBtn.onclick = () => {
          loadMoreBtn.disabled = true;
          loadMoreBtn.textContent = "Loading…";
          renderFilteredTab(tabKey, label, appendPage + 1, items);
        };
      }
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
    const remindBtn = e.target.closest("[data-sports-remind]");
    if (remindBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = remindBtn.dataset.sportsRemind || "";
      const name = remindBtn.dataset.sportsName || "Match";
      const active = toggleSportsReminder(key, name);
      remindBtn.classList.toggle("active", active);
      const labelSpan = remindBtn.querySelector("span");
      if (labelSpan) labelSpan.textContent = active ? "Notified" : "Notify Me";
      return;
    }

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
    if (e.key === "Escape") {
      closeSpotlightDetails();
      closeMoreDropdown();
    }
  });

  window.addEventListener("resize", closeMoreDropdown, { passive: true });

  async function loadSportsPreview() {
    try {
      const r = await fetch("/api/movie-api/sports", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && d?.ok && Array.isArray(d.channels) && d.channels.length) {
        sportsChannels = d.channels;
        renderLiveSportsSection();
      }
    } catch {}
  }

  async function loadAllCategories() {
    try {
      const r = await fetch("/api/movie-api/categories");
      const d = await r.json();
      if (r.ok && d?.ok && Array.isArray(d.categories) && d.categories.length) {
        renderMoreCategories(d.categories);
      }
    } catch {}
  }

  async function init() {
    renderCategories();
    statusEl.hidden = false;
    statusEl.textContent = "Loading featured movies and dramas…";
    loadSportsPreview();
    loadAllCategories();
    try {
      const r = await fetch("/api/movie-api/home");
      const d = await r.json();
      if (!r.ok || d.ok !== true) throw new Error(d.error || "API unavailable");
      homeData = d;
      if (Array.isArray(d.categories) && d.categories.length) {
        renderMoreCategories(d.categories);
      }
      renderHomeView();
    } catch (err) {
      statusEl.textContent = "Could not load catalog: " + (err?.message || "Network error");
    }
  }

  init();
})();
