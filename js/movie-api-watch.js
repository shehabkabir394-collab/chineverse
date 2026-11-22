(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const WATCHLIST_KEY = "cv_watchlist_v1";

  const params = new URLSearchParams(location.search);
  const path = params.get("path") || "";
  const requestedTitle = params.get("title") || "";
  const root = $("#movieWatchRoot");
  const statusEl = $("#movieWatchStatus");

  let watchDetail = null;
  let episodes = [];
  let currentDubs = [];
  let playerApi = null;
  let selectedEpIdx = 0;
  let selectedSeasonNum = 0;
  let showAllEpisodes = false;
  let streamReqId = 0;

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function getWatchlist() {
    try {
      const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function isInWatchlist() {
    return getWatchlist().some(x => x.path === path);
  }

  function toggleWatchlist() {
    const list = getWatchlist();
    const exists = list.some(x => x.path === path);
    const next = exists
      ? list.filter(x => x.path !== path)
      : [{ path, title: watchDetail?.title || requestedTitle || "Saved Title", poster: watchDetail?.poster || "" }, ...list].slice(0, 40);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
    } catch {}
    syncWatchlistButtons();
    showToast(exists ? "Removed from your list" : "Added to your list");
  }

  function syncWatchlistButtons() {
    const active = isInWatchlist();
    const topBtn = $("#cvWatchTopList");
    const actionBtn = $("#cvWatchActionList");
    if (topBtn) topBtn.classList.toggle("active", active);
    if (actionBtn) {
      actionBtn.classList.toggle("active", active);
      actionBtn.innerHTML = active
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg><span>In my list</span>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg><span>Add to list</span>`;
    }
  }

  async function shareCurrentTitle() {
    const title = watchDetail?.title || requestedTitle || "MovieStream BD";
    const url = location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("Watch link copied to clipboard");
    } catch {
      showToast("Copy link from your browser address bar");
    }
  }

  function renderEpisodeButtons(seasonGroups) {
    const strip = $("#cvEpisodeStrip");
    if (!strip) return;
    const activeGroup = seasonGroups.get(selectedSeasonNum) || [...seasonGroups.values()][0] || [];
    strip.classList.toggle("expanded", showAllEpisodes);

    const allBtn =
      activeGroup.length > 1
        ? `<button type="button" class="cv-ep-btn ${showAllEpisodes ? "active" : ""}" id="cvToggleAllEps">All</button>`
        : "";
    const btns = activeGroup
      .map(({ ep, idx }) => {
        const labelNum = String(ep.episodeNumber || ep.number || idx + 1).padStart(2, "0");
        return `<button type="button" class="cv-ep-btn ${idx === selectedEpIdx ? "active" : ""}" data-watch-ep="${idx}" aria-label="Play episode ${labelNum}">${labelNum}</button>`;
      })
      .join("");

    strip.innerHTML = activeGroup.length <= 1 && watchDetail?.isMovie ? `<button type="button" class="cv-ep-btn active" data-watch-ep="0">Full Movie</button>` : allBtn + btns;
  }

  async function playEpisode(idx) {
    const ep = episodes[idx];
    if (!ep) return;
    selectedEpIdx = idx;
    const reqId = ++streamReqId;
    const video = $("#movieWatchVideo");
    const streamMsg = $("#cvStreamStatusText");
    if (streamMsg) streamMsg.textContent = "Loading video stream…";

    root.querySelectorAll("[data-watch-ep]").forEach(b => b.classList.toggle("active", Number(b.dataset.watchEp) === idx));
    const dlBtn = $("#movieWatchDownload");
    if (dlBtn) {
      dlBtn.href = `download.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(watchDetail?.title || "")}&episode=${idx}`;
    }

    const se = Number(ep.seasonNumber ?? ep.se ?? 0) || 0;
    const epNum = ep.ep != null ? Number(ep.ep) : Number(ep.episodeNumber ?? ep.number ?? 1);

    try {
      const qs = new URLSearchParams({
        subjectId: String(watchDetail?.subjectId || watchDetail?.id || ""),
        detailPath: String(watchDetail?.detailPath || ""),
        title: String(watchDetail?.title || ""),
        se: String(se),
        ep: String(epNum)
      });
      const r = await fetch(`/api/movie-api/stream?${qs.toString()}`, { cache: "no-store" });
      const payload = await r.json();
      if (reqId !== streamReqId) return;

      const streamRoot = payload.stream || payload;
      const rawSources = Array.isArray(streamRoot.sources) ? streamRoot.sources : [];
      const sources = rawSources
        .filter(s => s?.url)
        .map(s => ({
          url: s.url,
          quality: String(s.quality || s.resolution || "720p"),
          provider: s.provider || "MovieBox Direct",
          mime: s.type || "video/mp4",
          audioLanguage: s.audioLanguage || ""
        }));

      const subtitles = Array.isArray(streamRoot.subtitles) ? streamRoot.subtitles : [];

      if (!sources.length) {
        if (streamMsg) streamMsg.textContent = "No playable MP4 source was returned for this episode.";
        return;
      }

      if (streamMsg) {
        streamMsg.textContent = `${sources.map(s => s.quality).join(" · ")}${subtitles.length ? ` · ${subtitles.length} subtitles` : ""}`;
      }

      if (playerApi) {
        playerApi.setSources(sources);
        playerApi.setSubtitles(subtitles);
      } else if (video && window.CineVersePlayer) {
        video.hidden = false;
        playerApi = window.CineVersePlayer.mount({
          video,
          sources,
          subtitles,
          storageKey: `cv-mb-${watchDetail?.subjectId || path}-${se}-${epNum}`,
          title: watchDetail?.title || "Now Playing",
          backUrl: "./"
        });
      }
    } catch {
      if (reqId === streamReqId && streamMsg) {
        streamMsg.textContent = "Stream temporarily unavailable. Try another episode or version.";
      }
    }
  }

  async function loadRelated(detail) {
    const grid = $("#cvForYouGrid");
    if (!grid) return;
    let items = [];
    try {
      const r = await fetch(`/api/movie-api/related?subjectId=${encodeURIComponent(detail.subjectId || "")}&title=${encodeURIComponent(detail.title || "")}`);
      const d = await r.json();
      items = Array.isArray(d?.items) ? d.items : [];
    } catch {}

    if (!items.length) {
      try {
        const hr = await fetch("/api/movie-api/home");
        const hd = await hr.json();
        items = [...(hd?.trending || []), ...(hd?.sections?.[0]?.items || [])];
      } catch {}
    }

    const usable = items.filter(x => x?.path && x.path !== path).slice(0, 12);
    if (!usable.length) {
      grid.innerHTML = `<div class="cv-status-banner">No related recommendations available.</div>`;
      return;
    }

    grid.innerHTML = usable
      .map(x => {
        const poster = safeImg(x.poster || x.previewImage || x.cover);
        const lang = String(x.language || x.typeBadge || "").split("·")[0].trim();
        const rate = x.rating && Number(x.rating) > 0 ? `★ ${esc(x.rating)}` : "";
        return `
          <a class="cv-card" href="watch.html?path=${encodeURIComponent(x.path)}&title=${encodeURIComponent(x.title || "")}">
            <div class="cv-card-thumb">
              ${poster
                ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(x.title || "")}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cv-card-fallback" hidden>${esc(x.title || "")}</div>`
                : `<div class="cv-card-fallback">${esc(x.title || "")}</div>`}
              <div class="cv-card-top">
                ${lang ? `<span class="cv-card-lang">${esc(lang)}</span>` : ""}
                ${rate ? `<span class="cv-card-rate">${rate}</span>` : ""}
              </div>
            </div>
            <h3 class="cv-card-title">${esc(x.title || "Untitled")}</h3>
          </a>
        `;
      })
      .join("");
  }

  async function loadComments(detail) {
    const box = $("#cvReviewsPanel");
    if (!box || !detail?.subjectId) return;
    try {
      const r = await fetch(`/api/movie-api/comments?subjectId=${encodeURIComponent(detail.subjectId)}&page=1`);
      const d = await r.json();
      const rows = Array.isArray(d?.comments) ? d.comments : [];
      box.innerHTML = rows.length
        ? rows
            .slice(0, 20)
            .map(
              c => `<article class="cv-comment-item">
                <b>${esc(c.userName || "Viewer")}</b>
                <p>${esc(c.content || "")}</p>
                ${c.createdAt ? `<small>${esc(c.createdAt)}</small>` : ""}
              </article>`
            )
            .join("")
        : `<div class="cv-status-banner">No viewer reviews posted yet for this title.</div>`;
    } catch {
      box.innerHTML = `<div class="cv-status-banner">Reviews are currently unavailable.</div>`;
    }
  }

  async function load() {
    if (!/^\/(?:mb|movie|series)\/[a-zA-Z0-9_./-]{1,300}$/.test(path)) {
      statusEl.textContent = "Invalid title URL. Returning to home or select another title.";
      return;
    }

    try {
      const r = await fetch(`/api/movie-api/details?path=${encodeURIComponent(path)}&title=${encodeURIComponent(requestedTitle)}`, {
        cache: "no-store"
      });
      const data = await r.json();
      if (!r.ok || !data?.detail) throw new Error(data?.error || "Title details unavailable.");

      const d = data.detail;
      watchDetail = d;
      episodes = Array.isArray(d.episodes) && d.episodes.length ? d.episodes : [{ label: d.title || "Play", number: 1, seasonNumber: 0, episodeNumber: 1, se: 0, ep: 0 }];
      currentDubs = Array.isArray(d.dubs) ? d.dubs : [];
      document.title = `${d.title || "Watch"} — MovieStream BD`;

      const seasonGroups = new Map();
      episodes.forEach((ep, idx) => {
        const sNum = Number(ep.seasonNumber ?? ep.se ?? 0) || 0;
        if (!seasonGroups.has(sNum)) seasonGroups.set(sNum, []);
        seasonGroups.get(sNum).push({ ep, idx });
      });
      const seasonKeys = [...seasonGroups.keys()].sort((a, b) => a - b);
      selectedSeasonNum = seasonKeys[0] ?? 0;

      const isSeries = seasonKeys.some(k => k > 0) || episodes.length > 1;
      const seasonsLabel = isSeries ? `${seasonKeys.filter(k => k > 0).length || 1} season${seasonKeys.length > 1 ? "s" : ""}` : "Feature Film";
      const metaItems = [
        d.rating ? `<span class="cv-star">★ ${esc(d.rating)}</span>` : "",
        d.year ? `<span>${esc(d.year)}</span>` : "",
        d.language ? `<span>${esc(String(d.language).split("·")[0].trim())}</span>` : "",
        d.genre ? `<span>${esc(String(d.genre).split(",")[0].trim())}</span>` : "",
        `<span>${esc(seasonsLabel)}</span>`
      ].filter(Boolean);

      const dubChoices = currentDubs.filter(x => x?.path);
      const dubSelectHtml =
        dubChoices.length > 1
          ? `<select id="cvDubSelect" class="cv-select" aria-label="Select audio language">
              ${dubChoices.map(x => `<option value="${esc(x.path)}" ${x.path === path ? "selected" : ""}>${esc(x.language || x.lanName || "Audio")}</option>`).join("")}
            </select>`
          : `<select id="cvDubSelect" class="cv-select" aria-label="Audio language">
              <option value="${esc(path)}">${esc(d.language || "Original Audio")}</option>
            </select>`;

      const seasonSelectHtml =
        seasonKeys.length > 1 || (seasonKeys.length === 1 && seasonKeys[0] > 0)
          ? `<select id="cvSeasonSelect" class="cv-select" aria-label="Select season">
              ${seasonKeys.map(s => `<option value="${s}" ${s === selectedSeasonNum ? "selected" : ""}>Season ${String(s || 1).padStart(2, "0")}</option>`).join("")}
            </select>`
          : "";

      const staffList = Array.isArray(d.staff) ? d.staff.slice(0, 12) : [];
      const poster = safeImg(d.poster);

      statusEl.hidden = true;
      root.innerHTML = `
        <div class="cv-watch-grid">
          <div class="cv-watch-primary-col">
            <div class="cv-player-stage ms-watch-player">
              <video id="movieWatchVideo" class="movie-player" controls playsinline preload="metadata" ${poster ? `poster="${esc(poster)}"` : ""}></video>
            </div>

            <div class="cv-watch-info-pad">
              <div class="cv-watch-title-row">
                <h1 class="cv-watch-title">${esc(d.title || "Untitled")}</h1>
                <button type="button" id="cvToggleInfoBtn" class="cv-info-toggle" aria-expanded="false">Info ›</button>
              </div>

              <div class="cv-watch-meta-line">
                <span aria-hidden="true">📺</span>
                ${metaItems.map(m => `<span aria-hidden="true">|</span>${m}`).join("")}
              </div>

              <div id="cvSynopsisBox" class="cv-watch-synopsis" hidden>
                <p style="margin:0 0 8px">${esc(d.storyline || d.description || "No synopsis available for this title.")}</p>
                <div style="font-size:12px;color:#98a2b3">
                  ${[d.country ? `Country: ${d.country}` : "", d.genre ? `Genre: ${d.genre}` : "", d.releaseDate ? `Released: ${d.releaseDate}` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>

              <div class="cv-watch-actions-row">
                <button type="button" id="cvWatchActionList" class="cv-action-btn"></button>
                <button type="button" id="cvWatchActionShare" class="cv-action-btn">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  <span>Share</span>
                </button>
                <a id="movieWatchDownload" class="cv-action-btn" href="download.html?path=${encodeURIComponent(path)}&title=${encodeURIComponent(d.title || "")}&episode=0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Download</span>
                </a>
              </div>
              <div id="cvStreamStatusText" style="margin-top:8px;font-size:12px;color:#98a2b3" aria-live="polite">Preparing stream…</div>
            </div>
          </div>

          <aside class="cv-resources-panel">
            <div class="cv-resources-head">
              <h2>Resources</h2>
              <span>Verified · MovieBox Direct</span>
            </div>
            <div class="cv-resources-selects">
              ${dubSelectHtml}
              ${seasonSelectHtml}
            </div>
            <div id="cvEpisodeStrip" class="cv-ep-strip"></div>
          </aside>
        </div>

        <div class="cv-watch-tabs-bar" role="tablist" aria-label="Related titles, cast and reviews">
          <button type="button" class="cv-watch-tab-btn active" data-watch-tab="foryou" role="tab" aria-selected="true">For you</button>
          <button type="button" class="cv-watch-tab-btn" data-watch-tab="cast" role="tab" aria-selected="false">Info &amp; Cast</button>
          <button type="button" class="cv-watch-tab-btn" data-watch-tab="reviews" role="tab" aria-selected="false">Reviews ${d.rating ? `<span class="cv-star">★ ${esc(d.rating)}</span>` : ""}</button>
        </div>

        <section id="cvForYouPanel" class="cv-watch-tab-panel">
          <div id="cvForYouGrid" class="cv-poster-grid"><div class="cv-status-banner">Loading recommendations…</div></div>
        </section>

        <section id="cvCastPanel" class="cv-watch-tab-panel" hidden>
          <div style="margin-bottom:18px;font-size:14px;line-height:1.65;color:#d5dce6">
            ${esc(d.storyline || d.description || "Explore cast and production credits below.")}
          </div>
          ${
            staffList.length
              ? `<div class="cv-cast-grid-clean">
                  ${staffList
                    .map(
                      st => `<button type="button" class="cv-cast-card" data-staff-id="${esc(st.staffId || "")}">
                        ${safeImg(st.avatarUrl) ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(st.avatarUrl)}" alt="${esc(st.name || "")}">` : `<img alt="" src="favicon.svg">`}
                        <div><b>${esc(st.name || "Cast Member")}</b><small>${esc(st.role || "Actor")}</small></div>
                      </button>`
                    )
                    .join("")}
                </div>
                <div id="cvStaffBioBox" class="cv-status-banner" hidden></div>`
              : `<div class="cv-status-banner">Cast details were not supplied for this title.</div>`
          }
        </section>

        <section id="cvReviewsPanel" class="cv-watch-tab-panel" hidden>
          <div class="cv-status-banner">Loading viewer reviews…</div>
        </section>
      `;

      syncWatchlistButtons();
      renderEpisodeButtons(seasonGroups);

      // Wire controls
      $("#cvToggleInfoBtn")?.addEventListener("click", e => {
        const box = $("#cvSynopsisBox");
        const open = !box.hidden;
        box.hidden = open;
        e.currentTarget.setAttribute("aria-expanded", String(!open));
      });

      $("#cvWatchActionList")?.addEventListener("click", toggleWatchlist);
      $("#cvWatchTopList")?.addEventListener("click", toggleWatchlist);
      $("#cvWatchActionShare")?.addEventListener("click", shareCurrentTitle);
      $("#cvWatchTopShare")?.addEventListener("click", shareCurrentTitle);
      $("#cvWatchTopPip")?.addEventListener("click", async () => {
        const v = $("#movieWatchVideo");
        if (!v) return;
        try {
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else await v.requestPictureInPicture();
        } catch {
          showToast("Picture-in-Picture is unavailable until video starts");
        }
      });

      $("#cvDubSelect")?.addEventListener("change", e => {
        const targetPath = e.target.value;
        if (targetPath && targetPath !== path) {
          location.href = `watch.html?path=${encodeURIComponent(targetPath)}&title=${encodeURIComponent(d.title || "")}`;
        }
      });

      $("#cvSeasonSelect")?.addEventListener("change", e => {
        selectedSeasonNum = Number(e.target.value);
        const firstInSeason = seasonGroups.get(selectedSeasonNum)?.[0];
        renderEpisodeButtons(seasonGroups);
        if (firstInSeason) playEpisode(firstInSeason.idx);
      });

      root.addEventListener("click", async e => {
        if (e.target.closest("#cvToggleAllEps")) {
          showAllEpisodes = !showAllEpisodes;
          renderEpisodeButtons(seasonGroups);
          return;
        }
        const epBtn = e.target.closest("[data-watch-ep]");
        if (epBtn) {
          playEpisode(Number(epBtn.dataset.watchEp));
          return;
        }
        const tabBtn = e.target.closest("[data-watch-tab]");
        if (tabBtn) {
          const target = tabBtn.dataset.watchTab;
          root.querySelectorAll("[data-watch-tab]").forEach(t => {
            const active = t === tabBtn;
            t.classList.toggle("active", active);
            t.setAttribute("aria-selected", String(active));
          });
          $("#cvForYouPanel").hidden = target !== "foryou";
          $("#cvCastPanel").hidden = target !== "cast";
          $("#cvReviewsPanel").hidden = target !== "reviews";
          return;
        }
        const castCard = e.target.closest("[data-staff-id]");
        if (castCard && castCard.dataset.staffId) {
          const bio = $("#cvStaffBioBox");
          if (!bio) return;
          bio.hidden = false;
          bio.textContent = "Loading actor profile…";
          try {
            const sr = await fetch(`/api/movie-api/staff?staffId=${encodeURIComponent(castCard.dataset.staffId)}&page=1`);
            const sd = await sr.json();
            bio.textContent = sd?.staff?.biography || `${sd?.staff?.name || "Actor"} — No additional details.`;
          } catch {
            bio.textContent = "Profile unavailable right now.";
          }
        }
      });

      playEpisode(0);
      loadRelated(d);
      loadComments(d);
    } catch (err) {
      statusEl.hidden = false;
      statusEl.textContent = err?.message || "Could not load this title. Try selecting another movie or series.";
    }
  }

  load();
})();