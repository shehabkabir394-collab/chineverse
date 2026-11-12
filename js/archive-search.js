(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function init() {
    const dashboard = $("#dashboard");
    const external = $("#externalSourcesPanel");
    if (!dashboard || !external || $("#archiveSearchPanel")) return;
    const panel = document.createElement("section");
    panel.id = "archiveSearchPanel";
    panel.className = "panel bulk-panel";
    panel.innerHTML = `
      <div class="toolbar"><div><h3>Internet Archive — Auto Search</h3><p class="muted">Search full-length movie catalog entries by title. Results are suggestions, not proof of reuse rights.</p></div><span class="tiny muted">Read-only search</span></div>
      <form id="archiveSearchForm" class="form"><label>Movie title<input id="archiveQuery" type="search" minlength="2" maxlength="120" placeholder="Enter a movie title…" required></label><button class="btn primary" type="submit" id="archiveSearchButton">Search Internet Archive</button><p id="archiveSearchMsg" class="msg" aria-live="polite"></p></form>
      <div id="archiveSearchResults" class="admin-list" aria-live="polite"></div>
      <p class="tiny muted">Before adding a result, inspect its Archive item page and license. Search results are never published automatically. A source is added as an unpublished draft; admin rights verification is still required.</p>`;
    external.parentNode.insertBefore(panel, external);
    const form = $("#archiveSearchForm");
    const msg = $("#archiveSearchMsg");
    const results = $("#archiveSearchResults");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = $("#archiveQuery").value.trim();
      if (query.length < 2) return;
      const button = $("#archiveSearchButton");
      button.disabled = true;
      msg.textContent = "Searching Internet Archive…";
      results.innerHTML = "";
      try {
        const response = await fetch("/api/archive-search?q=" + encodeURIComponent(query), { headers: { "Accept": "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Search failed.");
        msg.textContent = payload.total ? payload.total + " matching movie item(s) found. Showing " + payload.results.length + "." : "No matching movie items found.";
        results.innerHTML = (payload.results || []).map((item, index) => `
          <article class="admin-movie">
            <div class="admin-movie-info">
              <b>${esc(item.title)}</b>
              <small>${esc(item.year)} · ${Number(item.downloads || 0).toLocaleString()} downloads</small>
              <small>License: ${esc(item.licenseurl || item.rights || "Not stated — manual review required")}</small>
              <small><a href="${esc(item.details_url)}" target="_blank" rel="noopener noreferrer">Open Archive item and review rights</a></small>
            </div>
            <button class="mini" type="button" data-archive-add="${index}">Use as draft source</button>
          </article>`).join("");
        results.querySelectorAll("[data-archive-add]").forEach((button) => {
          button.addEventListener("click", () => {
            const item = payload.results[Number(button.dataset.archiveAdd)];
            const movie = $("#evsMovie");
            if (!movie || !movie.value) {
              msg("First select the matching CineVerse title in the External Video Sources panel below.");
              $("#externalSourcesPanel").scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
            $("#evsType").value = "embed";
            $("#evsProvider").value = "Internet Archive";
            $("#evsQuality").value = "Auto";
            $("#evsWatch").value = item.embed_url;
            $("#evsDownload").value = "";
            $("#evsLicense").value = item.licenseurl ? "Internet Archive listed license — verify exact item" : "License not stated — manual review required";
            $("#evsLicenseUrl").value = item.licenseurl || "";
            $("#evsCommercial").checked = false;
            $("#evsRedistribute").checked = false;
            $("#evsAttribution").checked = false;
            $("#evsVerified").checked = false;
            $("#evsActive").checked = false;
            $("#evsAttributionText").value = "Archive item: " + item.details_url + "\nReview the item-level rights and license before publishing.";
            $("#externalSourcesPanel").scrollIntoView({ behavior: "smooth", block: "start" });
            const sourceMsg = $("#evsMsg");
            if (sourceMsg) sourceMsg.textContent = "Draft filled. Verify the exact item rights before publishing.";
          });
        });
      } catch (error) {
        msg(error.message || "Internet Archive search failed.");
      } finally {
        button.disabled = false;
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
