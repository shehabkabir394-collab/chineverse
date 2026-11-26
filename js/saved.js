(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImg = u => {
    const s = String(u || "");
    if (/^(?:https?:\/\/|\/api\/)/i.test(s)) return s;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
    return "";
  };

  const WATCHLIST_KEY = "cv_watchlist_v1";
  const HISTORY_KEY = "cv_watch_history_v1";
  const initialTab = new URLSearchParams(location.search).get("tab");
  let activeFolder = initialTab === "offline" ? "offline" : "all";
  let offlineItemsCache = [];
  let storageEstimateCache = { count: 0, completeCount: 0, offlineBytes: 0, quota: 0, usage: 0 };
  let renderDebounceTimer = null;

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

  function fmtBytes(raw) {
    if (window.CineVerseOffline?.formatBytes) return window.CineVerseOffline.formatBytes(raw);
    const n = Number(raw) || 0;
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function renderOfflineSectionHtml(offlineItems, est) {
    if (!offlineItems.length) {
      return `
        <div class="cv-saved-empty" style="margin-bottom:18px">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><rect x="4" y="18" width="16" height="3" rx="1"/></svg>
          <p>কোনো ভিডিও অফলাইনের জন্য সেভ করা নেই</p>
          <small style="color:#94a3b8;display:block;margin-bottom:12px">যেকোনো মুভি বা সিরিজের Watch বা Download পেজে গিয়ে "Save Offline" চাপলে ইন্টারনেট ছাড়াই এখানে প্লে করতে পারবেন।</small>
          <a class="cv-discover-cta" href="./">Discover Movies</a>
        </div>
      `;
    }

    const usedText = fmtBytes(est.offlineBytes || 0);
    const quotaText = est.quota > 0 ? ` / ${fmtBytes(est.quota)} available` : "";

    const cards = offlineItems
      .map(item => {
        const poster = safeImg(item.posterDataUrl || item.rawPoster);
        const rawFb = /^(?:https?:\/\/|\/\/)/i.test(String(item.rawPoster || "")) ? String(item.rawPoster) : "";
        const fbAttr = rawFb && rawFb !== poster ? ` data-fallback-src="${esc(rawFb)}"` : "";
        const isComplete = item.status === "complete";
        const isDownloading = item.status === "downloading" || Boolean(window.CineVerseOffline?.isActive?.(item.id));
        const total = Number(item.totalBytes || 0);
        const done = Number(item.downloadedBytes || 0);
        const pct = isComplete ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const statusText = isComplete
          ? "Offline Ready"
          : isDownloading
            ? `Saving ${pct}%`
            : `Paused ${pct}%`;
        const statusColor = isComplete ? "#86efac" : isDownloading ? "#fda4af" : "#fcd34d";
        const playHref = isComplete
          ? `watch.html?offline=${encodeURIComponent(item.id)}`
          : item.path
            ? `watch.html?path=${encodeURIComponent(item.path)}&title=${encodeURIComponent(item.title || "")}`
            : "#";
        const sizeLabel = total > 0 && !isComplete
          ? `${fmtBytes(done)} / ${fmtBytes(total)}`
          : fmtBytes(done || total);

        return `
          <article class="cv-saved-item">
            <a class="cv-card" href="${esc(playHref)}">
              <div class="cv-card-thumb">
                ${
                  poster
                    ? `<img loading="lazy" decoding="async" src="${esc(poster)}"${fbAttr} data-poster-img="1" alt="${esc(item.title || "")}"><div class="cv-card-fallback" hidden>${esc(item.title || "")}</div>`
                    : `<div class="cv-card-fallback">${esc(item.title || "")}</div>`
                }
                <div class="cv-card-top">
                  <span class="cv-card-lang" style="color:${statusColor}">${esc(statusText)}</span>
                  ${item.quality ? `<span class="cv-card-rate">${esc(item.quality)}</span>` : ""}
                </div>
              </div>
              <h3 class="cv-card-title">${esc(item.title || "Offline Video")}</h3>
              <div style="font-size:11px;color:#94a3b8;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${esc([item.episodeLabel || "Movie", sizeLabel].filter(Boolean).join(" · "))}
              </div>
              ${
                !isComplete
                  ? `<div style="height:4px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:6px"><i style="display:block;width:${pct}%;height:100%;background:linear-gradient(90deg,#fb7185,#ef4444)"></i></div>`
                  : ""
              }
            </a>
            <div class="cv-saved-item-bar">
              ${
                isComplete
                  ? `<a class="cv-saved-mini-btn fav" href="${esc(playHref)}" style="text-decoration:none;text-align:center">▶ Play</a>
                     <button type="button" class="cv-saved-mini-btn" data-offline-export="${esc(item.id)}" title="Save MP4 file to device">⬇ MP4</button>`
                  : isDownloading
                    ? `<button type="button" class="cv-saved-mini-btn" data-offline-pause="${esc(item.id)}">⏸ Pause</button>`
                    : `<button type="button" class="cv-saved-mini-btn fav" data-offline-resume="${esc(item.id)}">▶ Resume</button>`
              }
              <button type="button" class="cv-saved-mini-btn remove" data-offline-delete="${esc(item.id)}" title="Delete offline copy">Delete</button>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:11px 14px;margin-bottom:14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font-size:12px;color:#cbd5e1">
        <span>📥 <b>Offline Library:</b> ${est.completeCount} ready · ${offlineItems.length} total (${esc(usedText)}${esc(quotaText)})</span>
        <span style="color:#86efac">Works offline without internet</span>
      </div>
      <div class="cv-poster-grid" style="margin-bottom:22px">${cards}</div>
    `;
  }

  function renderSync() {
    const items = getWatchlist();
    const offlineItems = offlineItemsCache;
    const favCount = items.filter(x => x.folder === "favorites").length;
    const laterCount = items.filter(x => x.folder === "watchLater").length;

    const heading = $("#cvSavedHeading");
    if (heading) heading.textContent = `My List & Saved Downloads (${items.length + offlineItems.length})`;

    const folderTabs = $("#cvFolderTabs");
    if (folderTabs) {
      const folderDefs = [
        { id: "all", label: `All (${items.length + offlineItems.length})` },
        { id: "offline", label: `Offline (${offlineItems.length})` },
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

    const body = $("#cvSavedBody");
    if (!body) return;

    if (activeFolder === "offline") {
      body.innerHTML = renderOfflineSectionHtml(offlineItems, storageEstimateCache);
      return;
    }

    const visible =
      activeFolder === "all" ? items : items.filter(x => x.folder === activeFolder);

    const offlineBlock =
      activeFolder === "all" && offlineItems.length
        ? renderOfflineSectionHtml(offlineItems, storageEstimateCache)
        : "";

    if (!visible.length && !offlineBlock) {
      body.innerHTML = `
        <div class="cv-saved-empty">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <p>No movies saved in this folder yet</p>
          <a class="cv-discover-cta" href="./">Discover Movies</a>
        </div>
      `;
      return;
    }

    const watchlistGrid = visible.length
      ? `<div class="cv-poster-grid">
          ${visible
            .map(item => {
              const poster = safeImg(item.poster || item.rawPoster);
              const rawFb = /^(?:https?:\/\/|\/\/)/i.test(String(item.rawPoster || "")) ? String(item.rawPoster) : "";
              const fbAttr = rawFb && rawFb !== poster ? ` data-fallback-src="${esc(rawFb)}"` : "";
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
                          ? `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(poster)}"${fbAttr} data-poster-img="1" alt="${esc(item.title || "")}"><div class="cv-card-fallback" hidden>${esc(item.title || "")}</div>`
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
        </div>`
      : "";

    body.innerHTML = offlineBlock + watchlistGrid;
  }

  async function render() {
    if (window.CineVerseOffline) {
      try {
        const [list, est] = await Promise.all([
          window.CineVerseOffline.listDownloads(),
          window.CineVerseOffline.getStorageEstimate()
        ]);
        offlineItemsCache = Array.isArray(list) ? list : [];
        storageEstimateCache = est || storageEstimateCache;
      } catch {}
    }
    renderSync();
  }

  $("#cvFolderTabs")?.addEventListener("click", e => {
    const tab = e.target.closest("[data-folder]");
    if (!tab) return;
    activeFolder = tab.dataset.folder || "all";
    renderSync();
  });

  $("#cvSavedBody")?.addEventListener("click", async e => {
    const pauseBtn = e.target.closest("[data-offline-pause]");
    if (pauseBtn && window.CineVerseOffline) {
      window.CineVerseOffline.pauseDownload(pauseBtn.dataset.offlinePause);
      showToast("Download paused");
      return;
    }
    const resumeBtn = e.target.closest("[data-offline-resume]");
    if (resumeBtn && window.CineVerseOffline) {
      const id = resumeBtn.dataset.offlineResume;
      showToast("Resuming offline download…");
      window.CineVerseOffline.resumeDownload(id).catch(err => {
        if (err?.name !== "AbortError") showToast(err?.message || "Resume failed");
      });
      return;
    }
    const exportBtn = e.target.closest("[data-offline-export]");
    if (exportBtn && window.CineVerseOffline) {
      try {
        showToast("Preparing MP4 download…");
        const fname = await window.CineVerseOffline.exportToDevice(exportBtn.dataset.offlineExport);
        showToast(`Saved: ${fname}`);
      } catch (err) {
        showToast(err?.message || "Export failed");
      }
      return;
    }
    const delOffBtn = e.target.closest("[data-offline-delete]");
    if (delOffBtn && window.CineVerseOffline) {
      await window.CineVerseOffline.deleteDownload(delOffBtn.dataset.offlineDelete);
      showToast("Deleted offline download");
      render();
      return;
    }

    const favBtn = e.target.closest("[data-toggle-fav]");
    if (favBtn) {
      const targetPath = favBtn.dataset.toggleFav;
      const list = getWatchlist().map(x =>
        x.path === targetPath ? { ...x, folder: x.folder === "favorites" ? "watchLater" : "favorites" } : x
      );
      saveList(WATCHLIST_KEY, list);
      renderSync();
      showToast("Updated folder");
      return;
    }
    const rmBtn = e.target.closest("[data-remove-saved]");
    if (rmBtn) {
      const targetPath = rmBtn.dataset.removeSaved;
      const list = getWatchlist().filter(x => x.path !== targetPath);
      saveList(WATCHLIST_KEY, list);
      renderSync();
      showToast("Removed from saved list");
    }
  });

  window.addEventListener("cv:offline-change", () => {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      render();
    }, 180);
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

      renderSync();
      showToast(`Restored ${incomingList.length} saved titles`);
    } catch {
      showToast("Invalid backup JSON file");
    } finally {
      e.target.value = "";
    }
  });

  if (!window.__cvPosterRecoveryInstalled) {
    window.__cvPosterRecoveryInstalled = true;
    document.addEventListener("error", e => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.posterImg) return;
      const fb = img.dataset.fallbackSrc || "";
      if (fb && !img.dataset.triedFb) {
        img.dataset.triedFb = "1";
        img.src = fb;
        return;
      }
      const curSrc = img.getAttribute("src") || "";
      if (!img.dataset.retried && curSrc.startsWith("/api/moviebox-image/")) {
        img.dataset.retried = "1";
        setTimeout(() => {
          if (!img.isConnected) return;
          img.src = curSrc + (curSrc.includes("?") ? "&" : "?") + "r=1";
        }, 450);
        return;
      }
      if (!img.dataset.svgFb && img.alt) {
        img.dataset.svgFb = "1";
        img.src = `/api/poster/${encodeURIComponent(img.alt.slice(0, 80))}.svg`;
        return;
      }
      const sib = img.nextElementSibling;
      if (sib && (sib.classList?.contains("cv-card-fallback") || sib.classList?.contains("cv-rank-thumb-fallback"))) {
        img.style.display = "none";
        sib.hidden = false;
      } else {
        img.style.visibility = "hidden";
      }
    }, true);
  }

  render();
})();
