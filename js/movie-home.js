(() => {
  "use strict";
  const search = document.querySelector("#search");
  const grid = document.querySelector("#movieGrid");
  const status = document.querySelector("#movieStatus");
  const heading = document.querySelector("#movieHeading");
  const more = document.querySelector("#movieMore");
  const empty = document.querySelector("#movieEmpty");
  const categorySelect = document.querySelector("#movieCategory");
  if (!search || !grid || !status) return;

  const style = document.createElement("style");
  style.textContent = "@media(max-width:760px){.topbar .actions{display:flex;order:2;width:100%;margin:0}.topbar .actions input{flex:1;width:auto;max-width:none}.topbar nav{order:3}}.movie-category-label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.movie-category-label select{padding:10px;border:1px solid #303448;border-radius:9px;background:#0b0d15;color:var(--text)}";
  document.head.append(style);

  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const labels = {popular:"Popular Movies",now_playing:"Now Playing",upcoming:"Upcoming Movies",top_rated:"Top Rated Movies"};
  let category = "popular", page = 1, pages = 1, timer, request = 0, searching = false;

  function render(items, append) {
    const html = items.map(movie => {
      const title = escapeHtml(movie.title);
      const href = "tmdb-movie.html?id=" + encodeURIComponent(movie.tmdb_id);
      const poster = String(movie.poster_url || "").startsWith("https://")
        ? '<img loading="lazy" src="' + escapeHtml(movie.poster_url) + '" alt="' + title + ' poster">'
        : '<div class="poster-placeholder"><b>OD</b><small>MOVIE</small></div>';
      return '<article class="movie-card"><a class="poster" href="' + href + '" aria-label="View ' + title + ' details">' + poster + '<span class="quality">MOVIE</span><span class="type-pill">FILM</span><span class="overlay">▶<small>View details</small></span></a><div class="movie-info"><h3><a href="' + href + '">' + title + '</a></h3><p>' + escapeHtml(movie.release_year || "Year unknown") + ' · ' + escapeHtml(movie.genre || "Movie") + '</p><p class="card-rating">' + (movie.rating == null ? "" : "★ " + escapeHtml(movie.rating)) + ' · ' + escapeHtml(movie.language || "") + '</p></div></article>';
    }).join("");
    grid.innerHTML = append ? grid.innerHTML + html : html;
    empty.classList.toggle("hidden", grid.children.length > 0);
  }

  async function load(append) {
    const current = ++request;
    const query = search.value.trim();
    searching = query.length >= 2;
    if (!append) { page = 1; grid.innerHTML = ""; }
    heading.textContent = searching ? 'Results for “' + query + '”' : (labels[category] || "Movies");
    status.textContent = searching ? "Searching movies…" : "Loading movies…";
    more.classList.add("hidden");
    try {
      const next = append ? page + 1 : 1;
      const url = searching
        ? "/api/tmdb-search?q=" + encodeURIComponent(query) + "&page=" + next
        : "/api/tmdb-discover?category=" + encodeURIComponent(category) + "&page=" + next;
      const response = await fetch(url, {headers:{Accept:"application/json"}});
      const data = await response.json();
      if (current !== request) return;
      if (!response.ok) throw new Error(data.error || "Movies could not be loaded.");
      render(data.movies || [], append);
      page = next;
      pages = Number(data.total_pages || 1);
      status.textContent = Number(data.total_results || 0).toLocaleString() + " movies";
      if (page < pages) more.classList.remove("hidden");
    } catch (error) {
      if (current !== request) return;
      status.textContent = error.message || "Movies could not be loaded.";
      empty.classList.remove("hidden");
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(timer);
    const query = search.value.trim();
    if (query.length === 1) { status.textContent = "Type at least 2 letters to search movies."; return; }
    timer = setTimeout(() => load(false), query ? 350 : 0);
  });
  search.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault(); clearTimeout(timer); load(false);
    document.querySelector("#movieCatalog").scrollIntoView({behavior:"smooth",block:"start"});
  });
  categorySelect.addEventListener("change", () => { category = categorySelect.value; search.value = ""; load(false); });
  more.addEventListener("click", () => load(true));
  load(false);
})();
