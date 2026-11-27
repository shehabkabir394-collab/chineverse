import fs from "node:fs";
import path from "node:path";
import { signMediaToken } from "../moviebox-api.js";

export const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";

export const CINEPULSE_ALLOWED_ROUTES = new Set([
  "home",
  "reels",
  "categories",
  "catalog",
  "search",
  "suggest",
  "updates-24h",
  "details",
  "stream",
  "captions",
  "related",
  "comments",
  "staff",
  "trending",
  "ranking",
  "hot-search",
  "filter",
  "filter-options",
  "platform",
  "upcoming",
  "sports/matches",
  "sports/leagues",
  "bottom-tabs",
  "app-info",
  "status"
]);

export const CINEPULSE_SOURCE_DEFAULT_ROUTES = new Set([
  "home",
  "catalog",
  "search",
  "suggest",
  "updates-24h",
  "trending",
  "ranking",
  "filter",
  "platform"
]);

export function loadDotEnvIfPresent(envFilePath = path.resolve(process.cwd(), ".env")) {
  try {
    if (!fs.existsSync(envFilePath)) return false;
    const raw = fs.readFileSync(envFilePath, "utf8");
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = val;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function getCinePulseApiKey() {
  return String(process.env.CINEPULSE_API_KEY || "").trim();
}

export function isCinePulseConfigured() {
  return Boolean(getCinePulseApiKey());
}

export function normalizeCinePulseRoute(rawRoute = "") {
  let clean = String(rawRoute || "").trim().replace(/^\/+|\/+$/g, "");
  clean = clean.replace(/^v1\//i, "");
  return CINEPULSE_ALLOWED_ROUTES.has(clean) ? clean : "";
}

export function buildCinePulseUpstreamUrl(rawRoute, searchParams = "") {
  const route = normalizeCinePulseRoute(rawRoute);
  if (!route) return null;

  const query = searchParams instanceof URLSearchParams
    ? new URLSearchParams(searchParams.toString())
    : new URLSearchParams(searchParams && typeof searchParams === "object" ? Object.entries(searchParams) : String(searchParams || ""));

  if (CINEPULSE_SOURCE_DEFAULT_ROUTES.has(route) && !query.has("source")) {
    query.set("source", "all");
  }
  if (route === "home" && !query.has("lang")) {
    query.set("lang", "en");
  }

  const target = new URL(`/api/v1/${route}`, CINEPULSE_UPSTREAM);
  const qs = query.toString();
  if (qs) target.search = qs;
  return target;
}

export async function fetchCinePulseApi(rawRoute, params = {}, options = {}) {
  const target = buildCinePulseUpstreamUrl(rawRoute, params);
  if (!target) {
    return { ok: false, status: 404, error: `Unknown CinePulse route: ${rawRoute}`, data: null };
  }

  const apiKey = getCinePulseApiKey();
  if (!apiKey) {
    return { ok: false, status: 503, error: "CINEPULSE_API_KEY is not configured", data: null };
  }

  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      headers: {
        Accept: options.accept || "application/json",
        "x-api-key": apiKey,
        "User-Agent": "MovieStreamBD-Gateway/1.0"
      },
      signal: AbortSignal.timeout(options.timeoutMs || 15000)
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const isCloudflareBlock =
      res.status === 403 &&
      (
        /challenge/i.test(res.headers.get("cf-mitigated") || "") ||
        (!data && /Just a moment|Attention Required|cf-browser-verification|Cloudflare/i.test(text || ""))
      );
    const rawErrMsg = String(data?.error || data?.message || "").trim();
    const isAuthError = !isCloudflareBlock && (res.status === 401 || (res.status === 403 && /api\s*key|unauthoriz|expired|invalid\s*key|forbidden/i.test(rawErrMsg || text)));
    const isTemporary = res.status === 429 || res.status >= 500;
    const errorCode = isCloudflareBlock
      ? "CLOUDFLARE_403"
      : res.status === 401 || isAuthError
        ? "API_KEY_ERROR"
        : res.status === 429
          ? "RATE_LIMITED"
          : res.ok
            ? ""
            : `HTTP_${res.status}`;
    const errorMsg = res.ok
      ? ""
      : isCloudflareBlock
        ? "Upstream blocked by Cloudflare challenge (HTTP 403)"
        : (rawErrMsg || `CinePulse HTTP ${res.status}`);

    return {
      ok: res.ok && data !== null,
      status: res.status,
      data,
      rawText: data === null ? text : "",
      errorCode,
      isCloudflareBlock,
      isAuthError,
      isTemporary,
      error: errorMsg
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      errorCode: "UPSTREAM_UNREACHABLE",
      isCloudflareBlock: false,
      isAuthError: false,
      isTemporary: true,
      error: err?.message || "CinePulse upstream unreachable",
      data: null
    };
  }
}

function isSafeExternalHttp(rawUrl = "") {
  try {
    const u = new URL(String(rawUrl || "").trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function proxyCinePulseImageUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  if (s.startsWith("/api/")) return s;
  if (!isSafeExternalHttp(s)) return "";
  return `/api/moviebox-image/cp-poster.jpg?t=${encodeURIComponent(signMediaToken(s))}`;
}

export function rewriteCinePulseMediaUrl(rawUrl, kind = "stream", filename = "") {
  const s = String(rawUrl || "").trim();
  if (!s) return "";

  if (s.startsWith("/api/mb-stream.mp4")) {
    const q = s.includes("?") ? s.slice(s.indexOf("?")) : "";
    return `/api/cinepulse-media${q}`;
  }
  if (s.startsWith("/api/")) {
    return s;
  }
  if (!isSafeExternalHttp(s)) return "";

  try {
    const parsed = new URL(s);
    if (parsed.origin === CINEPULSE_UPSTREAM && parsed.pathname === "/api/mb-stream.mp4") {
      return `/api/cinepulse-media${parsed.search}`;
    }
  } catch {}

  if (kind === "subtitle") {
    return `/api/moviebox-subtitle/cp-sub.vtt?vtt=1&t=${encodeURIComponent(signMediaToken(s))}`;
  }
  if (kind === "hls" || /\.m3u8(?:$|[?#])/i.test(s) || /\/(?:hls|m)\//i.test(s)) {
    return `/api/mlbd-hls.m3u8?t=${encodeURIComponent(signMediaToken(s))}`;
  }
  const qs = new URLSearchParams({ t: signMediaToken(s) });
  if (filename) qs.set("filename", filename);
  return `/api/mlbd-stream.mp4?${qs.toString()}`;
}

function isMlbdLikeItem(item) {
  const p = String(item?.path || item?.detailPath || "");
  return item?.source === "movielinkbd" || /^\/(?:mlbd\/|movie\/|series\/|drama\/|anime\/)/i.test(p);
}

export function normalizeCinePulseItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pathVal = String(raw.path || raw.detailPath || "").trim();
  const isMlbd = isMlbdLikeItem(raw);
  const rawPoster = raw.poster || raw.previewImage || raw.cover || raw.image || "";
  const poster = proxyCinePulseImageUrl(rawPoster);
  const isSeries = Boolean(
    raw.isSeries ||
    raw.type === "series" ||
    raw.subjectType === 2 ||
    /^\/(?:mlbd\/)?(?:series|drama)\//i.test(pathVal)
  );
  const isAnime = Boolean(
    raw.isAnime ||
    raw.type === "anime" ||
    /^\/(?:mlbd\/)?anime\//i.test(pathVal)
  );

  const normalized = {
    ...raw,
    id: String(raw.id || raw.subjectId || pathVal || raw.title || ""),
    title: String(raw.title || raw.name || "Untitled"),
    year: String(raw.year || "").replace(/[^0-9]/g, "").slice(0, 4),
    rating: String(raw.rating || raw.imdbRatingValue || ""),
    poster: poster || rawPoster || "",
    previewImage: proxyCinePulseImageUrl(raw.previewImage || rawPoster) || poster || "",
    isSeries,
    isMovie: !isSeries,
    isAnime,
    type: isAnime ? "anime" : isSeries ? "series" : "movie",
    typeBadge: raw.typeBadge || (isAnime ? "Anime" : isSeries ? "Series" : "Movie"),
    source: raw.source || (isMlbd ? "movielinkbd" : "moviebox")
  };

  if (isMlbd && pathVal) {
    normalized.path = pathVal;
    normalized.detailsEndpoint = `/api/details?path=${encodeURIComponent(pathVal)}`;
  }
  return normalized;
}

export function normalizeCinePulseSources(sources = [], title = "") {
  return (Array.isArray(sources) ? sources : [])
    .map(s => {
      if (!s || typeof s !== "object") return null;
      const rawUrl = s.url || s.src || "";
      if (!rawUrl) return null;
      const isHls = /hls|mpegurl/i.test(String(s.format || s.mime || s.type || "")) || /\.m3u8(?:$|[?#])/i.test(rawUrl);
      const url = rewriteCinePulseMediaUrl(rawUrl, isHls ? "hls" : "stream", title ? `${title}.mp4` : "");
      if (!url) return null;
      return {
        ...s,
        url,
        format: s.format || (isHls ? "HLS" : "MP4"),
        mime: s.mime || (isHls ? "application/vnd.apple.mpegurl" : "video/mp4"),
        quality: String(s.quality || s.resolutions || s.label || "720p")
      };
    })
    .filter(Boolean);
}

export function normalizeCinePulseSubtitles(subtitles = []) {
  return (Array.isArray(subtitles) ? subtitles : [])
    .map(sub => {
      if (!sub || typeof sub !== "object") return null;
      const rawUrl = sub.url || sub.src || "";
      const url = rewriteCinePulseMediaUrl(rawUrl, "subtitle");
      if (!url) return null;
      return {
        ...sub,
        label: sub.label || sub.lanName || sub.language || sub.lang || "Subtitle",
        language: String(sub.language || sub.lan || sub.lang || "und"),
        url
      };
    })
    .filter(Boolean);
}

export function normalizeCinePulseDetail(rawDetail, fallbackPath = "") {
  if (!rawDetail || typeof rawDetail !== "object") return null;
  const title = String(rawDetail.title || rawDetail.name || "Untitled");
  const poster = proxyCinePulseImageUrl(rawDetail.poster || rawDetail.cover || rawDetail.image || "");
  const episodes = (Array.isArray(rawDetail.episodes) ? rawDetail.episodes : []).map((ep, idx) => ({
    ...ep,
    label: ep?.label || `Episode ${ep?.episodeNumber || ep?.ep || idx + 1}`,
    number: Number(ep?.number || ep?.episodeNumber || ep?.ep || idx + 1),
    episodeNumber: Number(ep?.episodeNumber || ep?.ep || ep?.number || idx + 1),
    seasonNumber: Number(ep?.seasonNumber ?? ep?.se ?? 0),
    se: Number(ep?.se ?? ep?.seasonNumber ?? 0),
    ep: Number(ep?.ep ?? ep?.episodeNumber ?? ep?.number ?? idx + 1),
    sources: normalizeCinePulseSources(ep?.sources, title),
    subtitles: normalizeCinePulseSubtitles(ep?.subtitles),
    audioTracks: Array.isArray(ep?.audioTracks) ? ep.audioTracks : [],
    downloadButtons: Array.isArray(ep?.downloadButtons) ? ep.downloadButtons : []
  }));
  const topSources = normalizeCinePulseSources(rawDetail.sources, title);
  const topSubs = normalizeCinePulseSubtitles(rawDetail.subtitles);
  const hasResource = Boolean(
    rawDetail.hasResource ||
    topSources.length > 0 ||
    episodes.some(e => e.sources.length > 0 || e.downloadButtons.length > 0)
  );

  return {
    ...rawDetail,
    title,
    path: rawDetail.path || fallbackPath || rawDetail.detailPath || "",
    poster: poster || rawDetail.poster || "",
    sources: topSources,
    subtitles: topSubs,
    episodes,
    totalEpisodes: rawDetail.totalEpisodes || episodes.length || 1,
    hasResource
  };
}

export function normalizeCinePulsePayload(route, payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };

  if (Array.isArray(out.items)) {
    out.items = out.items.map(normalizeCinePulseItem).filter(Boolean);
  }
  if (Array.isArray(out.trending)) {
    out.trending = out.trending.map(normalizeCinePulseItem).filter(Boolean);
  }
  if (Array.isArray(out.banners)) {
    out.banners = out.banners.map(normalizeCinePulseItem).filter(Boolean);
  }
  if (Array.isArray(out.sections)) {
    out.sections = out.sections
      .map(sec => ({
        ...sec,
        items: (Array.isArray(sec?.items) ? sec.items : []).map(normalizeCinePulseItem).filter(Boolean)
      }))
      .filter(sec => sec.items.length > 0);
  }
  if (Array.isArray(out.mlbdSections)) {
    out.mlbdSections = out.mlbdSections
      .map(sec => ({
        ...sec,
        items: (Array.isArray(sec?.items) ? sec.items : []).map(normalizeCinePulseItem).filter(Boolean)
      }))
      .filter(sec => sec.items.length > 0);
  }
  if (out.detail && typeof out.detail === "object") {
    out.detail = normalizeCinePulseDetail(out.detail);
  }
  if (route === "stream" || Array.isArray(out.sources) || (out.stream && typeof out.stream === "object")) {
    const title = out.title || "";
    const normSources = normalizeCinePulseSources(out.sources || out.stream?.sources, title);
    const normSubs = normalizeCinePulseSubtitles(out.subtitles || out.stream?.subtitles);
    out.sources = normSources;
    out.subtitles = normSubs;
    if (out.stream && typeof out.stream === "object") {
      out.stream = {
        ...out.stream,
        sources: normSources,
        subtitles: normSubs,
        hasResource: Boolean(out.stream.hasResource || normSources.length > 0)
      };
    }
  }
  return out;
}
