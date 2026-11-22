(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => (/^(?:https?:\/\/|\/api\/)/i.test(String(u || "")) ? String(u) : "");

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const HISTORY_KEY = "cv_watch_history_v1";
  let activeFolder = "all";

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function loadList(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveList(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {}
  }

  function getWatchlist() {
    return loadList(WATCHLIST_KEY).map(item => ({
      ...item,
      folder: item.folder === "favorites" ? "favorites" : "watchLater"
    }));
  }

  function render() {
    const items = getWatchlist();
    const favCount = items.filter(x => x.folder === "favorites").length;
    const laterCount = items.filter(x => x.folder === "watchLater").length;

    const heading = $("#cvSavedHeading");
    if (heading) heading.textContent = `My List & Saved Downloads (${items.length})`;

    const folderTabs = $("#cvFolderTabs");
    if (folderTabs) {
      const folderDefs = [
        { id: "all", label: `All (${items.length})` },
        { id: "favorites", label: `Favorites (${favCount})` },
        { id: "watchLater", label: `Watch Later (${laterCount})` }
      ];
      folderTabs.innerHTML = folderDefs
        .map(
          f => `<button type="button" class="cv-folder-pill ${activeFolder === f.id ? "active" : ""}" data-folder="${f.id}" role="tab" aria-selected="${activeFolder === f.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            <span>${esc(f.label)}</span>
          </button>`
        )
        .join("");
    }

    const visible =
      activeFolder === "all" ? items : items.filter(x => x.folder === activeFolder);

    const body = $("#cvSavedBody");
    if (!body) return;

    if (!visible.length) {
      body.innerHTML = `
        <div class="cv-saved-empty">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <p>No movies saved in this folder yet</p>
          <a class="cv-discover-cta" href="./">Discover Movies</a>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="cv-poster-grid">
        ${visible
          .map(item => {
            const poster = safeImg(item.poster);
            const href = item.path
              ? `watch.html?path=${encodeURIComponent(item.path)}&title=${encodeURIComponent(item.title || "")}`
              : "./";
            const isFav = item.folder === "favorites";
            return `
              <article class="cv-saved-item">
                <a class="cv-card" href="${esc(href)}">
                  <div class="cv-card-thumb">
                    ${
                      poster
                        ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(poster)}" alt="${esc(item.title || "")}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="cv-card-fallback" hidden>${esc(item.title || "")}</div>`
                        : `<div class="cv-card-fallback">${esc(item.title || "")}</div>`
                    }
                    <div class="cv-card-top">
                      ${item.typeBadge ? `<span class="cv-card-lang">${esc(item.typeBadge)}</span>` : ""}
                      ${item.rating ? `<span class="cv-card-rate">★ ${esc(item.rating)}</span>` : ""}
                    </div>
                  </div>
                  <h3 class="cv-card-title">${esc(item.title || "Untitled")}</h3>
                </a>
                <div class="cv-saved-item-bar">
                  <button type="button" class="cv-saved-mini-btn ${isFav ? "fav" : ""}" data-toggle-fav="${esc(item.path || "")}" title="Move to Favorites">
                    ${isFav ? "♥ Fav" : "♡ Fav"}
                  </button>
                  <button type="button" class="cv-saved-mini-btn remove" data-remove-saved="${esc(item.path || "")}" title="Remove from list">Remove</button>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  $("#cvFolderTabs")?.addEventListener("click", e => {
    const tab = e.target.closest("[data-folder]");
    if (!tab) return;
    activeFolder = tab.dataset.folder || "all";
    render();
  });

  $("#cvSavedBody")?.addEventListener("click", e => {
    const favBtn = e.target.closest("[data-toggle-fav]");
    if (favBtn) {
      const targetPath = favBtn.dataset.toggleFav;
      const list = getWatchlist().map(x =>
        x.path === targetPath ? { ...x, folder: x.folder === "favorites" ? "watchLater" : "favorites" } : x
      );
      saveList(WATCHLIST_KEY, list);
      render();
      showToast("Updated folder");
      return;
    }
    const rmBtn = e.target.closest("[data-remove-saved]");
    if (rmBtn) {
      const targetPath = rmBtn.dataset.removeSaved;
      const list = getWatchlist().filter(x => x.path !== targetPath);
      saveList(WATCHLIST_KEY, list);
      render();
      showToast("Removed from saved list");
    }
  });

  $("#cvBackupBtn")?.addEventListener("click", () => {
    const payload = {
      app: "MovieStream BD",
      exportedAt: new Date().toISOString(),
      watchlist: getWatchlist(),
      watchHistory: loadList(HISTORY_KEY)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moviestream-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast("Backup JSON downloaded");
  });

  $("#cvRestoreBtn")?.addEventListener("click", () => {
    $("#cvRestoreFile")?.click();
  });

  $("#cvRestoreFile")?.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incomingList = Array.isArray(data?.watchlist) ? data.watchlist : Array.isArray(data) ? data : [];
      const incomingHistory = Array.isArray(data?.watchHistory) ? data.watchHistory : [];

      const existing = getWatchlist();
      const map = new Map();
      [...existing, ...incomingList].forEach(item => {
        if (item?.path) map.set(item.path, { ...item, folder: item.folder === "favorites" ? "favorites" : "watchLater" });
      });
      saveList(WATCHLIST_KEY, [...map.values()].slice(0, 100));

      if (incomingHistory.length) {
        const histMap = new Map();
        [...loadList(HISTORY_KEY), ...incomingHistory].forEach(h => {
          if (h?.path) histMap.set(h.path, h);
        });
        saveList(HISTORY_KEY, [...histMap.values()].slice(0, 40));
      }

      render();
      showToast(`Restored ${incomingList.length} saved titles`);
    } catch {
      showToast("Invalid backup JSON file");
    } finally {
      e.target.value = "";
    }
  });

  render();
})();
