(() => {
  "use strict";

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const safeImg = u => {
    const s = String(u || "");
    if (/^(?:https?:\/\/|\/api\/)/i.test(s)) return s;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
    return "";
  };

  function fmtBytes(raw) {
    if (window.CineVerseOffline?.formatBytes) return window.CineVerseOffline.formatBytes(raw);
    const n = Number(raw) || 0;
    if (n <= 0) return "0 MB";
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  function fmtSpeed(bps) {
    const n = Number(bps) || 0;
    if (n <= 0) return "";
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB/s`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB/s`;
    return `${Math.round(n)} B/s`;
  }

  const EXPORTED_SESSION_KEY = "cv_dl_exported_v1";

  const state = {
    open: false,
    activeTab: "downloading", // "downloading" | "completed" | "paused" | "failed"
    items: [],
    storage: { count: 0, completeCount: 0, offlineBytes: 0, quota: 0, usage: 0 },
    userPickedTab: false,
    refreshTimer: null,
    pollTimer: null,
    noticeTimer: null
  };

  function hasAutoExported(id) {
    try {
      const map = JSON.parse(sessionStorage.getItem(EXPORTED_SESSION_KEY) || "{}");
      return Boolean(map && map[id]);
    } catch {
      return false;
    }
  }

  function markAutoExported(id) {
    try {
      const map = JSON.parse(sessionStorage.getItem(EXPORTED_SESSION_KEY) || "{}");
      map[id] = Date.now();
      sessionStorage.setItem(EXPORTED_SESSION_KEY, JSON.stringify(map));
    } catch {}
  }

  async function triggerPendingDeviceExport(item) {
    if (!item?.id || item.status !== "complete" || !item.pendingDeviceExport) return;
    if (hasAutoExported(item.id)) return;
    markAutoExported(item.id);
    if (!window.CineVerseOffline?.exportToDevice) return;
    try {
      const fname = await window.CineVerseOffline.exportToDevice(item.id);
      showToast(`Saving to device storage: ${fname}`);
    } catch {
      showToast("Download ready — tap Save MP4 to save to your device.");
    }
  }

  let rootEl = null;

  function showToast(msg) {
    document.querySelector(".cv-toast")?.remove();
    const t = document.createElement("div");
    t.className = "cv-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function classifyItem(item) {
    const off = window.CineVerseOffline;
    if (!item) return "paused";
    if (item.status === "complete") return "completed";
    if (item.status === "downloading" || off?.isActive?.(item.id)) return "downloading";
    if (item.status === "queued" || off?.isQueued?.(item.id)) return "queued";
    if (item.status === "error") return "failed";
    return "paused";
  }

  function computeSummary(items) {
    let downloading = 0;
    let queued = 0;
    let completed = 0;
    let paused = 0;
    let failed = 0;
    let pctSum = 0;
    let pctCount = 0;

    for (const item of items) {
      const cat = classifyItem(item);
      if (cat === "downloading") {
        downloading++;
        const total = Number(item.totalBytes || 0);
        const done = Number(item.downloadedBytes || 0);
        if (total > 0) {
          pctSum += Math.min(100, (done / total) * 100);
          pctCount++;
        }
      } else if (cat === "queued") {
        queued++;
      } else if (cat === "completed") {
        completed++;
      } else if (cat === "failed") {
        failed++;
      } else {
        paused++;
      }
    }

    return {
      downloading,
      queued,
      downloadingTotal: downloading + queued,
      completed,
      paused,
      failed,
      total: items.length,
      avgPct: pctCount > 0 ? Math.round(pctSum / pctCount) : downloading > 0 ? 15 : 0
    };
  }

  function ensureRoot() {
    if (rootEl) return rootEl;
    if (document.getElementById("cvDlManagerRoot")) {
      rootEl = document.getElementById("cvDlManagerRoot");
      return rootEl;
    }

    const wrap = document.createElement("div");
    wrap.id = "cvDlManagerRoot";
    wrap.className = "cv-dl-root";
    wrap.innerHTML = `
      <div id="cvDlNoticeHost" class="cv-dl-notice-host" aria-live="polite"></div>

      <button type="button" id="cvDlFab" class="cv-dl-fab" aria-label="Open Download Manager" aria-expanded="false" aria-controls="cvDlDrawer">
        <svg class="cv-dl-fab-ring" viewBox="0 0 52 52" aria-hidden="true">
          <circle class="cv-dl-fab-track" cx="26" cy="26" r="23" />
          <circle id="cvDlFabArc" class="cv-dl-fab-arc" cx="26" cy="26" r="23" stroke-dasharray="144.51" stroke-dashoffset="144.51" />
        </svg>
        <span class="cv-dl-fab-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </span>
        <span id="cvDlFabBadge" class="cv-dl-fab-badge" hidden>0</span>
      </button>

      <div id="cvDlBackdrop" class="cv-dl-backdrop" hidden></div>

      <aside id="cvDlDrawer" class="cv-dl-drawer" role="dialog" aria-modal="true" aria-labelledby="cvDlTitle" hidden>
        <div class="cv-dl-handle" aria-hidden="true"></div>

        <header class="cv-dl-header">
          <div class="cv-dl-title-col">
            <h2 id="cvDlTitle" class="cv-dl-title">Download Manager</h2>
            <p id="cvDlSubtitle" class="cv-dl-subtitle">0 MB saved</p>
          </div>
          <div class="cv-dl-header-actions">
            <button type="button" id="cvDlNotifyBtn" class="cv-dl-icon-btn" title="Enable download completion alerts" aria-label="Enable download notifications" hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </button>
            <button type="button" id="cvDlCloseBtn" class="cv-dl-icon-btn" aria-label="Close Download Manager">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </header>

        <div id="cvDlTabs" class="cv-dl-tabs" role="tablist" aria-label="Download status filters"></div>
        <div id="cvDlBulkBar" class="cv-dl-bulk-bar" hidden></div>
        <div id="cvDlList" class="cv-dl-list"></div>

        <footer class="cv-dl-footer">
          <span class="cv-dl-footer-note">Continues downloading while you browse</span>
          <a class="cv-dl-footer-link" href="saved.html?tab=offline">Offline Library →</a>
        </footer>
      </aside>
    `;

    document.body.appendChild(wrap);
    rootEl = wrap;
    bindEvents();
    return wrap;
  }

  function renderFab(summary) {
    const fab = document.getElementById("cvDlFab");
    const badge = document.getElementById("cvDlFabBadge");
    const arc = document.getElementById("cvDlFabArc");
    if (!fab || !badge || !arc) return;

    const activeCount = summary.downloadingTotal;
    fab.classList.toggle("is-active", activeCount > 0);
    fab.setAttribute("aria-expanded", String(state.open));

    const circumference = 144.51;
    if (activeCount > 0) {
      const pct = Math.max(8, Math.min(100, summary.avgPct));
      arc.style.strokeDashoffset = String(circumference - (circumference * pct) / 100);
      badge.textContent = String(activeCount);
      badge.hidden = false;
      badge.classList.remove("is-paused");
    } else if (summary.paused > 0) {
      arc.style.strokeDashoffset = String(circumference);
      badge.textContent = String(summary.paused);
      badge.hidden = false;
      badge.classList.add("is-paused");
    } else if (summary.completed > 0) {
      arc.style.strokeDashoffset = String(circumference);
      badge.textContent = String(summary.completed);
      badge.hidden = false;
      badge.classList.add("is-complete");
    } else {
      arc.style.strokeDashoffset = String(circumference);
      badge.hidden = true;
      badge.classList.remove("is-paused", "is-complete");
    }
  }

  function renderDrawer() {
    ensureRoot();
    const items = state.items;
    const summary = computeSummary(items);
    renderFab(summary);

    // Smart auto-tab selection on open if user hasn't explicitly picked a tab
    if (!state.userPickedTab) {
      if (summary.downloadingTotal > 0) state.activeTab = "downloading";
      else if (summary.paused > 0) state.activeTab = "paused";
      else if (summary.failed > 0) state.activeTab = "failed";
      else if (summary.completed > 0) state.activeTab = "completed";
      else state.activeTab = "downloading";
    }

    const subtitle = document.getElementById("cvDlSubtitle");
    if (subtitle) {
      const used = fmtBytes(state.storage.offlineBytes || 0);
      const parts = [`${used} saved`];
      if (summary.downloadingTotal > 0) parts.push(`${summary.downloadingTotal} active`);
      else if (summary.completed > 0) parts.push(`${summary.completed} ready offline`);
      subtitle.textContent = parts.join(" · ");
    }

    const notifyBtn = document.getElementById("cvDlNotifyBtn");
    if (notifyBtn) {
      const perm = window.CineVerseOffline?.getNotificationPermission?.() || "unsupported";
      notifyBtn.hidden = perm !== "default";
    }

    const tabsEl = document.getElementById("cvDlTabs");
    if (tabsEl) {
      const defs = [
        { id: "downloading", label: `Downloading (${summary.downloadingTotal})` },
        { id: "completed", label: `Completed (${summary.completed})` },
        { id: "paused", label: `Paused (${summary.paused})` },
        { id: "failed", label: `Failed (${summary.failed})` }
      ];
      tabsEl.innerHTML = defs
        .map(
          t => `<button type="button" class="cv-dl-tab ${state.activeTab === t.id ? "active" : ""}" data-dl-tab="${t.id}" role="tab" aria-selected="${state.activeTab === t.id}">${esc(t.label)}</button>`
        )
        .join("");
    }

    const filtered = items.filter(item => {
      const cat = classifyItem(item);
      if (state.activeTab === "downloading") return cat === "downloading" || cat === "queued";
      if (state.activeTab === "completed") return cat === "completed";
      if (state.activeTab === "paused") return cat === "paused";
      if (state.activeTab === "failed") return cat === "failed";
      return true;
    });

    const bulkBar = document.getElementById("cvDlBulkBar");
    if (bulkBar) {
      if (state.activeTab === "downloading" && summary.downloadingTotal > 0) {
        bulkBar.hidden = false;
        bulkBar.innerHTML = `
          <span class="cv-dl-bulk-info">${summary.downloading} active${summary.queued ? ` · ${summary.queued} waiting in queue` : ""}</span>
          <button type="button" class="cv-dl-bulk-btn" data-dl-bulk="pause-all">Pause All</button>
        `;
      } else if ((state.activeTab === "paused" && summary.paused > 0) || (state.activeTab === "failed" && summary.failed > 0)) {
        bulkBar.hidden = false;
        bulkBar.innerHTML = `
          <span class="cv-dl-bulk-info">Resume saved progress without restarting</span>
          <button type="button" class="cv-dl-bulk-btn is-primary" data-dl-bulk="resume-all">Resume All</button>
        `;
      } else if (state.activeTab === "completed" && summary.completed > 0) {
        bulkBar.hidden = false;
        bulkBar.innerHTML = `
          <span class="cv-dl-bulk-info">Ready to play without internet</span>
          <button type="button" class="cv-dl-bulk-btn is-danger" data-dl-bulk="clear-completed">Clear Completed</button>
        `;
      } else {
        bulkBar.hidden = true;
        bulkBar.innerHTML = "";
      }
    }

    const listEl = document.getElementById("cvDlList");
    if (!listEl) return;

    if (!filtered.length) {
      const emptyCopy = {
        downloading: {
          title: "No active downloads",
          hint: "Tap Save Offline on any movie or episode — it will keep downloading while you browse."
        },
        completed: {
          title: "No completed offline videos yet",
          hint: "Finished downloads appear here so you can watch offline or save MP4 files anytime."
        },
        paused: {
          title: "No paused downloads",
          hint: "Paused downloads keep downloaded chunks safely saved so you can resume later."
        },
        failed: {
          title: "No failed downloads",
          hint: "Any interrupted downloads will wait here safely for one-tap resume."
        }
      }[state.activeTab];

      listEl.innerHTML = `
        <div class="cv-dl-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <h3>${esc(emptyCopy.title)}</h3>
          <p>${esc(emptyCopy.hint)}</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered
      .map(item => {
        const cat = classifyItem(item);
        const poster = safeImg(item.posterDataUrl || item.posterFallbackUrl || item.rawPoster);
        const total = Number(item.totalBytes || 0);
        const done = Number(item.downloadedBytes || 0);
        const pct = cat === "completed" ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const speed = cat === "downloading" ? fmtSpeed(item.speedBps) : "";
        const metaParts = [
          item.episodeLabel || "Movie",
          item.quality || "HD",
          item.saveToDevice ? "Direct to Device" : ""
        ].filter(Boolean);
        const sizeLabel = total > 0 && cat !== "completed"
          ? `${fmtBytes(done)} / ${fmtBytes(total)}`
          : fmtBytes(done || total);

        let leftStatusHtml = "";
        if (cat === "downloading") {
          const pctLabel = total > 0 ? `${pct}%` : "Starting";
          leftStatusHtml = `<span class="cv-dl-status-text is-active">${esc(pctLabel)}${speed ? ` · ${esc(speed)}` : ""}</span>`;
        } else if (cat === "queued") {
          leftStatusHtml = `<span class="cv-dl-status-text is-queued">Waiting for Download</span>`;
        } else if (cat === "paused") {
          leftStatusHtml = `<span class="cv-dl-status-text is-paused">Paused${total > 0 ? ` · ${pct}%` : ""}</span>`;
        } else if (cat === "failed") {
          leftStatusHtml = `<span class="cv-dl-status-text is-failed" title="${esc(item.error || "Download interrupted")}">Failed · Tap Resume</span>`;
        } else {
          leftStatusHtml = `<span class="cv-dl-status-text is-complete">✓ Offline Ready</span>`;
        }

        const watchUrl = `watch.html?offline=${encodeURIComponent(item.id)}`;
        const showProgress = cat !== "completed";
        const isIndeterminate = cat === "downloading" && total <= 0;

        let actionsHtml = "";
        if (cat === "downloading" || cat === "queued") {
          actionsHtml = `
            <button type="button" class="cv-dl-act-btn" data-dl-pause="${esc(item.id)}" aria-label="Pause ${esc(item.title)}" title="Pause">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            </button>
            <button type="button" class="cv-dl-act-btn is-danger" data-dl-cancel="${esc(item.id)}" aria-label="Cancel ${esc(item.title)}" title="Cancel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          `;
        } else if (cat === "paused" || cat === "failed") {
          actionsHtml = `
            <button type="button" class="cv-dl-act-btn is-primary" data-dl-resume="${esc(item.id)}" aria-label="Resume ${esc(item.title)}" title="Resume">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            </button>
            <button type="button" class="cv-dl-act-btn is-danger" data-dl-cancel="${esc(item.id)}" aria-label="Remove ${esc(item.title)}" title="Cancel & Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          `;
        } else {
          actionsHtml = `
            <a class="cv-dl-act-btn is-primary" href="${esc(watchUrl)}" aria-label="Play ${esc(item.title)} offline" title="Watch Offline">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            </a>
            <button type="button" class="cv-dl-act-btn" data-dl-export="${esc(item.id)}" aria-label="Save MP4 file for ${esc(item.title)}" title="Save MP4 to Device">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button type="button" class="cv-dl-act-btn is-danger" data-dl-cancel="${esc(item.id)}" aria-label="Delete ${esc(item.title)}" title="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          `;
        }

        return `
          <article class="cv-dl-item" data-dl-id="${esc(item.id)}">
            <a class="cv-dl-thumb" href="${esc(cat === "completed" ? watchUrl : item.path ? `watch.html?path=${encodeURIComponent(item.path)}&title=${encodeURIComponent(item.title || "")}` : "#")}">
              ${
                poster
                  ? `<img src="${esc(poster)}" referrerpolicy="no-referrer" alt="${esc(item.title || "")}" loading="lazy"><div class="cv-dl-thumb-fallback" hidden>${esc((item.title || "M").slice(0, 2).toUpperCase())}</div>`
                  : `<div class="cv-dl-thumb-fallback">${esc((item.title || "M").slice(0, 2).toUpperCase())}</div>`
              }
              ${cat === "completed" ? '<span class="cv-dl-thumb-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg></span>' : ""}
            </a>
            <div class="cv-dl-info">
              <h3 class="cv-dl-item-title">${esc(item.title || "MovieStream BD Video")}</h3>
              <div class="cv-dl-item-meta">${esc(metaParts.join(" · "))}</div>
              ${
                showProgress
                  ? `<div class="cv-dl-progress ${isIndeterminate ? "is-indeterminate" : ""} ${cat === "paused" ? "is-paused" : ""} ${cat === "failed" ? "is-failed" : ""}"><i style="width:${isIndeterminate ? 36 : pct}%"></i></div>`
                  : ""
              }
              <div class="cv-dl-item-stats">
                ${leftStatusHtml}
                <span class="cv-dl-size">${esc(sizeLabel)}</span>
              </div>
            </div>
            <div class="cv-dl-item-actions">${actionsHtml}</div>
          </article>
        `;
      })
      .join("");
  }

  function syncPollTimer(summary) {
    if (state.open && summary && summary.downloadingTotal > 0) {
      if (!state.pollTimer) {
        state.pollTimer = setInterval(() => {
          if (state.open) refresh();
        }, 3500);
      }
    } else if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function updateItemProgressInPlace(detail) {
    if (!detail?.id) return false;
    const item = state.items.find(x => x && x.id === detail.id);
    if (!item || item.status === "complete") return false;

    const total = Number(detail.totalBytes || item.totalBytes || 0);
    const done = Number(detail.downloadedBytes ?? item.downloadedBytes ?? 0);
    const speedBps = Number(detail.speedBps || 0);
    item.downloadedBytes = done;
    if (total > 0) item.totalBytes = total;
    item.speedBps = speedBps;
    item.status = "downloading";

    const summary = computeSummary(state.items);
    renderFab(summary);

    if (!state.open || state.activeTab !== "downloading") return true;

    const listEl = document.getElementById("cvDlList");
    const rowEl = [...(listEl?.querySelectorAll(".cv-dl-item[data-dl-id]") || [])].find(el => el.dataset.dlId === detail.id);
    if (!rowEl) return false;

    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const isIndeterminate = total <= 0;
    const progressEl = rowEl.querySelector(".cv-dl-progress");
    const barEl = progressEl?.querySelector("i");
    if (progressEl) {
      progressEl.classList.toggle("is-indeterminate", isIndeterminate);
      progressEl.classList.remove("is-paused", "is-failed");
    }
    if (barEl) {
      barEl.style.width = `${isIndeterminate ? 36 : pct}%`;
    }

    const statusEl = rowEl.querySelector(".cv-dl-status-text");
    if (statusEl) {
      const speed = fmtSpeed(speedBps);
      const pctLabel = total > 0 ? `${pct}%` : "Starting";
      statusEl.className = "cv-dl-status-text is-active";
      statusEl.textContent = `${pctLabel}${speed ? ` · ${speed}` : ""}`;
    }

    const sizeEl = rowEl.querySelector(".cv-dl-size");
    if (sizeEl) {
      sizeEl.textContent = total > 0 ? `${fmtBytes(done)} / ${fmtBytes(total)}` : fmtBytes(done);
    }

    return true;
  }

  async function refresh() {
    if (!window.CineVerseOffline) return;
    try {
      const [items, storage] = await Promise.all([
        window.CineVerseOffline.listDownloads(),
        window.CineVerseOffline.getStorageEstimate()
      ]);
      state.items = Array.isArray(items) ? items : [];
      state.storage = storage || state.storage;
      renderDrawer();
      syncPollTimer(computeSummary(state.items));
      for (const item of state.items) {
        if (item && item.status === "complete" && item.pendingDeviceExport) {
          triggerPendingDeviceExport(item);
        }
      }
    } catch {}
  }

  function scheduleRefresh(delayMs = 120) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(refresh, delayMs);
  }

  function open(tabName = "") {
    ensureRoot();
    if (tabName) {
      state.activeTab = tabName;
      state.userPickedTab = true;
    } else {
      state.userPickedTab = false;
    }
    state.open = true;
    const backdrop = document.getElementById("cvDlBackdrop");
    const drawer = document.getElementById("cvDlDrawer");
    if (backdrop) {
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add("is-open"));
    }
    if (drawer) {
      drawer.hidden = false;
      requestAnimationFrame(() => drawer.classList.add("is-open"));
    }
    document.body.classList.add("cv-dl-open");
    refresh();
  }

  function close() {
    state.open = false;
    syncPollTimer(null);
    const backdrop = document.getElementById("cvDlBackdrop");
    const drawer = document.getElementById("cvDlDrawer");
    const fab = document.getElementById("cvDlFab");
    if (fab) fab.setAttribute("aria-expanded", "false");
    if (backdrop) {
      backdrop.classList.remove("is-open");
      setTimeout(() => { if (!state.open) backdrop.hidden = true; }, 220);
    }
    if (drawer) {
      drawer.classList.remove("is-open");
      setTimeout(() => { if (!state.open) drawer.hidden = true; }, 220);
    }
    document.body.classList.remove("cv-dl-open");
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function showCompletionBanner(detail) {
    ensureRoot();
    const host = document.getElementById("cvDlNoticeHost");
    if (!host || !detail?.id) return;

    const poster = safeImg(detail.posterDataUrl || detail.posterFallbackUrl);
    const label = detail.episodeLabel ? `${detail.title} (${detail.episodeLabel})` : detail.title || "Video";
    const sizeTxt = fmtBytes(detail.totalBytes || 0);
    const watchHref = `watch.html?offline=${encodeURIComponent(detail.id)}`;
    const heading = detail.saveToDevice ? "Ready — Saving MP4" : "Download Complete";

    host.innerHTML = `
      <div class="cv-dl-notice-banner" role="status">
        ${poster ? `<img src="${esc(poster)}" referrerpolicy="no-referrer" alt="">` : ""}
        <div class="cv-dl-notice-copy">
          <b>${esc(heading)}</b>
          <span>${esc(label)}${sizeTxt ? ` · ${esc(sizeTxt)}` : ""}</span>
        </div>
        <button type="button" class="cv-dl-notice-save" data-dl-export="${esc(detail.id)}">⬇ Save MP4</button>
        <a class="cv-dl-notice-play" href="${esc(watchHref)}">▶ Watch</a>
        <button type="button" class="cv-dl-notice-close" aria-label="Dismiss notification">✕</button>
      </div>
    `;

    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => {
      host.innerHTML = "";
    }, detail.saveToDevice ? 9500 : 7500);
  }

  function bindEvents() {
    const root = rootEl;
    if (!root) return;

    document.getElementById("cvDlFab")?.addEventListener("click", toggle);
    document.getElementById("cvDlBackdrop")?.addEventListener("click", close);
    document.getElementById("cvDlCloseBtn")?.addEventListener("click", close);

    document.getElementById("cvDlNotifyBtn")?.addEventListener("click", async () => {
      const perm = await window.CineVerseOffline?.requestNotificationPermission?.();
      if (perm === "granted") {
        showToast("Download completion alerts enabled!");
      } else {
        showToast("Notifications blocked — in-app alerts stay active.");
      }
      renderDrawer();
    });

    root.addEventListener("click", async e => {
      const dismissNotice = e.target.closest(".cv-dl-notice-close");
      if (dismissNotice) {
        const host = document.getElementById("cvDlNoticeHost");
        if (host) host.innerHTML = "";
        return;
      }

      const tabBtn = e.target.closest("[data-dl-tab]");
      if (tabBtn) {
        state.activeTab = tabBtn.dataset.dlTab || "downloading";
        state.userPickedTab = true;
        renderDrawer();
        return;
      }

      const bulkBtn = e.target.closest("[data-dl-bulk]");
      if (bulkBtn && window.CineVerseOffline) {
        const action = bulkBtn.dataset.dlBulk;
        if (action === "pause-all") {
          await window.CineVerseOffline.pauseAll();
          showToast("Paused all active downloads");
        } else if (action === "resume-all") {
          await window.CineVerseOffline.resumeAll();
          showToast("Resuming paused downloads…");
        } else if (action === "clear-completed") {
          await window.CineVerseOffline.clearCompleted();
          showToast("Cleared completed downloads");
        }
        scheduleRefresh(80);
        return;
      }

      const pauseBtn = e.target.closest("[data-dl-pause]");
      if (pauseBtn && window.CineVerseOffline) {
        await window.CineVerseOffline.pauseDownload(pauseBtn.dataset.dlPause);
        showToast("Download paused — saved progress kept");
        scheduleRefresh(60);
        return;
      }

      const resumeBtn = e.target.closest("[data-dl-resume]");
      if (resumeBtn && window.CineVerseOffline) {
        const id = resumeBtn.dataset.dlResume;
        showToast("Resuming download…");
        window.CineVerseOffline.resumeDownload(id).catch(err => {
          if (err?.name !== "AbortError") showToast(err?.message || "Resume failed");
        });
        scheduleRefresh(80);
        return;
      }

      const cancelBtn = e.target.closest("[data-dl-cancel]");
      if (cancelBtn && window.CineVerseOffline) {
        await window.CineVerseOffline.deleteDownload(cancelBtn.dataset.dlCancel);
        showToast("Download removed");
        scheduleRefresh(60);
        return;
      }

      const exportBtn = e.target.closest("[data-dl-export]");
      if (exportBtn && window.CineVerseOffline) {
        try {
          showToast("Saving MP4 to your device…");
          const fname = await window.CineVerseOffline.exportToDevice(exportBtn.dataset.dlExport);
          showToast(`Saved: ${fname}`);
        } catch (err) {
          showToast(err?.message || "Export failed");
        }
      }
    });

    root.addEventListener(
      "error",
      e => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        const sib = img.nextElementSibling;
        if (sib && sib.classList.contains("cv-dl-thumb-fallback")) {
          img.style.display = "none";
          sib.hidden = false;
        }
      },
      true
    );

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && state.open) close();
    });

    document.addEventListener("fullscreenchange", () => {
      const fab = document.getElementById("cvDlFab");
      if (fab) fab.style.display = document.fullscreenElement ? "none" : "";
    });
  }

  function boot() {
    ensureRoot();
    window.addEventListener("cv:offline-change", ev => {
      const detail = ev?.detail;
      if (detail?.status === "downloading" && updateItemProgressInPlace(detail)) {
        return;
      }
      scheduleRefresh(detail?.status === "downloading" ? 320 : 120);
    });
    window.addEventListener("cv:offline-complete", ev => {
      scheduleRefresh(50);
      if (ev?.detail) {
        showCompletionBanner(ev.detail);
        if (ev.detail.saveToDevice || ev.detail.pendingDeviceExport) {
          triggerPendingDeviceExport({ ...ev.detail, status: "complete", pendingDeviceExport: true });
        }
      }
    });
    if (window.CineVerseOffline?.ready) {
      window.CineVerseOffline.ready().then(() => refresh());
    }
    refresh();
  }

  window.CineVerseDownloadManager = {
    open,
    close,
    toggle,
    refresh
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
