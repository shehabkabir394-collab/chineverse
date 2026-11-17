/* Adds the 8Stream selector/player to a published movie details page. */
(() => {
  "use strict";

  const PRIORITY = ["hindi-dubbed", "bengali", "english", "hindi"];
  const normalize = value => window.OnlyDramaProviders.eightStream.normalizeLanguage(value);

  function rankPlaylist(list) {
    return [...list].sort((a, b) => {
      const ar = PRIORITY.indexOf(normalize(a.title));
      const br = PRIORITY.indexOf(normalize(b.title));
      return (ar < 0 ? PRIORITY.length : ar) - (br < 0 ? PRIORITY.length : br);
    });
  }

  function addNotice(root, text) {
    const notice = root.querySelector("[data-eightstream-notice]");
    if (notice) notice.textContent = text;
  }

  async function mount() {
    const root = document.querySelector("#detail");
    const provider = window.OnlyDramaProviders && window.OnlyDramaProviders.eightStream;
    const db = window.cineverseSupabase;
    const movieId = new URLSearchParams(location.search).get("id");
    if (!root || !provider || !provider.isAvailable() || !db || !movieId) return;

    const { data: movie, error } = await db.from("movies")
      .select("tmdb_id,media_type,title")
      .eq("id", movieId)
      .eq("published", true)
      .maybeSingle();
    if (error || !movie || !movie.tmdb_id) return;

    const host = document.createElement("section");
    host.className = "video-section";
    host.id = "eightstream-watch";
    host.innerHTML = `
      <div class="video-heading">
        <div><p class="eyebrow">8STREAM PROVIDER</p><h2>Watch ${escapeHtml(movie.title)}</h2></div>
      </div>
      <p class="muted" data-eightstream-notice>Finding the IMDb ID and available audio…</p>
      <div class="buttons quality-buttons" data-eightstream-controls hidden>
        <label class="muted" for="eightstream-language">Audio</label>
        <select id="eightstream-language" aria-label="Audio language"></select>
        <button class="btn primary" type="button" data-eightstream-load>Load stream</button>
      </div>
      <video class="movie-player" data-eightstream-video controls playsinline preload="none" hidden>
        Your browser cannot play this video.
      </video>`;

    const hero = root.querySelector(".detail-hero");
    if (!hero || root.querySelector("#eightstream-watch")) return;
    hero.insertAdjacentElement("afterend", host);

    try {
      const tmdbType = movie.media_type === "series" ? "tv" : "movie";
      const idsResponse = await fetch(`/api/tmdb-external-ids?tmdb_id=${encodeURIComponent(movie.tmdb_id)}&media_type=${tmdbType}`);
      const ids = await idsResponse.json();
      if (!idsResponse.ok || !/^tt\d+$/i.test(ids.imdb_id || "")) throw new Error("IMDb ID is not available for this title.");

      if (tmdbType === "tv") {
        const seasons = await provider.getSeasonList(ids.imdb_id);
        if (!seasons.success) throw new Error("8Stream season information is unavailable for this series.");
        addNotice(root, "Season information is available. Episode stream resolution is not included in the documented provider API.");
        return;
      }

      const media = await provider.getMediaInfo(ids.imdb_id);
      if (!media.success) throw new Error(media.message || "8Stream media information could not be loaded.");
      const playlist = rankPlaylist(Array.isArray(media.data.playlist) ? media.data.playlist : []);
      if (!playlist.length || !media.data.key) throw new Error("No playable audio tracks were returned.");

      const select = host.querySelector("#eightstream-language");
      const controls = host.querySelector("[data-eightstream-controls]");
      const loadButton = host.querySelector("[data-eightstream-load]");
      const video = host.querySelector("[data-eightstream-video]");
      playlist.forEach((track, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = track.title || "Audio track";
        select.appendChild(option);
      });
      controls.hidden = false;
      addNotice(root, "Choose an audio track, then load its authorized stream.");

      loadButton.addEventListener("click", async () => {
        loadButton.disabled = true;
        addNotice(root, "Resolving the selected stream…");
        try {
          const track = playlist[Number(select.value)];
          const stream = await provider.getStream(track.file, media.data.key);
          if (!stream.success) throw new Error(stream.message || "The selected stream could not be resolved.");
          video.hidden = false;
          if (window.CineVersePlayer) {
            window.CineVersePlayer.mount({
              video,
              sources: [{ quality: "auto", url: stream.data.link }],
              storageKey: `cv-8stream-${movie.tmdb_id}`
            });
          } else {
            video.src = stream.data.link;
            video.load();
          }
          addNotice(root, `${track.title || "Selected audio"} is ready. Press play to start.`);
        } catch (error) {
          addNotice(root, error.message || "The stream could not be loaded.");
        } finally {
          loadButton.disabled = false;
        }
      });
    } catch (error) {
      addNotice(root, error.message || "8Stream is currently unavailable for this title.");
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function waitForMovieDetails() {
    const root = document.querySelector("#detail");
    if (!root) return;
    if (root.querySelector(".detail-hero")) {
      mount();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!root.querySelector(".detail-hero")) return;
      observer.disconnect();
      mount();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForMovieDetails, { once: true });
  else waitForMovieDetails();
})();
