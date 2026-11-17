(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));

  const safeImage = s => /^https:\/\//i.test(s || "") ? s : "";
  const root = $("#movieApiSections");
  const status = $("#movieApiStatus");
  const category = $("#movieApiCategory");
  const search = $("#movieApiSearch");
  const dialog = $("#movieApiDialog");
  const dialogBody = $("#movieApiDialogBody");

  if (!root || !status || !dialog) return;

  let home = null;
  let selectedCategory = "";
  let searchText = "";
  let busy = false;
  let currentEpisodes = [];
  let currentMoviePath = "";
  let moviePlayerApi = null;

  function itemPath(item) {
    if (typeof item.path === "string" && item.path.startsWith("/mb/")) {
      return item.path;
    }

    try {
      const u = new URL(item.detailsEndpoint);
      const p = u.searchParams.get("path");
      return p && p.startsWith("/mb/") ? p : "";
    } catch {
      return "";
    }
  }

  function card(item) {
    const title = item.title || "Untitled";
    const poster = safeImage(item.poster || item.previewImage);
    const path = itemPath(item);
    const quality = item.quality || item.typeBadge || "HD";

    return `
      <article class="movie-card movie-api-card">
        <button class="movie-api-poster" type="button"
          data-movie-path="${esc(path)}" ${path ? "" : "disabled"}
          aria-label="Details: ${esc(title)}">
          ${poster
            ? `<img loading="lazy" src="${esc(poster)}" alt="${esc(title)} poster">`
            : `<span class="movie-api-placeholder">CINEVERSE</span>`}
          <span class="quality">${esc(quality)}</span>
          <span class="overlay">▶<small>View details</small></span>
        </button>
        <div class="movie-info">
          <h3>${esc(title)}</h3>
          <p>${esc(item.country || item.language || item.typeBadge || "Movie API")}</p>
          <p class="card-rating">${item.rating != null ? "★ " + esc(item.rating) : ""}</p>
        </div>
      </article>`;
  }

  function matching(item) {
    const q = searchText.toLowerCase();
    const categoryMatch = !selectedCategory ||
      String(item.categoryPath || item.category || "").toLowerCase()
        .includes(selectedCategory.toLowerCase());

    const text = [
      item.title, item.description, item.country,
      item.language, item.genre, item.typeBadge
    ].join(" ").toLowerCase();

    return categoryMatch && (!q || text.includes(q));
  }

  function render() {
    if (!home) return;

    const sections = Array.isArray(home.sections) ? home.sections : [];
    const trending = Array.isArray(home.trending) ? home.trending : [];
    const coming = Array.isArray(home.comingSoon) ? home.comingSoon : [];

    let html = "";

    if (trending.length) {
      const list = trending.filter(matching);
      html += sectionHtml("Trending Now", "POPULAR TITLES", list);
    }

    for (const section of sections) {
      const items = Array.isArray(section.items)
        ? section.items.filter(matching) : [];

      if (!items.length) continue;

      html += sectionHtml(
        section.title || section.bnTitle || "Discover",
        section.badge || "MOVIE API",
        items
      );
    }

    if (coming.length && !searchText && !selectedCategory) {
      html += sectionHtml("Coming Soon", "UPCOMING", coming);
    }

    root.innerHTML = html ||
      '<p class="muted">No titles match your search.</p>';

    status.textContent =
      `${trending.length} trending · ${sections.length} collections · ${coming.length} coming soon`;
  }

  function sectionHtml(title, eyebrow, items) {
    if (!items.length) return "";

    return `
      <section class="movie-api-row">
        <div class="section-head">
          <div>
            <p class="eyebrow">${esc(eyebrow)}</p>
            <h2>${esc(title)}</h2>
          </div>
        </div>
        <div class="grid">${items.map(card).join("")}</div>
      </section>`;
  }

  async function loadDetails(path) {
    if (!path || busy) return;
    busy = true;

    if (moviePlayerApi) {
      try {
        moviePlayerApi.video.pause();
        moviePlayerApi.video.removeAttribute("src");
        moviePlayerApi.video.load();
      } catch {}
    }

    moviePlayerApi = null;
    currentEpisodes = [];
    currentMoviePath = path;

    dialogBody.innerHTML = '<p class="muted">Loading details…</p>';
    if (!dialog.open) dialog.showModal();

    try {
      const response = await fetch(
        "/api/movie-api/details?path=" + encodeURIComponent(path),
        { cache: "no-store" }
      );

      const data = await response.json();
      if (!response.ok || !data.detail) {
        throw new Error(data.error || "Details unavailable.");
      }

      const d = data.detail;
      const poster = safeImage(d.poster);
      const episodes = Array.isArray(d.episodes) ? d.episodes : [];
      const dubs = Array.isArray(d.dubs) ? d.dubs : [];

      dialogBody.innerHTML = `
        <div class="movie-api-detail">
          ${poster ? `<img src="${esc(poster)}" alt="${esc(d.title || "")}">` : ""}
          <div>
            <p class="eyebrow">MOVIE API DETAILS</p>
            <h2>${esc(d.title || "Untitled")}</h2>
            <p class="muted">
              ${esc(d.releaseDate || "")} ·
              ${esc(d.quality || d.resolution || "")} ·
              ${esc(d.language || "")}
            </p>
            <p>${esc(d.storyline || "No description available.")}</p>
            <p><b>Genre:</b> ${esc(d.genre || "Not specified")}</p>
            <p><b>Audio options:</b>
              ${esc(dubs.map(x => x.label).join(", ") || d.language || "Not listed")}
            </p>
          </div>
        </div>
        <h3>Episodes / Versions (${episodes.length})</h3>
        <div class="movie-api-episodes">
          ${episodes.map((ep, index) => `
            <div class="movie-api-episode">
              <div>
                <b>${esc(ep.label || ("Episode " + (ep.number || "")))}</b>
                <small class="muted">${esc(ep.kind || "")}</small>
              </div>
              <button class="btn primary" type="button"
                data-movie-episode="${index}">▶ Play</button>
            </div>`).join("") || '<p class="muted">No episode information.</p>'}
        </div>

        <section class="video-section movie-api-player" id="movieApiPlayerSection" hidden>
          <div class="video-heading">
            <div>
              <p class="eyebrow">CINEVERSE VIDEO PLAYER</p>
              <h3 id="movieApiNowPlaying">Now Playing</h3>
            </div>
          </div>
          <p id="movieApiPlayerMessage" class="muted" aria-live="polite">
            Select an episode to play.
          </p>
          <video id="movieApiVideo" class="movie-player"
            controls playsinline preload="none"
            ${poster ? `poster="${esc(poster)}"` : ""}>
          </video>
        </section>

        <p class="muted movie-api-notice">
          Video sources and audio options are supplied by the Movie API.
        </p>`;

      currentEpisodes = episodes;

    } catch (error) {
      dialogBody.innerHTML =
        `<p class="error">${esc(error.message || "Could not load details.")}</p>`;
    } finally {
      busy = false;
    }
  }

  dialogBody.addEventListener("click", event => {
    const button = event.target.closest("[data-movie-episode]");
    if (!button) return;

    const index = Number(button.dataset.movieEpisode);
    const episode = currentEpisodes[index];

    if (!episode) return;

    const sources = (Array.isArray(episode.sources) ? episode.sources : [])
      .filter(source => {
        try {
          const url = new URL(source.url);
          return url.protocol === "https:" &&
            url.hostname === "hd-w0l1.onrender.com" &&
            Number(source.quality) > 0;
        } catch {
          return false;
        }
      })
      .map(source => ({
        url: source.url,
        quality: Number(source.quality) + "p",
        provider: String(source.provider || "Movie API"),
        mime: source.type === "m3u8"
          ? "application/vnd.apple.mpegurl"
          : "video/mp4"
      }));

    const section = $("#movieApiPlayerSection");
    const video = $("#movieApiVideo");
    const message = $("#movieApiPlayerMessage");
    const title = $("#movieApiNowPlaying");

    if (!section || !video || !message) return;

    section.hidden = false;
    title.textContent = episode.label || "Now Playing";
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (!sources.length) {
      message.textContent = "No valid playable video source was returned for this episode.";
      return;
    }

    message.textContent = "Available quality: " +
      sources.map(source => source.quality).join(", ");

    if (window.CineVersePlayer) {
      if (!moviePlayerApi) {
        moviePlayerApi = window.CineVersePlayer.mount({
          video,
          sources,
          storageKey: "cv-movie-api-" +
            encodeURIComponent(currentMoviePath) + "-" +
            encodeURIComponent(episode.id || index)
        });
      } else {
        moviePlayerApi.setSources(sources);
      }

      if (!moviePlayerApi) {
        message.textContent = "CineVerse Player could not initialize.";
      }
    } else {
      video.controls = true;
      video.src = sources[0].url;
      video.load();
      video.play().catch(() => {
        message.textContent = "Press Play to start the video.";
      });
    }
  });

  dialogBody.addEventListener("click", event => {
    if (event.target.closest("[data-movie-episode]")) return;
  });

  root.addEventListener("click", event => {
    const button = event.target.closest("[data-movie-path]");
    if (button && button.dataset.moviePath) {
      loadDetails(button.dataset.moviePath);
    }
  });

  $("#movieApiClose").addEventListener("click", () => {
    if (moviePlayerApi) moviePlayerApi.video.pause();
    dialog.close();
  });

  search.addEventListener("input", () => {
    searchText = search.value.trim();
    render();
  });

  category.addEventListener("change", () => {
    selectedCategory = category.value;
    render();
  });

  $("#movieApiRefresh").addEventListener("click", load);

  async function load() {
    status.textContent = "Loading Movie API catalog…";
    root.innerHTML = "";

    try {
      const response = await fetch("/api/movie-api/home", {
        cache: "no-store"
      });

      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || "Catalog unavailable.");
      }

      home = data;

      const categories = Array.isArray(data.categories)
        ? data.categories : [];

      category.innerHTML =
        '<option value="">All categories</option>' +
        categories.map(c => {
          const value = c.path || c.label || "";
          const label = c.bnLabel || c.label || value;
          return `<option value="${esc(value)}">${esc(label)}</option>`;
        }).join("");

      render();
    } catch (error) {
      status.textContent =
        "Movie API catalog could not load: " +
        (error.message || "Unknown error");
    }
  }

  load();
})();
