(() => {
  const $ = selector => document.querySelector(selector);
  const db = () => window.cineverseSupabase;
  const state = { movies: [], existingIds: new Set(), existingKeys: new Set(), selected: new Set() };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function titleKey(movie) {
    return [String(movie.title || "").trim().toLocaleLowerCase(), movie.release_year ?? "", movie.media_type || "movie"].join("|");
  }
  function setMessage(text, error = false) {
    const status = $("#tmdbMsg");
    status.textContent = text;
    status.classList.toggle("error", error);
  }
  function isExisting(movie) {
    return state.existingIds.has(String(movie.tmdb_id)) || state.existingKeys.has(titleKey(movie));
  }
  function updateButtons() {
    const available = state.movies.filter(movie => !isExisting(movie));
    $("#tmdbSelectAll").disabled = available.length === 0;
    $("#tmdbSelectAll").checked = available.length > 0 && available.every(movie => state.selected.has(String(movie.tmdb_id)));
    $("#tmdbImport").disabled = state.selected.size === 0;
  }
  function render() {
    const box = $("#tmdbResults");
    if (!state.movies.length) {
      box.innerHTML = "";
      updateButtons();
      return;
    }
    box.innerHTML = state.movies.map(movie => {
      const id = String(movie.tmdb_id);
      const imported = isExisting(movie);
      const poster = movie.poster_url ? `<img src="${esc(movie.poster_url)}" alt="" loading="lazy">` : `<span class="tmdb-no-poster">CV</span>`;
      const summary = movie.description ? `<p>${esc(movie.description)}</p>` : `<p class="muted">No synopsis available.</p>`;
      return `<label class="tmdb-result ${imported ? "is-imported" : ""}"><input type="checkbox" data-tmdb-id="${esc(id)}" ${imported ? "disabled" : ""} ${state.selected.has(id) ? "checked" : ""}><span class="tmdb-result-poster">${poster}</span><span class="tmdb-result-info"><b>${esc(movie.title)}</b><small>${esc(movie.release_year || "Year unknown")} · ${esc(movie.genre || "Genre unavailable")} · ${movie.rating == null ? "Unrated" : `★ ${esc(movie.rating)}`}</small>${summary}<small class="tmdb-import-state">${imported ? "Already in your catalog" : "Metadata only · no watch/download links"}</small></span></label>`;
    }).join("");
    box.querySelectorAll("[data-tmdb-id]").forEach(input => {
      input.addEventListener("change", () => {
        const id = input.dataset.tmdbId;
        if (input.checked) state.selected.add(id);
        else state.selected.delete(id);
        updateButtons();
      });
    });
    updateButtons();
  }
  async function sessionToken() {
    if (!db()) throw new Error("Supabase is not configured.");
    const { data, error } = await db().auth.getSession();
    if (error) throw error;
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sign in as an approved administrator first.");
    return token;
  }
  async function fetchList() {
    const button = $("#tmdbLoad");
    button.disabled = true;
    $("#tmdbResults").innerHTML = "";
    state.movies = [];
    state.selected.clear();
    updateButtons();
    try {
      const pages = Number($("#tmdbPages").value);
      if (!Number.isInteger(pages) || pages < 1 || pages > 5) throw new Error("Choose between 1 and 5 pages.");
      setMessage("Checking your catalog and loading TMDB results…");
      const [token, existingResult] = await Promise.all([
        sessionToken(),
        db().from("movies").select("tmdb_id,title,release_year,media_type")
      ]);
      if (existingResult.error) throw new Error("Could not check existing titles: " + existingResult.error.message);
      state.existingIds = new Set((existingResult.data || []).filter(movie => movie.tmdb_id != null).map(movie => String(movie.tmdb_id)));
      state.existingKeys = new Set((existingResult.data || []).map(titleKey));
      const response = await fetch("/api/tmdb-movies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ category: $("#tmdbCategory").value, pages })
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "TMDB movie list could not be loaded.");
      state.movies = data.movies || [];
      render();
      setMessage(state.movies.length ? `${state.movies.length} titles loaded. Select the titles to add; existing titles are marked.` : "No titles were returned for this list.");
    } catch (error) {
      setMessage(error.message || "Could not load movie metadata.", true);
    } finally {
      button.disabled = false;
    }
  }
  async function importSelected() {
    const button = $("#tmdbImport");
    const chosen = state.movies.filter(movie => state.selected.has(String(movie.tmdb_id)) && !isExisting(movie));
    if (!chosen.length) {
      setMessage("Select at least one movie that is not already in your catalog.", true);
      return;
    }
    button.disabled = true;
    try {
      await sessionToken();
      const publish = $("#tmdbPublish").checked;
      const rows = chosen.map(movie => ({ ...movie, published: publish }));
      let inserted = 0;
      for (let start = 0; start < rows.length; start += 50) {
        const batch = rows.slice(start, start + 50);
        setMessage(`Adding ${Math.min(start + batch.length, rows.length)} of ${rows.length} titles…`);
        const { error } = await db().from("movies").insert(batch);
        if (error) throw new Error(`Added ${inserted} titles before an error: ${error.message}`);
        inserted += batch.length;
      }
      for (const movie of chosen) {
        state.existingIds.add(String(movie.tmdb_id));
        state.existingKeys.add(titleKey(movie));
        state.selected.delete(String(movie.tmdb_id));
      }
      render();
      setMessage(`Imported ${inserted} titles. Watch and download links were left empty.`);
      $("#refresh")?.click();
    } catch (error) {
      setMessage(error.message || "Import failed.", true);
    } finally {
      button.disabled = state.selected.size === 0;
    }
  }

  $("#tmdbLoad").addEventListener("click", fetchList);
  $("#tmdbImport").addEventListener("click", importSelected);
  $("#tmdbSelectAll").addEventListener("change", event => {
    for (const movie of state.movies) {
      const id = String(movie.tmdb_id);
      if (isExisting(movie)) continue;
      if (event.target.checked) state.selected.add(id);
      else state.selected.delete(id);
    }
    render();
  });
})();
