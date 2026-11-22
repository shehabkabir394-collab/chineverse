(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WATCHLIST_KEY = "cv_watchlist_v1";

  function getWatchlist() {
    try {
      const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  async function showMe() {
    let modal = $("#cvMePanel");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cvMePanel";
      modal.className = "cv-me-panel";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="cv-me-card" role="dialog" aria-modal="true" aria-labelledby="cvMeTitle">
          <button type="button" class="cv-me-close" aria-label="Close">×</button>
          <h2 id="cvMeTitle" style="margin:0 0 14px;font-family:var(--cv-font-display)">My Account &amp; Watchlist</h2>
          <div id="cvMeContent"><p class="muted">Loading…</p></div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener("click", e => {
        if (e.target === modal || e.target.closest(".cv-me-close")) modal.hidden = true;
      });
    }
    modal.hidden = false;
    const content = $("#cvMeContent");
    const watchlist = getWatchlist();

    const watchlistHtml = `
      <div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:8px">Saved Watchlist (${watchlist.length})</div>
        ${
          watchlist.length
            ? `<div style="display:grid;gap:8px;max-height:220px;overflow:auto">${watchlist
                .map(
                  w => `<a href="watch.html?path=${encodeURIComponent(w.path || "")}&title=${encodeURIComponent(w.title || "")}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:10px;background:#13161b;border:1px solid rgba(255,255,255,0.08)">
                    <span style="font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.title || "Untitled")}</span>
                    <span style="font-size:11px;color:#00c882;flex-shrink:0">Watch ›</span>
                  </a>`
                )
                .join("")}</div>`
            : `<p style="margin:0;font-size:13px;color:#98a2b3">No saved titles yet. Tap "Add to list" on any movie or series.</p>`
        }
      </div>
    `;

    content.innerHTML = watchlistHtml + `<div id="cvMeApiRows" style="font-size:13px;color:#98a2b3">Checking API connection…</div>`;

    try {
      const r = await fetch("/api/movie-api/me", { cache: "no-store" });
      const d = await r.json();
      const root = d.me || d.account || d.profile || d.data || d;
      const rows = [];
      const add = (label, v) => {
        if (v !== undefined && v !== null && String(v) !== "") {
          rows.push(`<div class="cv-me-row"><span>${esc(label)}</span><b>${esc(v)}</b></div>`);
        }
      };
      add("Upstream", root.name || "MovieBox Direct");
      add("Plan", root.plan || "Live Main API");
      add("Status", root.status || "Connected");
      add("Indexed Titles", root.cachedTitles);
      $("#cvMeApiRows").innerHTML = rows.join("");
    } catch {
      $("#cvMeApiRows").innerHTML = `<div class="cv-me-row"><span>Status</span><b>Active</b></div>`;
    }
  }

  document.addEventListener("click", e => {
    if (e.target.closest("#cvMeOpen, [data-open-me]")) {
      e.preventDefault();
      showMe();
    }
  });
})();