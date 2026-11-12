(() => {
  const $ = selector => document.querySelector(selector);
  const db = () => window.cineverseSupabase;
  let scanResults = [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const say = (text, error = false) => {
    const node = $("#archiveBulkMsg");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("error", error);
  };
  async function token() {
    const { data, error } = await db().auth.getSession();
    if (error) throw error;
    const value = data?.session?.access_token;
    if (!value) throw new Error("Sign in as an approved administrator first.");
    return value;
  }
  function render() {
    const box = $("#archiveBulkResults");
    const candidates = scanResults.filter(row => row.status === "candidate");
    box.innerHTML = scanResults.map(row => {
      const m = row.movie || {};
      const status = row.status === "candidate" ? "Exact match · license candidate" : row.status.replaceAll("_", " ");
      const details = row.status === "candidate"
        ? esc(row.file_name) + " · " + (Number(row.file_size || 0) / 1024 / 1024).toFixed(1) + " MB"
        : esc(row.reason || "Skipped");
      const archive = row.archive_url ? '<a href="' + esc(row.archive_url) + '" target="_blank" rel="noopener noreferrer">Review Archive item</a>' : "";
      return '<article class="admin-movie"><div class="admin-movie-info"><b>' + esc(m.title) + ' (' + esc(m.release_year || "—") + ')</b><small>' + esc(status) + '</small><small>' + details + '</small><small>' + archive + '</small></div></article>';
    }).join("") || '<p class="muted">No scan results yet.</p>';
    $("#archiveBulkImport").disabled = candidates.length === 0;
    $("#archiveBulkImport").textContent = "Import " + candidates.length + " matched draft(s)";
  }
  async function scan() {
    const button = $("#archiveBulkScan");
    button.disabled = true;
    $("#archiveBulkImport").disabled = true;
    $("#archiveBulkResults").innerHTML = "";
    scanResults = [];
    try {
      const accessToken = await token();
      say("Searching TMDB and checking exact title/year matches in Internet Archive…");
      const response = await fetch("/api/archive-bulk-match", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
        body: JSON.stringify({ category: $("#archiveBulkCategory").value, pages: Number($("#archiveBulkPages").value) })
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Bulk search failed.");
      scanResults = payload.results || [];
      render();
      const counts = payload.counts || {};
      say("Checked " + payload.total + " titles. Exact reusable-license candidates: " + (counts.candidate || 0) +
        "; no match: " + (counts.not_found || 0) + "; rights review needed: " + (counts.rights_review || 0) +
        "; other skipped: " + (payload.total - (counts.candidate || 0) - (counts.not_found || 0) - (counts.rights_review || 0)) + ".");
    } catch (error) {
      say(error.message || "Bulk scan failed.", true);
    } finally {
      button.disabled = false;
    }
  }
  function titleKey(movie) {
    return String(movie.title || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + "|" + (movie.release_year || "");
  }
  async function importCandidates() {
    const button = $("#archiveBulkImport");
    const candidates = scanResults.filter(row => row.status === "candidate");
    if (!candidates.length) return;
    button.disabled = true;
    try {
      await token();
      say("Checking existing CineVerse titles and video sources…");
      const { data: existing, error: existingError } = await db().from("movies")
        .select("id,title,release_year,tmdb_id").limit(5000);
      if (existingError) throw new Error(existingError.message);
      const byTmdb = new Map((existing || []).filter(movie => movie.tmdb_id != null).map(movie => [Number(movie.tmdb_id), movie]));
      const byTitle = new Map();
      for (const movie of existing || []) {
        const key = titleKey(movie);
        if (!byTitle.has(key)) byTitle.set(key, []);
        byTitle.get(key).push(movie);
      }
      const ambiguous = new Set();
      for (const row of candidates) {
        const id = Number(row.movie.tmdb_id);
        if (byTmdb.has(id)) continue;
        const matches = byTitle.get(titleKey(row.movie)) || [];
        if (matches.length === 1) byTmdb.set(id, matches[0]);
        else if (matches.length > 1) ambiguous.add(id);
      }
      const missing = candidates.filter(row => !byTmdb.has(Number(row.movie.tmdb_id)) && !ambiguous.has(Number(row.movie.tmdb_id)));
      let inserted = [];
      if (missing.length) {
        say("Adding " + missing.length + " new movie records as unpublished drafts…");
        const rows = missing.map(row => ({
          tmdb_id: row.movie.tmdb_id, title: row.movie.title, release_year: row.movie.release_year,
          description: row.movie.description || "", poster_url: row.movie.poster_url,
          backdrop_url: row.movie.backdrop_url, rating: row.movie.rating,
          language: row.movie.language || "", media_type: "movie", quality: "Other",
          genre: "", cast_members: "", tags: "Internet Archive candidate",
          published: false, watch_url: null, video_url: null, download_url: null, download_links: []
        }));
        const { data, error } = await db().from("movies").insert(rows).select("id,title,release_year,tmdb_id");
        if (error) throw new Error("Movie metadata insert failed: " + error.message);
        inserted = data || [];
        for (const movie of inserted) byTmdb.set(Number(movie.tmdb_id), movie);
      }
      const targetMovies = candidates.map(row => ({ row, movie: byTmdb.get(Number(row.movie.tmdb_id)) })).filter(x => x.movie?.id);
      if (!targetMovies.length) throw new Error("No CineVerse movie records could be matched.");
      const ids = targetMovies.map(x => x.movie.id);
      const { data: sources, error: sourceReadError } = await db().from("movie_video_sources")
        .select("movie_id,provider,watch_url,download_url").in("movie_id", ids);
      if (sourceReadError) throw new Error("Could not check existing video sources: " + sourceReadError.message);
      const existingKeys = new Set((sources || []).map(source => [source.movie_id, source.provider, source.watch_url].join("|")));
      const sourceRows = targetMovies.filter(({ row, movie }) =>
        !existingKeys.has([movie.id, "Internet Archive", row.watch_url].join("|"))
      ).map(({ row, movie }) => ({
        movie_id: movie.id, source_type: "embed", provider: "Internet Archive", quality: "Auto",
        watch_url: row.watch_url, download_url: row.download_url,
        license_name: "Internet Archive license candidate — verify exact item before publishing",
        license_url: row.license || null, commercial_use: true, redistribution_allowed: true,
        attribution_required: /licenses\\/(by|by-sa)\\//i.test(row.license || ""),
        attribution_text: "Archive item: " + row.archive_url + "\\nFile: " + row.file_name +
          "\\nExact title/year matched automatically. Admin must inspect the item-level rights before publishing.",
        rights_verified: false, is_active: false
      }));
      if (sourceRows.length) {
        say("Saving " + sourceRows.length + " Watch/Download source pairs as unpublished rights-review drafts…");
        const { error } = await db().from("movie_video_sources").insert(sourceRows);
        if (error) throw new Error("Video source save failed: " + error.message);
      }
      say("Completed: " + inserted.length + " new movie record(s), " + sourceRows.length +
        " video source draft(s). Existing catalog titles were reused. Review rights, then activate and publish each approved source.");
      button.disabled = true;
      $("#archiveBulkResults").insertAdjacentHTML("afterbegin",
        '<p class="notice">Draft import complete. Sources remain inactive until an administrator verifies the exact item rights.</p>');
      $("#refresh")?.click();
    } catch (error) {
      say(error.message || "Could not import matched drafts.", true);
      button.disabled = false;
    }
  }
  function init() {
    const dashboard = $("#dashboard");
    const anchor = $("#tmdbBulkPanel");
    if (!dashboard || !anchor || $("#archiveBulkPanel")) return;
    const panel = document.createElement("section");
    panel.id = "archiveBulkPanel";
    panel.className = "panel bulk-panel";
    panel.innerHTML = '<div class="toolbar"><div><h3>Bulk Auto Movie + Video Import</h3><p class="muted">Scan TMDB titles against Internet Archive by exact title and year. Matching video files are attached in bulk as rights-review drafts.</p></div><span class="tiny muted">Up to 40 titles per scan</span></div>' +
      '<div class="row"><label>Movie list<select id="archiveBulkCategory"><option value="popular">Popular</option><option value="now_playing">Now playing</option><option value="upcoming">Upcoming</option><option value="top_rated">Top rated</option></select></label>' +
      '<label>Pages (20 titles each, max 2)<select id="archiveBulkPages"><option value="1">1 page · 20 movies</option><option value="2">2 pages · 40 movies</option></select></label></div>' +
      '<div class="row"><button type="button" id="archiveBulkScan" class="btn primary">Find matching videos</button><button type="button" id="archiveBulkImport" class="btn ghost" disabled>Import matched drafts</button></div>' +
      '<p id="archiveBulkMsg" class="msg" aria-live="polite"></p><div id="archiveBulkResults" class="admin-list"></div>' +
      '<p class="tiny muted">Only exact title/year matches with a listed Creative Commons / public-domain license and a video file are candidates. This is not proof of ownership or permission: every item is saved inactive and unpublished for item-level rights review. Internet Archive results may not cover every movie. No video bytes are copied to your R2 bucket.</p>';
    anchor.parentNode.insertBefore(panel, anchor);
    $("#archiveBulkScan").addEventListener("click", scan);
    $("#archiveBulkImport").addEventListener("click", importCandidates);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
