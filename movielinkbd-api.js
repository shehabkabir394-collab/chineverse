import { MOVIEBOX_UA, handleMovieBoxRoute, signMediaToken, verifyMediaToken } from "./moviebox-api.js";
import {
  fetchCinePulseApi,
  isCinePulseConfigured,
  normalizeCinePulseDetail,
  normalizeCinePulsePayload
} from "./lib/cinepulse-api.js";
import {
  isNigerianContent,
  isUpcomingUnreleased,
  isMusicOrClipSubject,
  strictTitleMatchScore,
  dedupeRepeatedTitleYear,
  parseEpisodeRangeFromTitle,
  cleanSearchTitleText,
  splitSearchTitleVariants,
  expandSearchQueryVariants,
  cleanYoutubeTrailerTitle,
  scoreSearchMatch,
  collectTitleSuggestions
} from "./lib/catalog-rules.js";

import {
  CHROME_SEC_HEADERS,
  curlHttpRequest,
  isCurlPreferredForHost,
  markCurlPreferredForHost
} from "./lib/http-transport.js";

export const MLBD_MIRRORS = [
  { id: "primary", name: "Primary", baseUrl: "https://rnztvk.movielinkbd.de", priority: 1 },
  { id: "alt-tv", name: "MovieLinkBD .tv", baseUrl: "https://movielinkbd.tv", priority: 2 },
  { id: "mirror1", name: "Mirror 1", baseUrl: "https://5njsa5.movielinkbd.de", priority: 3 },
  { id: "mirror2", name: "Mirror 2", baseUrl: "https://74wyzj.movielinkbd.de", priority: 4 },
  { id: "mirror3", name: "Mirror 3", baseUrl: "https://xuysbd.movielinkbd.de", priority: 5 },
  { id: "portal", name: "Portal", baseUrl: "https://movielinkbd.com", priority: 6 },
  { id: "alt-one", name: "Alt .one", baseUrl: "https://movielinkbd.one", priority: 7 },
  { id: "alt-shop", name: "Alt .shop", baseUrl: "https://movielinkbd.shop", priority: 8 }
];

const DEFAULT_FALLBACK_CATEGORIES = [
  // Featured Zones & Collections
  { label: "Latest & Home", path: "/", group: "Collections", icon: "🏠" },
  { label: "Trending Now", path: "/mostwatch/7d", group: "Collections", icon: "🔥" },
  { label: "Recently Added", path: "/new", group: "Collections", icon: "🆕" },
  { label: "Movies", path: "/type/movies", group: "Collections", icon: "🎬" },
  { label: "Web Series", path: "/type/series", group: "Collections", icon: "📺" },
  { label: "Ongoing Series", path: "/ongoing", group: "Collections", icon: "⏳" },
  { label: "K/J/C-Drama", path: "/drama", group: "Collections", icon: "🎭" },
  { label: "Anime Zone", path: "/anime", group: "Collections", icon: "🍥" },
  { label: "WWE Wrestling", path: "/category/wwe", group: "Collections", icon: "🤼" },
  { label: "FIFA & Football", path: "/fifa", group: "Collections", icon: "⚽" },
  { label: "Midnight (18+)", path: "/adult18plus", group: "Collections", icon: "🔞" },
  { label: "Marvel MCU", path: "/collection/mcu-marvel-cinematic-universe", group: "Collections", icon: "🛡️" },
  { label: "DC Universe", path: "/collection/dc-universe-dceu-dcu", group: "Collections", icon: "🦇" },
  { label: "Best Bangla Dubbed", path: "/collection/best-bangla-dubbed-movies", group: "Collections", icon: "🇧🇩" },
  { label: "Top Hindi Dubbed Action", path: "/collection/top-rated-hindi-dubbed-action", group: "Collections", icon: "💥" },
  { label: "Bangla Web Series", path: "/collection/bangla-web-series", group: "Collections", icon: "📺" },
  { label: "Korean Drama Must Watch", path: "/collection/korean-drama-must-watch", group: "Collections", icon: "🇰🇷" },
  { label: "South Indian Blockbusters", path: "/collection/south-indian-blockbusters", group: "Collections", icon: "🌏" },
  { label: "Horror Night Collection", path: "/collection/horror-night", group: "Collections", icon: "👻" },
  { label: "Family Animation", path: "/collection/family-animation", group: "Collections", icon: "🎨" },
  { label: "Thriller & Mystery", path: "/collection/thriller-mystery", group: "Collections", icon: "🔪" },
  // All 25 Languages & Regions
  { label: "Bangla Original", path: "/language/bangla", group: "Languages & Regions", icon: "🇧🇩" },
  { label: "Bangla Dubbed", path: "/language/bangla-dubbed", group: "Languages & Regions", icon: "🎙️" },
  { label: "Bollywood", path: "/bollywood", group: "Languages & Regions", icon: "🎬" },
  { label: "Hindi Original", path: "/language/hindi", group: "Languages & Regions", icon: "🇮🇳" },
  { label: "Hindi Dubbed", path: "/language/hindi-dubbed", group: "Languages & Regions", icon: "🎤" },
  { label: "Dual Audio", path: "/language/dual-audio", group: "Languages & Regions", icon: "🎧" },
  { label: "English / Hollywood", path: "/language/english", group: "Languages & Regions", icon: "🎥" },
  { label: "South Indian", path: "/southIndian", group: "Languages & Regions", icon: "🌏" },
  { label: "Korean (K-Drama)", path: "/language/korean", group: "Languages & Regions", icon: "🇰🇷" },
  { label: "Tamil", path: "/language/tamil", group: "Languages & Regions", icon: "🎞️" },
  { label: "Telugu", path: "/language/telugu", group: "Languages & Regions", icon: "🎞️" },
  { label: "Malayalam", path: "/language/malayalam", group: "Languages & Regions", icon: "🎞️" },
  { label: "Kannada", path: "/language/kannada", group: "Languages & Regions", icon: "🎞️" },
  { label: "Japanese", path: "/language/japanese", group: "Languages & Regions", icon: "🇯🇵" },
  { label: "Chinese (C-Drama)", path: "/language/chinese", group: "Languages & Regions", icon: "🇨🇳" },
  { label: "Turkish Drama", path: "/language/turkish", group: "Languages & Regions", icon: "🇹🇷" },
  { label: "Indonesian", path: "/language/indonesian", group: "Languages & Regions", icon: "🇮🇩" },
  { label: "Spanish", path: "/language/spanish", group: "Languages & Regions", icon: "🇪🇸" },
  { label: "French", path: "/language/french", group: "Languages & Regions", icon: "🇫🇷" },
  { label: "Portuguese", path: "/language/portuguese", group: "Languages & Regions", icon: "🇵🇹" },
  { label: "Italian", path: "/language/italian", group: "Languages & Regions", icon: "🇮🇹" },
  { label: "Punjabi", path: "/language/punjabi", group: "Languages & Regions", icon: "🎵" },
  { label: "Gujarati", path: "/language/gujrati", group: "Languages & Regions", icon: "🎞️" },
  { label: "Marathi", path: "/language/marathi", group: "Languages & Regions", icon: "🎞️" },
  { label: "Malaysian", path: "/language/malaysian", group: "Languages & Regions", icon: "🇲🇾" },
  { label: "Vietnamese", path: "/language/vietnamese", group: "Languages & Regions", icon: "🇻🇳" },
  { label: "Other Languages", path: "/language/others", group: "Languages & Regions", icon: "🌐" },
  // All 24 Genres
  { label: "Action", path: "/genre/action", group: "Genres", icon: "💥" },
  { label: "Thriller", path: "/genre/thriller", group: "Genres", icon: "🔪" },
  { label: "Horror", path: "/genre/horror", group: "Genres", icon: "👻" },
  { label: "Romance", path: "/genre/romance", group: "Genres", icon: "❤️" },
  { label: "Comedy", path: "/genre/comedy", group: "Genres", icon: "😂" },
  { label: "Crime", path: "/genre/crime", group: "Genres", icon: "🕵️" },
  { label: "Sci-Fi", path: "/genre/sci-fi", group: "Genres", icon: "🚀" },
  { label: "Adventure", path: "/genre/adventure", group: "Genres", icon: "🧭" },
  { label: "Fantasy", path: "/genre/fantasy", group: "Genres", icon: "✨" },
  { label: "Superhero", path: "/genre/superhero", group: "Genres", icon: "🦸" },
  { label: "Survival", path: "/genre/survival", group: "Genres", icon: "🏕️" },
  { label: "Suspense", path: "/genre/suspense", group: "Genres", icon: "🕯️" },
  { label: "Mystery", path: "/genre/mystery", group: "Genres", icon: "🔍" },
  { label: "Drama", path: "/genre/drama", group: "Genres", icon: "🎭" },
  { label: "Family", path: "/genre/family", group: "Genres", icon: "👨‍👩‍👧" },
  { label: "Historical", path: "/genre/historical", group: "Genres", icon: "🏛️" },
  { label: "War", path: "/genre/war", group: "Genres", icon: "⚔️" },
  { label: "Documentary", path: "/genre/documentary", group: "Genres", icon: "📽️" },
  { label: "Biographical", path: "/genre/biographical", group: "Genres", icon: "📜" },
  { label: "Sports", path: "/genre/sports", group: "Genres", icon: "⚽" },
  { label: "Music", path: "/genre/music", group: "Genres", icon: "🎶" },
  { label: "Musical", path: "/genre/musical", group: "Genres", icon: "🎼" },
  { label: "Animation", path: "/genre/animation", group: "Genres", icon: "🎨" }
];

const mlbdCache = new Map();
const mlbdStaleCache = new Map();
const mlbdInFlight = new Map();
const mlbdItemRegistry = new Map();
const posterRegistry = new Map();
const posterInFlight = new Map();
const mlbdArchiveByPath = new Map();
const mlbdArchiveByNormTitle = new Map();
let mlbdArchiveRecords = [];
let mlbdArchiveLoaded = false;
let mlbdArchiveLoadPromise = null;
let activeResolvedOrigin = "https://rnztvk.movielinkbd.de";
let mirrorsBlockedUntil = 0;
let mlbdDirectMirrorsBlocked = false;
let mlbdCinePulseHasContent = false;

export function isMlbdDirectPlaybackAvailable() {
  return Boolean(!mlbdDirectMirrorsBlocked || mlbdCinePulseHasContent);
}

function normalizePosterKey(title = "") {
  return decodeHtmlEntities(String(title || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarityScore(queryTitle = "", candidateTitle = "", opts = {}) {
  return strictTitleMatchScore(decodeHtmlEntities(queryTitle), decodeHtmlEntities(candidateTitle), opts);
}

function registerPosterInCache(item) {
  if (!item || !item.poster) return;
  const searchKey = normalizePosterKey(item.searchTitle || cleanMlbdSearchTitle(item.title || ""));
  if (!searchKey) return;
  const entry = {
    poster: item.poster,
    rawPoster: item.rawPoster || "",
    rating: item.rating || "",
    year: String(item.year || ""),
    mbSubjectId: item.mbSubjectId || item.subjectId || "",
    mbDetailPath: item.mbDetailPath || item.detailPath || ""
  };
  if (item.year) {
    posterRegistry.set(`${searchKey}|${item.year}`, entry);
  }
  if (!posterRegistry.has(searchKey)) {
    posterRegistry.set(searchKey, entry);
  }
  if (posterRegistry.size > 3000) {
    const oldest = posterRegistry.keys().next().value;
    if (oldest) posterRegistry.delete(oldest);
  }
}

function lookupPosterRegistry(searchTitle = "", year = "") {
  const key = normalizePosterKey(searchTitle);
  if (!key) return null;
  if (year && posterRegistry.has(`${key}|${year}`)) {
    return posterRegistry.get(`${key}|${year}`);
  }
  const fallback = posterRegistry.get(key) || null;
  if (!fallback) return null;
  if (year && fallback.year && Math.abs(Number(year) - Number(fallback.year)) >= 2) {
    return null;
  }
  return fallback;
}

function registerMlbdItem(item) {
  if (!item || !item.path) return;
  mlbdItemRegistry.set(item.path, item);
  const noPrefix = item.path.replace(/^\/mlbd(?=\/)/i, "");
  if (noPrefix && noPrefix !== item.path) {
    mlbdItemRegistry.set(noPrefix, item);
  }
  if (item.poster) {
    registerPosterInCache(item);
  }
  if (mlbdItemRegistry.size > 3000) {
    const oldest = mlbdItemRegistry.keys().next().value;
    if (oldest) mlbdItemRegistry.delete(oldest);
  }
}

function extractBaseSeriesTitle(rawTitle = "") {
  return decodeHtmlEntities(String(rawTitle || ""))
    .replace(/\[.*?\]|\(.*?\)/g, " ")
    .replace(/\b(?:S\d+|Season\s*\d+(?:-\d+)?|Ep(?:isode)?\s*\d+(?:-\d+)?|Complete(?:d)?|Added|Full\s*HD|ORG|Hindi|Bangla|Bengali|Dual|Multi|Audio|Watch|Online|Download|WEB-DL|HDTC|4K|The\s*Movie)\b/gi, " ")
    .replace(/[:\-–—|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseViewsCount(rawViews = "") {
  const s = String(rawViews || "").trim().toUpperCase();
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*([KMB])?/);
  if (!m) return 0;
  const n = Number(m[1]) || 0;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

function normalizeArchiveItem(rec) {
  if (!rec || typeof rec !== "object") return null;
  const rawPath = String(rec.path || "").trim();
  const normPath = normalizeUpstreamPath(rawPath);
  if (!normPath || normPath === "/") return null;
  const rawTitle = dedupeRepeatedTitleYear(stripSiteBrandFromLabel(decodeHtmlEntities(String(rec.title || "").trim())));
  if (!rawTitle) return null;

  const rawExtPoster = String(rec.rawPoster || rec.poster || "").trim();
  const absRawPoster = /^https?:\/\//i.test(rawExtPoster) && !rawExtPoster.includes("/api/moviebox-image/") ? rawExtPoster : "";
  const proxiedPoster = absRawPoster
    ? mlbdProxyImageUrl(absRawPoster)
    : (String(rec.poster || "").startsWith("/api/") ? String(rec.poster) : "");
  const yr = extractPlausibleYear(rawTitle, rec.year || "", normPath);
  const typeBadgeRaw = String(rec.typeBadge || rec.type || "").trim();
  const isAnime = Boolean(rec.isAnime) || /^\/anime\//i.test(normPath) || /\banime\b/i.test(`${typeBadgeRaw} ${rawTitle} ${rec.genre || ""}`);
  const isSeries = Boolean(rec.isSeries) ||
    /^\/(?:series|drama|anime)\//i.test(normPath) ||
    /\b(?:series|drama|season|s\d{1,2}|ep(?:isode)?\s*\d+)\b/i.test(`${typeBadgeRaw} ${rawTitle} ${rec.episodePill || ""}`);
  const lang = String(rec.language || "").trim() || (/bangla/i.test(rawTitle) ? "Bangla" : "");
  const isHindiDubbed = Boolean(rec.isHindiDubbed) || /hindi|dual/i.test(`${lang} ${rawTitle}`);
  const searchTitle = cleanMlbdSearchTitle(rawTitle);
  const cats = Array.isArray(rec.categories) ? [...new Set(rec.categories.map(c => String(c || "").toLowerCase().replace(/\/+$/, "") || "/"))] : ["/"];
  const rawUploadLabel = String(rec.uploadTime || rec.timeAgo || "").trim();
  const isBareOldYearLabel = /^(?:19\d\d|20\d\d)$/.test(rawUploadLabel);
  const isOldRelativeLabel = /\b(?:years?|months?)\s+ago\b/i.test(rawUploadLabel);
  let effectiveUploadedAtMs = Number(rec.uploadedAtMs) || 0;
  if (isBareOldYearLabel || isOldRelativeLabel) {
    effectiveUploadedAtMs = 0;
  }

  return {
    id: String(rec.id || normPath.split("/").pop() || normPath),
    path: normPath,
    title: rawTitle,
    searchTitle,
    poster: proxiedPoster,
    rawPoster: absRawPoster,
    mbSubjectId: String(rec.mbSubjectId || ""),
    mbDetailPath: String(rec.mbDetailPath || ""),
    quality: String(rec.quality || "HD"),
    language: lang,
    genre: String(rec.genre || ""),
    type: isAnime ? "anime" : isSeries ? "series" : "movie",
    isSeries,
    isMovie: !isSeries,
    isAnime,
    typeBadge: typeBadgeRaw || (isAnime ? "Anime" : isSeries ? "Series" : "Movie"),
    episodePill: String(rec.episodePill || ""),
    year: yr,
    rating: String(rec.rating || ""),
    viewsText: String(rec.viewsText || rec.views || ""),
    views: Number(rec.viewsNum) || parseViewsCount(rec.viewsText || rec.views || ""),
    uploadTime: rawUploadLabel,
    uploadedAtMs: effectiveUploadedAtMs,
    fromArchive: true,
    hypeScore: Number(rec.hypeScore) || 0,
    isPinned: Boolean(rec.isPinned),
    isAdult: Boolean(rec.isAdult) || /\b(?:18\+|adult|erotic|vivamax|midnight)\b/i.test(`${rawTitle} ${typeBadgeRaw} ${cats.join(" ")}`),
    categories: cats,
    hasResource: rec.hasResource !== false && !/upcoming|release soon/i.test(`${rec.quality || ""} ${rawTitle}`),
    isHindiDubbed,
    source: "movielinkbd",
    detailsEndpoint: `/api/details?path=${encodeURIComponent(normPath)}&title=${encodeURIComponent(searchTitle)}`
  };
}

function populateArchiveFromRawJson(raw) {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : []);
  for (const rec of list) {
    const item = normalizeArchiveItem(rec);
    if (!item || isNigerianContent(item)) continue;
    mlbdArchiveByPath.set(item.path, item);
    const normKey = normalizePosterKey(item.searchTitle || item.title);
    if (normKey && (!mlbdArchiveByNormTitle.has(normKey) || (!mlbdArchiveByNormTitle.get(normKey).poster && item.poster))) {
      mlbdArchiveByNormTitle.set(normKey, item);
    }
    registerMlbdItem(item);
  }
  mlbdArchiveRecords = [...mlbdArchiveByPath.values()];
}

function loadMlbdArchiveFromDisk() {
  if (mlbdArchiveLoaded) return;
  try {
    const fs = typeof process !== "undefined" ? process.getBuiltinModule?.("fs") : null;
    if (!fs) return;
    mlbdArchiveLoaded = true;
    const archiveUrl = new URL("./data/mlbd-archive.json", import.meta.url);
    if (!fs.existsSync(archiveUrl)) return;
    const raw = fs.readFileSync(archiveUrl, "utf8");
    populateArchiveFromRawJson(raw);
  } catch (err) {
    console.warn("[MovieStreamBD archive load]", err?.message || err);
  }
}

async function ensureMlbdArchiveLoaded() {
  if (mlbdArchiveLoaded && mlbdArchiveRecords.length > 0) return;
  loadMlbdArchiveFromDisk();
  if (mlbdArchiveLoaded) return;
  if (mlbdArchiveLoadPromise) return await mlbdArchiveLoadPromise;
  mlbdArchiveLoadPromise = (async () => {
    try {
      if (typeof process === "undefined" || !process.versions?.node) {
        mlbdArchiveLoaded = true;
        return;
      }
      const fs = await import("node:fs");
      const archiveUrl = new URL("./data/mlbd-archive.json", import.meta.url);
      if (fs.existsSync(archiveUrl)) {
        const raw = await fs.promises.readFile(archiveUrl, "utf8");
        populateArchiveFromRawJson(raw);
      }
      mlbdArchiveLoaded = true;
    } catch (err) {
      console.warn("[MovieStreamBD async archive load]", err?.message || err);
    }
  })().finally(() => {
    mlbdArchiveLoadPromise = null;
  });
  return await mlbdArchiveLoadPromise;
}

function upsertMlbdArchiveItems(items = [], categoryPath = "/") {
  loadMlbdArchiveFromDisk();
  const cat = String(categoryPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  let added = false;
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalizeArchiveItem(raw);
    if (!item || isNigerianContent(item)) continue;
    item.fromArchive = Boolean(raw?.fromArchive);
    const existing = mlbdArchiveByPath.get(item.path);
    if (existing) {
      if (!item.fromArchive) existing.fromArchive = false;
      if (cat && !existing.categories.includes(cat)) existing.categories.push(cat);
      if (!existing.poster && item.poster) {
        existing.poster = item.poster;
        existing.rawPoster = item.rawPoster || existing.rawPoster;
      }
      if (item.mbSubjectId && !existing.mbSubjectId) {
        existing.mbSubjectId = item.mbSubjectId;
        existing.mbDetailPath = item.mbDetailPath || existing.mbDetailPath;
      }
      if (item.uploadedAtMs > (existing.uploadedAtMs || 0)) existing.uploadedAtMs = item.uploadedAtMs;
      if (item.rating && !existing.rating) existing.rating = item.rating;
    } else {
      if (cat && !item.categories.includes(cat)) item.categories.push(cat);
      mlbdArchiveByPath.set(item.path, item);
      mlbdArchiveRecords.push(item);
      added = true;
    }
    const normKey = normalizePosterKey(item.searchTitle || item.title);
    if (normKey && item.poster && !mlbdArchiveByNormTitle.has(normKey)) {
      mlbdArchiveByNormTitle.set(normKey, mlbdArchiveByPath.get(item.path) || item);
    }
    registerMlbdItem(mlbdArchiveByPath.get(item.path) || item);
  }
  return added;
}

function queryMlbdArchive({ q = "", category = "/", includeAdult = false, sort = "latest", offset = 0, limit = 30 } = {}) {
  loadMlbdArchiveFromDisk();
  const cleanQ = String(q || "").trim();
  const cat = String(category || "/").toLowerCase().replace(/\/+$/, "") || "/";
  const isAdultCat = cat === "/adult18plus" || cat === "/midnight" || cat === "/genre/adult" || cat === "/genre/erotic" || cat === "/genre/hot";
  const allowAdult = Boolean(includeAdult || isAdultCat);
  const allowMusic = cleanQ ? /\b(?:song|songs|music|ost|pop|lyric|lyrical|remix|album|naat|bhajan|track|audio)\b/i.test(cleanQ) : false;
  const qVariants = cleanQ ? expandSearchQueryVariants(cleanQ) : [];
  const lowerQ = cleanQ.toLowerCase();

  const matched = [];
  for (const item of mlbdArchiveRecords) {
    if (!item || isNigerianContent(item)) continue;
    if (!allowAdult && item.isAdult) continue;
    if (cleanQ && !allowMusic && isMusicOrClipSubject(item)) continue;

    if (!cleanQ && cat && cat !== "/" && cat !== "/all" && cat !== "/collections" && cat !== "/new" && cat !== "/popular" && !cat.startsWith("/mostwatch") && cat !== "/top10" && cat !== "/recently-updated" && cat !== "/top-rated") {
      const inCat = (Array.isArray(item.categories) && item.categories.includes(cat)) || matchesMlbdCategoryItem(item, cat);
      if (!inCat) continue;
    }

    if (cleanQ) {
      let sc = Math.max(...qVariants.map(qv => scoreSearchMatch(item, qv, { allowBroadMatch: false })));
      if (sc <= 0 && lowerQ.length >= 2) {
        const hay = `${item.title} ${item.language} ${item.genre} ${item.typeBadge}`.toLowerCase();
        if (hay.includes(lowerQ)) sc = 1;
      }
      if (sc <= 0) continue;
      matched.push({ item, sc });
    } else {
      matched.push({ item, sc: 0 });
    }
  }

  let ordered;
  if (cleanQ) {
    matched.sort((a, b) =>
      b.sc - a.sc ||
      (b.item.mbSubjectId ? 1 : 0) - (a.item.mbSubjectId ? 1 : 0) ||
      (b.item.poster ? 1 : 0) - (a.item.poster ? 1 : 0) ||
      (b.item.hypeScore || 0) - (a.item.hypeScore || 0) ||
      Number(b.item.year || 0) - Number(a.item.year || 0)
    );
    ordered = matched.map(x => x.item);
  } else if (sort === "rating" || cat === "/top-rated") {
    ordered = matched
      .map(x => x.item)
      .sort((a, b) =>
        (Number(b.rating || 0) - Number(a.rating || 0)) ||
        ((b.poster ? 1 : 0) - (a.poster ? 1 : 0)) ||
        ((b.hypeScore || 0) - (a.hypeScore || 0)) ||
        (Number(b.year || 0) - Number(a.year || 0))
      );
  } else if (sort === "popular" || cat === "/popular" || cat.startsWith("/mostwatch") || cat === "/top10") {
    ordered = matched
      .map(x => x.item)
      .sort((a, b) =>
        ((b.hypeScore || 0) - (a.hypeScore || 0)) ||
        ((b.views || 0) - (a.views || 0)) ||
        ((b.poster ? 1 : 0) - (a.poster ? 1 : 0)) ||
        ((b.uploadedAtMs || 0) - (a.uploadedAtMs || 0))
      );
  } else {
    ordered = sortMlbdNewestFirst(matched.map(x => x.item));
  }

  const deduped = [];
  const seenPaths = new Set();
  const seenTitles = new Set();
  for (const it of ordered) {
    const pKey = it.path || it.title.toLowerCase();
    if (!pKey || seenPaths.has(pKey)) continue;
    const normT = normalizePosterKey(it.searchTitle || it.title || "");
    const tKey = normT ? `${normT}|${it.year || ""}|${it.isSeries ? "s" : "m"}` : "";
    if (tKey && seenTitles.has(tKey)) continue;
    seenPaths.add(pKey);
    if (tKey) seenTitles.add(tKey);
    deduped.push(it);
  }

  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 30));
  return {
    items: deduped.slice(safeOffset, safeOffset + safeLimit),
    total: deduped.length
  };
}

loadMlbdArchiveFromDisk();

function cleanMlbdSearchTitle(rawTitle) {
  return cleanSearchTitleText(decodeHtmlEntities(String(rawTitle || "")));
}

function slugifyMlbdTitle(rawTitle) {
  const s = cleanMlbdSearchTitle(rawTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s || "title";
}

function getCached(key) {
  const entry = mlbdCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    mlbdCache.delete(key);
    return null;
  }
  return entry.val;
}

function getStaleCached(key, maxStaleMs = 15 * 60 * 1000) {
  const entry = mlbdStaleCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > maxStaleMs) {
    mlbdStaleCache.delete(key);
    return null;
  }
  return entry.val;
}

function deleteStaleCached(key) {
  mlbdCache.delete(key);
  mlbdStaleCache.delete(key);
}

function setCached(key, val, ttlMs = 90000) {
  const now = Date.now();
  mlbdCache.set(key, { val, exp: now + ttlMs });
  mlbdStaleCache.set(key, { val, savedAt: now });
  if (mlbdCache.size > 400) {
    const oldest = mlbdCache.keys().next().value;
    if (oldest) mlbdCache.delete(oldest);
  }
  if (mlbdStaleCache.size > 400) {
    const oldest = mlbdStaleCache.keys().next().value;
    if (oldest) mlbdStaleCache.delete(oldest);
  }
  return val;
}

function isAuthOrForbiddenError(err) {
  const st = Number(err?.status || 0);
  return st === 401 || st === 403 || Boolean(err?.isAuthError) || Boolean(err?.isCloudflareBlock);
}

function isTemporaryOrRateLimitError(err) {
  if (isAuthOrForbiddenError(err)) return false;
  const st = Number(err?.status || 0);
  if (st === 429 || st >= 500) return true;
  return Boolean(err?.isTemporary) || /timeout|aborted|fetch failed|econnreset|enotfound|unreachable/i.test(String(err?.message || ""));
}

export function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^(?:fc|fd|fe80):/i.test(host)) return true;
  return false;
}

export function validateExternalHttpUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (isBlockedHost(u.hostname)) return "";
    return u.href;
  } catch {
    return "";
  }
}

export function resolveSafeMlbdToken(token) {
  const target = verifyMediaToken(String(token || ""));
  if (!target) return "";
  return validateExternalHttpUrl(target);
}

export function normalizeUpstreamPath(rawPath) {
  let s = String(rawPath || "/").trim();
  if (!s || s === "/") return "/";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname + u.search;
    } catch {
      return "/";
    }
  }
  s = s.replace(/^\/mlbd(?=\/)/i, "");
  if (!s.startsWith("/")) s = "/" + s;
  if (s.startsWith("//") || s.includes("..") || /[\r\n]/.test(s)) return "/";
  return s;
}

export function isMlbdPath(rawPath) {
  const s = String(rawPath || "").trim();
  return /^\/(?:mlbd\/|movie\/|series\/|drama\/|anime\/)/i.test(s);
}

export function decodeHtmlEntities(str) {
  return String(str ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    });
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function stripSiteBrandFromLabel(raw = "") {
  return String(raw || "")
    .replace(/\bmovie\s*(?:stream|link)\s*bd\b(?:\.com|\.at|\.de)?/gi, "")
    .replace(/\s*[—–\-|:]+\s*$/g, "")
    .replace(/^\s*[—–\-|:]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getEndOfTodayMs() {
  const bdt = new Date(Date.now() + 6 * 3600 * 1000);
  return Date.UTC(bdt.getUTCFullYear(), bdt.getUTCMonth(), bdt.getUTCDate(), 23, 59, 59, 999) - 6 * 3600 * 1000;
}

function parseFlexibleDateMs(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const s = String(raw).trim();
  if (!s) return 0;
  if (/^(?:19|20)\d{2}$/.test(s)) return 0;
  if (/^\d{9,16}$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const lower = s.toLowerCase();
  const now = Date.now();
  if (/\b(?:just now|now|today)\b/.test(lower)) return now;
  if (/\byesterday\b/.test(lower)) return now - 86400 * 1000;
  const ago = /(\d+)\s*(sec(?:ond)?s?|min(?:ute)?s?|hrs?|hours?|days?|weeks?|months?|years?)\s*ago/i.exec(lower);
  if (ago) {
    const n = Number(ago[1]) || 1;
    const u = ago[2].toLowerCase();
    const mult = u.startsWith("sec") ? 1000
      : u.startsWith("min") ? 60 * 1000
      : u.startsWith("h") ? 3600 * 1000
      : u.startsWith("d") ? 86400 * 1000
      : u.startsWith("w") ? 7 * 86400 * 1000
      : u.startsWith("mo") ? 30 * 86400 * 1000
      : 365 * 86400 * 1000;
    return Math.max(1, now - n * mult);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function extractPlausibleYear(title = "", explicitYear = "", href = "") {
  const maxYr = new Date(Date.now() + 6 * 3600 * 1000).getUTCFullYear() + 1;
  const titleYears = [...String(title || "").matchAll(/[\(\[](19\d\d|20\d\d)[\)\]]/g)]
    .map(m => Number(m[1]))
    .filter(y => y >= 1900 && y <= maxYr);
  const titleYr = titleYears.length ? Math.max(...titleYears) : 0;
  const paramYrMatch = String(explicitYear || "").match(/(19\d\d|20\d\d)/);
  const paramYr = paramYrMatch && Number(paramYrMatch[1]) <= maxYr ? Number(paramYrMatch[1]) : 0;
  const hrefYrMatch = String(href || "").match(/-(19\d\d|20\d\d)(?:\/|$)/);
  const hrefYr = hrefYrMatch && Number(hrefYrMatch[1]) <= maxYr ? Number(hrefYrMatch[1]) : 0;
  if (titleYr && (!paramYr || titleYr > paramYr)) return String(titleYr);
  return String(paramYr || titleYr || hrefYr || "");
}

export function decDataDl(b, s, r) {
  try {
    let x = Number.parseInt(String(s || "0"), 16) >>> 0;
    const rounds = Number.parseInt(String(r || "0"), 10) || 0;
    for (let i = 0; i < rounds; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    }
    const raw = Buffer.from(String(b || ""), "base64").toString("latin1");
    let out = "";
    for (let j = 0; j < raw.length; j++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out += String.fromCharCode(raw.charCodeAt(j) ^ ((x >>> 16) & 255));
    }
    return out;
  } catch {
    return "";
  }
}

export function mlbdProxyImageUrl(rawUrl) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (clean.startsWith("/api/")) return clean;
  if (!/^https?:\/\//i.test(clean)) return "";
  return `/api/moviebox-image/mlbd-poster.jpg?t=${encodeURIComponent(signMediaToken(clean))}`;
}

export function mlbdProxyHlsUrl(rawUrl) {
  const safe = validateExternalHttpUrl(rawUrl);
  if (!safe) return "";
  return `/api/mlbd-hls.m3u8?t=${encodeURIComponent(signMediaToken(safe))}`;
}

export function mlbdProxyStreamUrl(rawUrl, filename = "") {
  const safe = validateExternalHttpUrl(rawUrl);
  if (!safe) return "";
  const qs = new URLSearchParams({ t: signMediaToken(safe) });
  if (filename) qs.set("filename", filename);
  return `/api/mlbd-stream.mp4?${qs.toString()}`;
}

export function mlbdProxyGoUrl(rawUrl) {
  const safe = validateExternalHttpUrl(rawUrl);
  if (!safe) return "";
  return `/api/go?t=${encodeURIComponent(signMediaToken(safe))}`;
}

export function mlbdProxySubtitleUrl(rawUrl, idx = 0) {
  const safe = validateExternalHttpUrl(rawUrl);
  if (!safe) return "";
  return `/api/moviebox-subtitle/mlbd-sub-${idx}.vtt?vtt=1&t=${encodeURIComponent(signMediaToken(safe))}`;
}

function cookieStringFromResponse(res) {
  try {
    const raw = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    return raw.map(c => String(c).split(";")[0].trim()).filter(Boolean).join("; ");
  } catch {
    return "";
  }
}

const BLOCKED_TRAP_HOSTS = new Set([
  "movielinkbd.app",
  "www.movielinkbd.app",
  "movielinkbd.at",
  "www.movielinkbd.at"
]);

function isTrapMirrorHost(hostname = "") {
  const h = String(hostname || "").toLowerCase();
  return !h || BLOCKED_TRAP_HOSTS.has(h) || h.endsWith(".movielinkbd.at") || h.endsWith(".movielinkbd.app");
}

function ensureTrailingSlashPath(pathWithQuery) {
  const raw = String(pathWithQuery || "/");
  const qIdx = raw.indexOf("?");
  const p = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const q = qIdx >= 0 ? raw.slice(qIdx) : "";
  if (!p || p === "/" || p === "/new" || p === "/mostwatch/7d" || /^\/(?:movie|series|drama|anime|p|updates)\//i.test(p)) {
    return raw;
  }
  return (p.endsWith("/") ? p : p + "/") + q;
}

function isCloudflareBlockedResponse(status, headers, text) {
  if (status !== 403 && status !== 503) return false;
  const cfMit = headers?.get?.("cf-mitigated") || "";
  if (/challenge/i.test(cfMit)) return true;
  return /Just a moment\.\.\.|Attention Required|cf-browser-verification|Enable JavaScript and cookies to continue/i.test(String(text || ""));
}

async function fetchMirrorOnce(baseUrl, pathWithQuery, extraHeaders = {}, timeoutMs = 14000) {
  let currentUrl = new URL(pathWithQuery, baseUrl).href;
  let allCookies = [];
  const baseHeaders = {
    ...CHROME_SEC_HEADERS,
    "User-Agent": MOVIEBOX_UA,
    Cookie: "mlbd_show18=1; hide18On=false",
    ...extraHeaders
  };

  const tryCurl = async targetHref => {
    const cRes = await curlHttpRequest(targetHref, {
      method: "GET",
      headers: baseHeaders,
      timeoutMs,
      followRedirects: true,
      maxRedirs: 5
    });
    if (!cRes) return null;
    try {
      const host = new URL(cRes.finalUrl || targetHref).hostname;
      if (isTrapMirrorHost(host)) {
        return {
          res: { ok: false, status: 302, headers: new Headers() },
          text: "",
          finalUrl: targetHref,
          finalOrigin: new URL(targetHref).origin,
          cookies: allCookies.join("; "),
          blockedRedirect: cRes.finalUrl
        };
      }
    } catch {}
    return {
      res: {
        ok: cRes.ok,
        status: cRes.status,
        headers: new Headers()
      },
      text: cRes.text || "",
      finalUrl: cRes.finalUrl,
      finalOrigin: cRes.finalOrigin,
      cookies: allCookies.join("; "),
      viaCurl: true
    };
  };

  if (isCurlPreferredForHost(currentUrl)) {
    const curlOut = await tryCurl(currentUrl);
    if (curlOut && !curlOut.blockedRedirect && curlOut.res.ok && !isCloudflareBlockedResponse(curlOut.res.status, curlOut.res.headers, curlOut.text)) {
      return curlOut;
    }
  }

  let fetchOut = null;
  let fetchErr = null;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const res = await fetch(currentUrl, {
        headers: baseHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      });
      const hopCookies = cookieStringFromResponse(res);
      if (hopCookies) allCookies.push(hopCookies);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        try { await res.body?.cancel(); } catch {}
        if (!loc) {
          fetchOut = { res, text: "", finalUrl: currentUrl, finalOrigin: new URL(currentUrl).origin, cookies: allCookies.join("; ") };
          break;
        }
        const nextUrl = new URL(loc, currentUrl);
        if (isTrapMirrorHost(nextUrl.hostname)) {
          return {
            res,
            text: "",
            finalUrl: currentUrl,
            finalOrigin: new URL(currentUrl).origin,
            cookies: allCookies.join("; "),
            blockedRedirect: nextUrl.href
          };
        }
        currentUrl = nextUrl.href;
        continue;
      }

      const finalOrigin = new URL(res.url || currentUrl).origin;
      const text = await res.text();
      fetchOut = { res, text, finalUrl: res.url || currentUrl, finalOrigin, cookies: allCookies.join("; ") };
      break;
    }
  } catch (err) {
    fetchErr = err;
  }

  const needsCurlFallback =
    !fetchOut ||
    fetchOut.res.status === 403 ||
    fetchOut.res.status === 401 ||
    fetchOut.res.status === 429 ||
    fetchOut.res.status >= 500 ||
    isCloudflareBlockedResponse(fetchOut.res.status, fetchOut.res.headers, fetchOut.text);

  if (needsCurlFallback) {
    const curlOut = await tryCurl(currentUrl);
    if (curlOut) {
      if (curlOut.res.ok && !isCloudflareBlockedResponse(curlOut.res.status, curlOut.res.headers, curlOut.text) && !isPortalLandingHtml(curlOut.text)) {
        markCurlPreferredForHost(currentUrl);
        return curlOut;
      }
      if (!fetchOut) return curlOut;
    }
  }

  if (fetchOut) return fetchOut;
  throw fetchErr || new Error(`Too many redirects from ${baseUrl}`);
}

function isPortalLandingHtml(html) {
  const s = String(html || "");
  if (!s) return true;
  if (/cf-mitigated|Just a moment\.\.\.|Attention Required|cf-browser-verification/i.test(s)) return true;
  const hasContentMarkers = /movie-card|rail-section|mlbdHdFrame|__PD2|mlbdInlinePlayerData/i.test(s);
  if (hasContentMarkers) return false;
  return /MovieLinkBD\.com\s*[—-]\s*Official/i.test(s) || /<meta[^>]+name="generator"[^>]*>/i.test(s) || s.length < 1200;
}

function extractMirrorOriginsFromPortal(html) {
  const deOrigins = [];
  const altOrigins = [];
  const seen = new Set();
  const re = /https:\/\/((?:[a-z0-9-]+\.)?movielinkbd\.[a-z]{2,12})/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const host = m[1].toLowerCase();
    if (
      host === "movielinkbd.com" ||
      host === "www.movielinkbd.com" ||
      host === "www.movielinkbd.de" ||
      isTrapMirrorHost(host)
    ) {
      continue;
    }
    const origin = `https://${host}`;
    if (!seen.has(origin)) {
      seen.add(origin);
      if (host.endsWith(".movielinkbd.de")) deOrigins.push(origin);
      else altOrigins.push(origin);
    }
  }
  return [...deOrigins, ...altOrigins];
}

async function discoverLiveMirrorOrigin(timeoutMs = 8000, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCached("portal:mirrors");
    if (cached) return cached;
  }
  try {
    const portal = await fetchMirrorOnce("https://movielinkbd.com", "/", {}, timeoutMs);
    if (portal.res.ok && portal.text) {
      const origins = extractMirrorOriginsFromPortal(portal.text);
      if (origins.length) return setCached("portal:mirrors", origins, 180000);
    }
  } catch {}
  return [];
}

export async function mlbdFetchPage(upstreamPath = "/", options = {}) {
  const cleanPath = normalizeUpstreamPath(upstreamPath);
  const cacheKey = `page:${cleanPath}`;
  const ttlMs = options.ttlMs ?? 90000;
  if (!options.bypassCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  if (!options.bypassCache && Date.now() < mirrorsBlockedUntil) {
    const blockedErr = new Error("MovieStreamBD mirrors temporarily blocked by Cloudflare (HTTP 403)");
    blockedErr.status = 403;
    blockedErr.isCloudflareBlock = true;
    throw blockedErr;
  }

  if (mlbdInFlight.has(cacheKey)) {
    return await mlbdInFlight.get(cacheKey);
  }

  const job = (async () => {
    const cachedOrigins = getCached("portal:mirrors") || [];
    const candidateBases = [...new Set([
      activeResolvedOrigin,
      ...cachedOrigins,
      ...MLBD_MIRRORS.map(m => m.baseUrl)
    ])].filter(b => {
      try { return !isTrapMirrorHost(new URL(b).hostname); } catch { return false; }
    });
    const tried = new Set();

    const slashVariant = ensureTrailingSlashPath(cleanPath);
    const pathVariants = [...new Set(
      cleanPath === "/"
        ? ["/", "/new"]
        : [slashVariant, cleanPath]
    )];

    let lastErr = null;
    let portalChecked = false;
    const perMirrorTimeoutMs = options.timeoutMs || 9000;

    for (let i = 0; i < candidateBases.length; i++) {
      const base = candidateBases[i];
      if (!base || tried.has(base)) continue;
      tried.add(base);

      // Portal root movielinkbd.com only gives mirror origins, not full category pages
      if (/^https?:\/\/(?:www\.)?movielinkbd\.com$/i.test(base)) {
        if (!portalChecked) {
          portalChecked = true;
          const discovered = await discoverLiveMirrorOrigin(6000, true);
          for (const d of discovered) {
            if (!tried.has(d) && !candidateBases.includes(d)) {
              candidateBases.splice(i + 1, 0, d);
            }
          }
        }
        continue;
      }

      for (const reqVariant of pathVariants) {
        try {
          const extra = options.headers || {};
          const out = await fetchMirrorOnce(base, reqVariant, extra, perMirrorTimeoutMs);
          if (out.blockedRedirect) {
            lastErr = new Error(`Blocked redirect (${out.blockedRedirect}) from ${base}`);
            break;
          }
          const isCfChallenge = isCloudflareBlockedResponse(out.res.status, out.res.headers, out.text);
          if (isCfChallenge || out.res.status === 403 || out.res.status === 401) {
            lastErr = new Error(
              isCfChallenge
                ? `Cloudflare challenge (403) from ${base}`
                : `HTTP ${out.res.status} from ${base}${reqVariant}`
            );
            lastErr.status = out.res.status;
            lastErr.isCloudflareBlock = isCfChallenge;
            lastErr.isAuthError = out.res.status === 401;
            break;
          }
          if (out.res.ok && out.text && out.text.length > 400) {
            if (isPortalLandingHtml(out.text)) {
              for (const discovered of extractMirrorOriginsFromPortal(out.text)) {
                if (!tried.has(discovered) && !candidateBases.includes(discovered)) {
                  candidateBases.splice(i + 1, 0, discovered);
                }
              }
              lastErr = new Error(`Portal landing or challenge page from ${base}`);
              break;
            }
            activeResolvedOrigin = out.finalOrigin || base;
            mirrorsBlockedUntil = 0;
            mlbdDirectMirrorsBlocked = false;
            const result = {
              html: out.text,
              finalUrl: out.finalUrl,
              origin: out.finalOrigin,
              cookies: out.cookies,
              mirrorUsed: base
            };
            return setCached(cacheKey, result, ttlMs);
          }
          const httpErr = new Error(`HTTP ${out.res.status} from ${base}${reqVariant}`);
          httpErr.status = out.res.status;
          httpErr.isTemporary = out.res.status === 429 || out.res.status >= 500;
          lastErr = httpErr;
          if (out.res.status === 429 || out.res.status >= 500) break;
        } catch (err) {
          err.isTemporary = true;
          lastErr = err;
        }
      }

      if (!portalChecked) {
        portalChecked = true;
        const discovered = await discoverLiveMirrorOrigin(6000, true);
        for (const d of discovered) {
          if (!tried.has(d) && !candidateBases.includes(d)) {
            candidateBases.splice(i + 1, 0, d);
          }
        }
      }
    }

    if (isAuthOrForbiddenError(lastErr)) {
      mirrorsBlockedUntil = Date.now() + 15000;
      mlbdDirectMirrorsBlocked = true;
      deleteStaleCached(cacheKey);
      throw lastErr;
    }

    if (isTemporaryOrRateLimitError(lastErr)) {
      const stale = getStaleCached(cacheKey);
      if (stale) return stale;
    }

    mirrorsBlockedUntil = Date.now() + 15000;
    mlbdDirectMirrorsBlocked = true;
    throw lastErr || new Error("All MovieStreamBD mirrors are currently unreachable");
  })();

  mlbdInFlight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    mlbdInFlight.delete(cacheKey);
  }
}

export const MLBD_HEALTH_CHECKS = [
  { key: "home", label: "Homepage", path: "/" },
  { key: "latest", label: "Latest Catalog", path: "/new" },
  { key: "trending", label: "Trending", path: "/mostwatch/7d" }
];

export function evaluateMlbdHealthHtml({
  path = "/",
  status = 0,
  ok = false,
  text = "",
  finalUrl = "",
  finalOrigin = "",
  baseUrl = "",
  blockedRedirect = "",
  viaCurl = false,
  latencyMs = 0
} = {}) {
  const cleanPath = String(path || "/");
  if (blockedRedirect) {
    return {
      path: cleanPath,
      status: status || 302,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: finalUrl || baseUrl,
      viaCurl: Boolean(viaCurl),
      latencyMs,
      reason: "trap_redirect"
    };
  }
  if (isCloudflareBlockedResponse(status, null, text)) {
    return {
      path: cleanPath,
      status: status || 403,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: finalUrl || baseUrl,
      viaCurl: Boolean(viaCurl),
      latencyMs,
      reason: "cloudflare_blocked"
    };
  }
  if (!ok || status < 200 || status >= 300) {
    return {
      path: cleanPath,
      status: Number(status) || 0,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: finalUrl || baseUrl,
      viaCurl: Boolean(viaCurl),
      latencyMs,
      reason: status ? `http_${status}` : "unreachable"
    };
  }
  if (isPortalLandingHtml(text)) {
    return {
      path: cleanPath,
      status,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: finalUrl || baseUrl,
      viaCurl: Boolean(viaCurl),
      latencyMs,
      reason: "portal_landing"
    };
  }
  if (cleanPath !== "/" && finalUrl) {
    try {
      const resolvedPathname = new URL(finalUrl).pathname || "/";
      if (resolvedPathname === "/") {
        return {
          path: cleanPath,
          status,
          ok: false,
          live: false,
          cardCount: 0,
          fromArchive: false,
          resolvedUrl: finalUrl,
          viaCurl: Boolean(viaCurl),
          latencyMs,
          reason: "redirected_to_home"
        };
      }
    } catch {}
  }

  const originForParse = finalOrigin || baseUrl || activeResolvedOrigin;
  const liveCards = extractCardsFromHtml(text, originForParse, {
    skipArchiveUpsert: true,
    skipRegistry: true
  }).filter(item => item && item.fromArchive !== true);

  if (liveCards.length === 0) {
    return {
      path: cleanPath,
      status,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: finalUrl || baseUrl,
      viaCurl: Boolean(viaCurl),
      latencyMs,
      reason: "no_live_content"
    };
  }

  return {
    path: cleanPath,
    status,
    ok: true,
    live: true,
    cardCount: liveCards.length,
    fromArchive: false,
    resolvedUrl: finalUrl || baseUrl,
    viaCurl: Boolean(viaCurl),
    latencyMs,
    reason: "ok"
  };
}

async function probeMlbdMirrorEndpoint(mirror, spec, timeoutMs = 5500) {
  const started = Date.now();
  try {
    const out = await fetchMirrorOnce(mirror.baseUrl, spec.path, {}, timeoutMs);
    if (out?.res?.ok && out?.viaCurl) {
      markCurlPreferredForHost(mirror.baseUrl);
    }
    return {
      key: spec.key,
      label: spec.label,
      ...evaluateMlbdHealthHtml({
        path: spec.path,
        status: out?.res?.status || 0,
        ok: Boolean(out?.res?.ok),
        text: out?.text || "",
        finalUrl: out?.finalUrl || new URL(spec.path, mirror.baseUrl).href,
        finalOrigin: out?.finalOrigin || mirror.baseUrl,
        baseUrl: mirror.baseUrl,
        blockedRedirect: out?.blockedRedirect || "",
        viaCurl: Boolean(out?.viaCurl),
        latencyMs: Date.now() - started
      })
    };
  } catch (err) {
    return {
      key: spec.key,
      label: spec.label,
      path: spec.path,
      status: 0,
      ok: false,
      live: false,
      cardCount: 0,
      fromArchive: false,
      resolvedUrl: new URL(spec.path, mirror.baseUrl).href,
      viaCurl: false,
      latencyMs: Date.now() - started,
      reason: "unreachable",
      error: err?.message || "Unreachable"
    };
  }
}

export async function getMlbdServerHealth(options = {}) {
  if (!options?.bypassCache) {
    const cached = getCached("server-health");
    if (cached) return cached;
  }

  const discovered = await discoverLiveMirrorOrigin(5000, true).catch(() => []);
  const mirrorTargets = [
    ...discovered
      .filter(origin => !MLBD_MIRRORS.some(m => m.baseUrl === origin))
      .map((origin, idx) => ({ id: `discovered-${idx + 1}`, name: "Discovered Portal Mirror", baseUrl: origin, priority: 0 })),
    ...MLBD_MIRRORS
  ];

  const checks = await Promise.all(
    mirrorTargets.map(async mirror => {
      const started = Date.now();
      const endpointResults = await Promise.all(
        MLBD_HEALTH_CHECKS.map(spec => probeMlbdMirrorEndpoint(mirror, spec, 5500))
      );
      const checkMap = Object.fromEntries(
        endpointResults.map(r => [r.key, r])
      );
      const liveChecksPassed = endpointResults.filter(r => r.live).length;
      const liveChecksTotal = MLBD_HEALTH_CHECKS.length;
      const isLive = liveChecksPassed === liveChecksTotal;
      const partialLive = liveChecksPassed > 0 && liveChecksPassed < liveChecksTotal;
      const reachable = endpointResults.some(r => r.status >= 200 && r.status < 400);
      const homeCheck = checkMap.home || endpointResults[0];

      return {
        id: mirror.id,
        name: mirror.name,
        baseUrl: mirror.baseUrl,
        resolvedUrl: homeCheck?.resolvedUrl || mirror.baseUrl,
        priority: mirror.priority,
        status: homeCheck?.status || endpointResults.find(r => r.status > 0)?.status || 0,
        ok: isLive,
        online: isLive,
        live: isLive,
        partialLive,
        reachable,
        archiveCountedAsLive: false,
        liveChecksPassed,
        liveChecksTotal,
        liveCardCounts: {
          home: checkMap.home?.cardCount || 0,
          latest: checkMap.latest?.cardCount || 0,
          trending: checkMap.trending?.cardCount || 0,
          total: endpointResults.reduce((sum, r) => sum + (r.cardCount || 0), 0)
        },
        checks: checkMap,
        latencyMs: Date.now() - started
      };
    })
  );

  const nonPortalLiveMirrors = checks
    .filter(c => (c.live || c.partialLive) && !/\/\/(?:www\.)?movielinkbd\.com$/i.test(c.baseUrl))
    .sort((a, b) =>
      b.liveChecksPassed - a.liveChecksPassed ||
      a.latencyMs - b.latencyMs ||
      a.priority - b.priority
    );
  const primaryOnline = nonPortalLiveMirrors[0] || checks.find(c => c.live);
  if (primaryOnline?.resolvedUrl) {
    try {
      const nextOrigin = new URL(primaryOnline.resolvedUrl).origin;
      if (!/\/\/(?:www\.)?movielinkbd\.com$/i.test(nextOrigin)) {
        activeResolvedOrigin = nextOrigin;
        mlbdDirectMirrorsBlocked = false;
        mirrorsBlockedUntil = 0;
      }
    } catch {}
  } else {
    mlbdDirectMirrorsBlocked = true;
  }

  return setCached(
    "server-health",
    {
      ok: true,
      activeMirror: activeResolvedOrigin,
      onlineCount: checks.filter(c => c.online).length,
      liveCount: checks.filter(c => c.live).length,
      partialCount: checks.filter(c => c.partialLive).length,
      totalMirrors: checks.length,
      archiveCountedAsLive: false,
      requiredChecks: MLBD_HEALTH_CHECKS.map(c => c.path),
      cinepulseConfigured: isCinePulseConfigured(),
      servers: checks,
      checkedAt: new Date().toISOString()
    },
    30000
  );
}

function normalizeMlbdItemPath(rawHref) {
  try {
    const s = decodeHtmlEntities(String(rawHref || "").trim());
    if (!s) return "";
    const u = /^https?:\/\//i.test(s) ? new URL(s) : new URL(s, "https://5njsa5.movielinkbd.de");
    const p = u.pathname;
    if (/^\/(?:movie|series|drama|anime)\/[^/]+/i.test(p)) return p;
    return "";
  } catch {
    return "";
  }
}

export function extractCardsFromHtml(html, baseOrigin = activeResolvedOrigin, options = {}) {
  const items = [];
  const seen = new Set();
  const blocks = String(html || "").split(/<div class="movie-card"/i);

  for (let i = 1; i < blocks.length; i++) {
    const chunk = blocks[i].slice(0, 2600);
    const hrefMatch = chunk.match(/href="([^"]*\/(?:movie|series|drama|anime)\/[^"]+)"/i);
    const itemPath = normalizeMlbdItemPath(hrefMatch?.[1]);
    if (!itemPath || seen.has(itemPath)) continue;
    seen.add(itemPath);

    const titleFromA = chunk.match(/<a[^>]+class="title"[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const titleFromImg = chunk.match(/(?:title|alt)="([^"]+)"/i)?.[1];
    const title = stripTags(titleFromA || titleFromImg || "");
    if (!title) continue;

    const rawPoster =
      chunk.match(/data-src="([^"]+)"/i)?.[1] ||
      chunk.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp|avif)[^"]*)"/i)?.[1] ||
      "";
    const absPoster = rawPoster && !rawPoster.startsWith("data:")
      ? (rawPoster.startsWith("http") ? rawPoster : new URL(rawPoster, baseOrigin).href)
      : "";

    const quality = stripTags(chunk.match(/<span class="quality"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "") || "HD";
    const language = stripTags(chunk.match(/<span class="language"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const typeText = stripTags(chunk.match(/<span class="type[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const views = stripTags(chunk.match(/<span class="views-badge-top"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const epBadge = stripTags(chunk.match(/<span class="badge ep-badge[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const uploadTime = stripTags(chunk.match(/<div class="upload-time"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
    const r2TsMatch = absPoster.match(/poster_[a-z0-9_]*?(17\d{8})\./i);
    const r2EpochMs = r2TsMatch ? parseInt(r2TsMatch[1], 10) * 1000 : 0;
    const nowMs = Date.now();
    const parsedTimeMs = parseFlexibleDateMs(uploadTime);
    const uploadedAtMs = (r2EpochMs > nowMs - 48 * 3600_000 && r2EpochMs <= nowMs)
      ? r2EpochMs
      : (parsedTimeMs || r2EpochMs || 0);
    const isPinned = chunk.includes("pin-badge") || chunk.includes('data-pin="1"');
    const isAdult = chunk.includes('data-18="1"') || itemPath.includes("18plus") || epBadge.toUpperCase().includes("18+");
    const yr = extractPlausibleYear(title, "", itemPath);
    const isSeries = /^\/(?:series|drama|anime)\//i.test(itemPath) || /series|drama|episode|s\d+/i.test(`${typeText} ${epBadge}`);
    const isAnime = /^\/anime\//i.test(itemPath) || /anime/i.test(`${typeText} ${title}`);
    const ratingMatch = chunk.match(/★\s*(\d+(?:\.\d+)?)/);

    const builtItem = {
      id: itemPath.split("/").pop() || itemPath,
      path: itemPath,
      title: stripSiteBrandFromLabel(title) || title,
      searchTitle: cleanMlbdSearchTitle(title),
      poster: absPoster ? mlbdProxyImageUrl(absPoster) : "",
      rawPoster: absPoster,
      quality,
      language: language || (title.toLowerCase().includes("bangla") ? "Bangla" : ""),
      type: isAnime ? "anime" : isSeries ? "series" : "movie",
      isSeries,
      isMovie: !isSeries,
      isAnime,
      typeBadge: epBadge || typeText || (isAnime ? "Anime" : isSeries ? "Series" : "Movie"),
      episodePill: epBadge || "",
      year: yr,
      rating: ratingMatch ? ratingMatch[1] : "",
      viewsText: views,
      views: parseViewsCount(views),
      uploadTime,
      isPinned,
      isAdult,
      fromArchive: false,
      ...(uploadedAtMs > 0 ? { uploadedAtMs } : {}),
      hasResource: !/upcoming|release soon/i.test(quality + " " + title),
      isHindiDubbed: /hindi|dual/i.test(`${language} ${title}`),
      source: "movielinkbd",
      detailsEndpoint: `/api/details?path=${encodeURIComponent(itemPath)}`
    };
    if (!options?.skipRegistry) {
      registerMlbdItem(builtItem);
    }
    items.push(builtItem);
  }

  if (items.length && !options?.skipArchiveUpsert) {
    upsertMlbdArchiveItems(items, "/");
  }
  return items;
}

export function extractCategoriesFromHtml(html) {
  const found = [];
  const seen = new Set();
  const re = /<a[^>]+href="(\/(?:language|genre|type|category|collection|southIndian|anime|collections|new|popular|mostwatch)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const rawPath = decodeHtmlEntities(m[1]).split("#")[0].trim();
    if (!rawPath || rawPath.includes("'") || rawPath.includes("{") || rawPath.length > 80) continue;
    if (/^\/(?:anime|movie|series|drama|mlbd)\/[^/]+/i.test(rawPath)) continue;
    const rawLabel = stripTags(m[2]);
    if (!rawLabel || rawLabel.length > 42 || /show all/i.test(rawLabel)) continue;
    if (seen.has(rawPath)) continue;
    seen.add(rawPath);

    const group = rawPath.startsWith("/language/") || rawPath === "/southIndian"
      ? "Languages & Regions"
      : rawPath.startsWith("/genre/")
        ? "Genres"
        : "Collections";

    const rawClean = rawLabel.replace(/^[^\p{L}\p{N}]+/u, "").trim() || rawLabel;
    const cleanLabel = stripSiteBrandFromLabel(rawClean) || rawClean;
    const iconMatch = rawLabel.match(/^([^\p{L}\p{N}\s]{1,4})/u);
    found.push({
      label: cleanLabel,
      path: rawPath,
      group,
      icon: iconMatch ? iconMatch[1] : (group === "Genres" ? "🎭" : "🎬"),
      source: "movielinkbd"
    });
  }

  for (const fb of DEFAULT_FALLBACK_CATEGORIES) {
    if (!seen.has(fb.path)) {
      seen.add(fb.path);
      found.push({ ...fb, source: "movielinkbd" });
    }
  }
  return found;
}

function guessMlbdSectionPath(title, secHtml) {
  const hrefMatch = String(secHtml || "").match(/<a[^>]+href="(\/(?:language|genre|type|category|collection|southIndian|anime|new|mostwatch)[^"]*)"[^>]*>[\s\S]*?(?:view all|see all|more|›)?[\s\S]*?<\/a>/i);
  if (hrefMatch?.[1] && !/^\/(?:anime|movie|series)\/[^/]+/i.test(hrefMatch[1])) {
    return decodeHtmlEntities(hrefMatch[1]).split("#")[0].trim();
  }
  const t = String(title || "").toLowerCase();
  if (/top\s*10/i.test(t)) return "/top10";
  if (/new\s*&\s*popular|recently\s*added/i.test(t)) return "/new";
  if (/ongoing|series|tv\s*shows/i.test(t)) return "/type/series";
  if (/south\s*indian/i.test(t)) return "/southIndian";
  if (/anime/i.test(t)) return "/anime";
  if (/animation/i.test(t)) return "/genre/animation";
  if (/bangla\s*dub/i.test(t)) return "/language/bangla-dubbed";
  if (/bangla|bengali/i.test(t)) return "/language/bangla";
  if (/hindi\s*dub/i.test(t)) return "/language/hindi-dubbed";
  if (/dual\s*audio/i.test(t)) return "/language/dual-audio";
  if (/movies/i.test(t)) return "/type/movies";
  return "/new";
}

function extractHomeSections(html, baseOrigin) {
  const sections = [];
  const railSplits = String(html || "").split(/<section[^>]+class="[^"]*rail-section[^"]*"[^>]*>/i);
  for (let i = 1; i < railSplits.length; i++) {
    const secHtml = railSplits[i].split(/<\/section>/i)[0] || "";
    const titleRaw = secHtml.match(/<h[1-4][^>]*class="[^"]*mlbd-rail-title[^"]*"[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ||
      secHtml.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ||
      "Featured";
    const title = stripSiteBrandFromLabel(stripTags(titleRaw)) || "Featured";
    const items = extractCardsFromHtml(secHtml, baseOrigin);
    if (title && items.length) {
      sections.push({
        id: `mlbd-${i}`,
        title,
        categoryPath: guessMlbdSectionPath(title, secHtml),
        items,
        source: "movielinkbd"
      });
    }
  }

  if (!sections.length) {
    const fallbackItems = extractCardsFromHtml(html, baseOrigin);
    if (fallbackItems.length) {
      sections.push({ id: "mlbd-latest", title: "🔥 Latest", categoryPath: "/new", items: fallbackItems, source: "movielinkbd" });
    }
  }

  return sections;
}

function extractPagination(html, currentPage = 1) {
  let maxPage = Math.max(1, Number(currentPage) || 1);
  const re = /\/page\/(\d+)/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const p = Number(m[1]);
    if (Number.isFinite(p) && p > maxPage && p < 1000) maxPage = p;
  }
  return {
    page: Math.max(1, Number(currentPage) || 1),
    maxPage,
    totalPages: maxPage,
    hasMore: currentPage < maxPage
  };
}

function extractBalancedJson(source, markerRegex) {
  const str = String(source || "");
  const match = markerRegex.exec(str);
  if (!match) return null;
  const idx = match.index + match[0].length;
  const braceStart = str.indexOf("{", idx - 1);
  if (braceStart < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = braceStart; i < str.length; i++) {
    const c = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(str.slice(braceStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function extractDownloadButtonsFromHtml(html, baseOrigin) {
  const buttons = [];
  const seen = new Set();

  const dlRe = /<a[^>]*data-dl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = dlRe.exec(String(html || "")))) {
    const tag = m[0];
    const b64 = m[1];
    const ds = tag.match(/data-ds="([^"]+)"/i)?.[1] || "";
    const dr = tag.match(/data-dr="([^"]+)"/i)?.[1] || "0";
    const decodedPath = decDataDl(b64, ds, dr);
    if (!decodedPath) continue;
    let absUrl = "";
    try {
      absUrl = new URL(decodedPath, baseOrigin).href;
    } catch {
      continue;
    }
    if (!validateExternalHttpUrl(absUrl) || seen.has(absUrl)) continue;
    seen.add(absUrl);

    const text = stripTags(m[2]);
    const qMatch = text.match(/(\d{3,4}p|4K|HD)/i);
    const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB))/i);
    buttons.push({
      label: text || "Download",
      quality: qMatch ? qMatch[1] : "HD",
      sizeText: sizeMatch ? sizeMatch[1] : "",
      url: mlbdProxyGoUrl(absUrl),
      type: "gateway",
      provider: "MovieStreamBD Mirror"
    });
  }

  const goRe = /<a[^>]+href="([^"]*\/(?:go\?t=|file\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = goRe.exec(String(html || "")))) {
    let absUrl = "";
    try {
      absUrl = new URL(decodeHtmlEntities(m[1]), baseOrigin).href;
    } catch {
      continue;
    }
    if (!validateExternalHttpUrl(absUrl) || seen.has(absUrl)) continue;
    seen.add(absUrl);
    const text = stripTags(m[2]);
    const qMatch = text.match(/(\d{3,4}p|4K|HD)/i);
    const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB))/i);
    buttons.push({
      label: text || "Download",
      quality: qMatch ? qMatch[1] : "HD",
      sizeText: sizeMatch ? sizeMatch[1] : "",
      url: mlbdProxyGoUrl(absUrl),
      type: "gateway",
      provider: "MovieStreamBD Mirror"
    });
  }

  return buttons;
}

function extractEpisodeDownloadMap(html, baseOrigin) {
  const byEpKey = new Map();
  const cards = String(html || "").split(/<div[^>]+class="[^"]*\bep-card\b[^"]*"/i);
  for (let i = 1; i < cards.length; i++) {
    const chunk = cards[i].slice(0, 4500);
    const seasonAttr = chunk.match(/data-season-number="([^"]*)"/i)?.[1] || "";
    const epAttr = chunk.match(/data-episode-number="([^"]*)"/i)?.[1] || "";
    const epTitle = stripTags(chunk.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || "");
    const btns = extractDownloadButtonsFromHtml(chunk, baseOrigin);
    if (!btns.length) continue;

    const se = Number(seasonAttr) || Number(epTitle.match(/S(?:eason)?\s*0*(\d+)/i)?.[1] || 0) || 0;
    const ep = Number(epAttr) || Number(epTitle.match(/(?:Episode|Ep)\s*0*(\d+)/i)?.[1] || i);
    const key = `${se}:${ep}`;
    byEpKey.set(key, btns);
    byEpKey.set(`ep:${ep}`, btns);
  }
  return byEpKey;
}

function extractPageSubtitles(html, baseOrigin) {
  const subs = [];
  const seen = new Set();
  const re = /<a[^>]+href="([^"]*\/media\/sub\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let idx = 0;
  while ((m = re.exec(String(html || "")))) {
    try {
      const absUrl = new URL(decodeHtmlEntities(m[1]), baseOrigin).href;
      if (seen.has(absUrl)) continue;
      seen.add(absUrl);
      const label = stripTags(m[2]) || `Subtitle ${idx + 1}`;
      const lang = /bangla|বাংলা/i.test(label) ? "bn" : /hindi/i.test(label) ? "hi" : "en";
      subs.push({
        label,
        language: lang,
        url: mlbdProxySubtitleUrl(absUrl, idx++)
      });
    } catch {}
  }
  return subs;
}

function mapPd2AudioTracks(audioList = []) {
  return (Array.isArray(audioList) ? audioList : [])
    .map((a, idx) => {
      if (typeof a === "string") return { index: idx, label: a, language: a };
      if (!a || typeof a !== "object") return null;
      const rawUrl = a.url || a.uri || "";
      const label = a.label || a.name || a.title || a.language || a.lang || `Audio ${idx + 1}`;
      return {
        index: idx,
        label,
        language: a.lang || a.language || "",
        url: rawUrl && validateExternalHttpUrl(rawUrl) ? mlbdProxyStreamUrl(rawUrl, `${label}.mp4`) : ""
      };
    })
    .filter(Boolean);
}

function mapPd2Subtitles(subs = [], baseIdx = 0) {
  return (Array.isArray(subs) ? subs : [])
    .map((s, idx) => {
      const rawUrl = s?.url || s?.src || "";
      const proxied = mlbdProxySubtitleUrl(rawUrl, baseIdx + idx);
      if (!proxied) return null;
      return {
        label: s.label || s.name || s.lang || "Subtitle",
        language: String(s.lang || s.language || "und"),
        url: proxied
      };
    })
    .filter(Boolean);
}

function buildSourcesForPd2Entry(entry, pd2Fallback = {}, filenameBase = "") {
  const sources = [];
  const safeBase = String(filenameBase || pd2Fallback?.title || "MovieStreamBD")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  const mp4Raw = entry?.mp4 || pd2Fallback?.mp4 || "";
  if (mp4Raw && validateExternalHttpUrl(mp4Raw)) {
    const fileLabel = [safeBase, entry?.label && entry.label !== "Movie" ? entry.label : "", "1080p"]
      .filter(Boolean)
      .join(" - ") + ".mp4";
    sources.push({
      url: mlbdProxyStreamUrl(mp4Raw, fileLabel),
      quality: "1080p",
      format: "MP4",
      mime: "video/mp4",
      provider: "MovieStreamBD Direct MP4",
      audioLanguage: pd2Fallback?.langs || ""
    });
  }

  const masterRaw = entry?.master || pd2Fallback?.master || "";
  if (masterRaw && validateExternalHttpUrl(masterRaw)) {
    sources.push({
      url: mlbdProxyHlsUrl(masterRaw),
      quality: mp4Raw ? "HLS Auto" : "1080p",
      format: "HLS",
      mime: "application/vnd.apple.mpegurl",
      provider: "MovieStreamBD Multi-Audio HLS",
      audioLanguage: pd2Fallback?.langs || ""
    });
  }

  if (Array.isArray(entry?.sources)) {
    for (const s of entry.sources) {
      const raw = s?.url || s?.src || "";
      if (!validateExternalHttpUrl(raw)) continue;
      const isHls = /\.m3u8|\/m\/|\/hls\//i.test(raw) || /hls|mpegurl/i.test(String(s.type || s.format || ""));
      sources.push({
        url: isHls ? mlbdProxyHlsUrl(raw) : mlbdProxyStreamUrl(raw, `${safeBase}.mp4`),
        quality: String(s.quality || s.label || "720p"),
        format: isHls ? "HLS" : "MP4",
        mime: isHls ? "application/vnd.apple.mpegurl" : "video/mp4",
        provider: "MovieStreamBD Player"
      });
    }
  }

  return sources;
}

async function fetchMlbdComPage(pagePath = "/") {
  const clean = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
  const cacheKey = `mlbdcom:${clean}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const headers = {
    ...CHROME_SEC_HEADERS,
    "User-Agent": MOVIEBOX_UA
  };
  try {
    const res = await fetch(`https://movielinkbd.com${clean}`, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const html = await res.text();
      return setCached(cacheKey, html, 180000);
    }
  } catch {}

  const cRes = await curlHttpRequest(`https://movielinkbd.com${clean}`, {
    method: "GET",
    headers,
    timeoutMs: 12000
  });
  if (cRes?.ok && cRes.text) {
    return setCached(cacheKey, cRes.text, 180000);
  }
  throw new Error(`HTTP ${cRes?.status || 502} from movielinkbd.com${clean}`);
}

function buildMlbdComItem({ title, rawPoster = "", rating = "", year = "", typeText = "", href = "", languageHint = "", genreHint = "", uploadedAtMs = 0, uploadTime = "" }) {
  const cleanTitle = dedupeRepeatedTitleYear(stripTags(title).replace(/<small>[\s\S]*?<\/small>/gi, "").trim());
  if (!cleanTitle) return null;
  const yr = extractPlausibleYear(cleanTitle, year, href);
  const isSeries = /^\/(?:series|drama|anime)\//i.test(href) ||
    /series|drama|season|s\d{1,2}|ep\s*\d+/i.test(`${typeText} ${cleanTitle}`);
  const isAnime = /^\/anime\//i.test(href) || /anime/i.test(`${typeText} ${cleanTitle} ${genreHint}`);

  let itemPath = normalizeMlbdItemPath(href);
  if (!itemPath) {
    const slug = slugifyMlbdTitle(cleanTitle);
    const kind = isAnime ? "anime" : isSeries ? "series" : "movie";
    itemPath = `/mlbd/${kind}/${slug}${yr ? `-${yr}` : ""}`;
  } else {
    itemPath = `/mlbd${itemPath}`;
  }

  const searchTitle = cleanMlbdSearchTitle(cleanTitle);
  const absPoster = rawPoster && /^https?:\/\//i.test(rawPoster) ? rawPoster : "";
  const regHit = lookupPosterRegistry(searchTitle, yr);
  const archHit = mlbdArchiveByNormTitle.get(normalizePosterKey(searchTitle)) || null;
  const resolvedRawPoster = absPoster || regHit?.rawPoster || archHit?.rawPoster || "";
  const isHindi = /hindi|dual\s*audio/i.test(`${cleanTitle} ${languageHint}`);
  const isBangla = /bangla|bengali/i.test(`${cleanTitle} ${languageHint}`);
  const item = {
    id: itemPath.split("/").pop() || itemPath,
    path: itemPath,
    title: cleanTitle,
    searchTitle,
    poster: absPoster ? mlbdProxyImageUrl(absPoster) : (regHit?.poster || archHit?.poster || ""),
    rawPoster: resolvedRawPoster,
    mbSubjectId: regHit?.mbSubjectId || archHit?.mbSubjectId || "",
    mbDetailPath: regHit?.mbDetailPath || archHit?.mbDetailPath || "",
    quality: /full\s*hd|1080p/i.test(cleanTitle) ? "1080p" : "HD",
    language: languageHint || (isHindi ? "Hindi Dubbed" : isBangla ? "Bangla" : ""),
    genre: genreHint || "",
    type: isAnime ? "anime" : isSeries ? "series" : "movie",
    isSeries,
    isMovie: !isSeries,
    isAnime,
    typeBadge: isAnime ? "Anime" : isSeries ? "Series" : "Movie",
    year: yr,
    rating: String(rating || regHit?.rating || archHit?.rating || ""),
    ...(uploadTime ? { uploadTime } : {}),
    ...(uploadedAtMs > 0 ? { uploadedAtMs } : {}),
    hasResource: !/upcoming|release soon/i.test(cleanTitle),
    isHindiDubbed: isHindi,
    source: "movielinkbd",
    detailsEndpoint: `/api/details?path=${encodeURIComponent(itemPath)}&title=${encodeURIComponent(searchTitle)}`
  };
  registerMlbdItem(item);
  return item;
}

function inferHintsFromMlbdPath(pagePath = "/") {
  const p = String(pagePath || "/").toLowerCase();
  let langHint = "";
  let genreHint = "";
  if (p.includes("hindi-dubbed")) langHint = "Hindi Dubbed";
  else if (p.includes("hindi")) langHint = "Hindi";
  else if (p.includes("bangla-dubbed")) langHint = "Bangla Dubbed";
  else if (p.includes("bangla")) langHint = "Bangla";
  else if (p.includes("korean")) langHint = "Korean";
  else if (p.includes("chinese")) langHint = "Chinese";
  else if (p.includes("japanese")) langHint = "Japanese";
  else if (p.includes("turkish")) langHint = "Turkish";
  else if (p.includes("south-indian")) langHint = "South Indian";
  else if (p.includes("tamil")) langHint = "Tamil";
  else if (p.includes("telugu")) langHint = "Telugu";
  else if (p.includes("malayalam")) langHint = "Malayalam";
  else if (p.includes("kannada")) langHint = "Kannada";
  else if (p.includes("marathi")) langHint = "Marathi";
  else if (p.includes("punjabi")) langHint = "Punjabi";
  else if (p.includes("indonesian")) langHint = "Indonesian";
  else if (p.includes("spanish")) langHint = "Spanish";
  else if (p.includes("french")) langHint = "French";
  else if (p.includes("english")) langHint = "English";
  else if (p.includes("dual-audio")) langHint = "Dual Audio";

  const gMatch = p.match(/\/browse\/genre-([a-z0-9-]+)/);
  if (gMatch) {
    genreHint = gMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  } else if (p.includes("action-movies")) {
    genreHint = "Action";
  } else if (p.includes("animation-movies")) {
    genreHint = "Animation";
  }
  return { langHint, genreHint };
}

function extractMlbdComCards(html, pagePath = "/") {
  const items = [];
  const seen = new Set();
  const s = String(html || "");
  const now = Date.now();
  const currentYear = new Date(now + 6 * 3600 * 1000).getUTCFullYear();
  const isLatestHomePage = pagePath === "/";
  const isFreshSectionPage = isLatestHomePage || /^\/(?:movies|web-series|hindi-movies|south-indian-movies|korean-drama|animation-movies|action-movies|browse\/(?:bangla|bangla-dubbed|hindi-dubbed|hindi|korean|turkish|genre-thriller))$/i.test(pagePath);
  const assignUploadTime = (built) => {
    if (!built) return;
    const yrNum = Number(built.year || 0);
    if (isFreshSectionPage && (!yrNum || yrNum >= currentYear - 1) && (isLatestHomePage || items.length < 18)) {
      const offsetMs = isLatestHomePage ? 0 : 1_800_000;
      built.uploadedAtMs = now - offsetMs - items.length * 60_000;
      if (!built.uploadTime) built.uploadTime = "Today";
    }
  };
  const { langHint, genreHint } = inferHintsFromMlbdPath(pagePath);

  // 1. Parse .mlbd-cat-card anchors (on /)
  const catChunks = s.split(/<a\s+class="mlbd-cat-card"/i);
  for (let i = 1; i < catChunks.length; i++) {
    const chunk = catChunks[i].slice(0, 1800);
    const href = chunk.match(/href="([^"]+)"/i)?.[1] || "";
    const rawTitle = stripTags(chunk.match(/<span\s+class="mlbd-cat-t"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const rawPoster = chunk.match(/src="(https?:\/\/[^"]+)"/i)?.[1] || "";
    const typeText = stripTags(chunk.match(/<i\s+class="mlbd-cat-type"[^>]*>([\s\S]*?)<\/i>/i)?.[1] || "");
    const rating = stripTags(chunk.match(/<b>\s*★?\s*([^<]+)<\/b>/i)?.[1] || "");
    const built = buildMlbdComItem({ title: rawTitle, rawPoster, rating, typeText, href, languageHint: langHint, genreHint });
    if (built && !seen.has(built.title.toLowerCase())) {
      seen.add(built.title.toLowerCase());
      assignUploadTime(built);
      items.push(built);
    }
  }

  // 2. Parse .mlbd-list-card divs (on /movies, /web-series, /hindi-movies, /south-indian-movies, /korean-drama, /animation-movies, /action-movies)
  const listChunks = s.split(/<div\s+class="mlbd-list-card"/i);
  for (let i = 1; i < listChunks.length; i++) {
    const chunk = listChunks[i].slice(0, 1600);
    const rawTitle = stripTags(chunk.match(/<span\s+class="mlbd-list-t"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const rawPoster = chunk.match(/src="(https?:\/\/[^"]+)"/i)?.[1] || "";
    const typeText = stripTags(chunk.match(/<i>([\s\S]*?)<\/i>/i)?.[1] || "");
    const rating = stripTags(chunk.match(/<b>\s*★?\s*([^<]+)<\/b>/i)?.[1] || "");
    const built = buildMlbdComItem({ title: rawTitle, rawPoster, rating, typeText, languageHint: langHint, genreHint });
    if (built && !seen.has(built.title.toLowerCase())) {
      seen.add(built.title.toLowerCase());
      assignUploadTime(built);
      items.push(built);
    }
  }

  // 3. Parse JSON-LD ItemList (captures rating + image if present)
  const ldRe = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = ldRe.exec(s))) {
    try {
      const parsed = JSON.parse(ldMatch[1]);
      if (parsed?.["@type"] === "ItemList" && Array.isArray(parsed.itemListElement)) {
        for (const el of parsed.itemListElement) {
          const it = el?.item;
          if (!it?.name) continue;
          const cleanName = stripTags(it.name);
          const built = buildMlbdComItem({
            title: cleanName,
            rawPoster: typeof it.image === "string" ? it.image : "",
            rating: it.aggregateRating?.ratingValue ? String(it.aggregateRating.ratingValue) : "",
            typeText: it["@type"] === "TVSeries" ? "Series" : it["@type"] === "Movie" ? "Movie" : "",
            languageHint: langHint,
            genreHint
          });
          if (built && !seen.has(built.title.toLowerCase())) {
            seen.add(built.title.toLowerCase());
            assignUploadTime(built);
            items.push(built);
          }
        }
      }
    } catch {}
  }

  // 4. Parse .mlbd-browse-list li items (on /browse/*)
  const browseRe = /<li>\s*<span\s+class="bt">([\s\S]*?)<\/span>\s*<span\s+class="by">([\s\S]*?)<\/span>\s*<\/li>/gi;
  let bm;
  while ((bm = browseRe.exec(s))) {
    const rawTitle = stripTags(bm[1]);
    const yr = stripTags(bm[2]);
    const built = buildMlbdComItem({ title: rawTitle, year: yr, languageHint: langHint, genreHint });
    if (built && !seen.has(built.title.toLowerCase())) {
      seen.add(built.title.toLowerCase());
      assignUploadTime(built);
      items.push(built);
    }
  }

  return items;
}

function decodeJsonEscapedText(str = "") {
  return decodeHtmlEntities(String(str || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"'));
}

async function lookupPosterFromImdb(searchTitle, year = "") {
  const q = String(searchTitle || "").trim();
  const firstMatch = q.toLowerCase().match(/[a-z0-9]/);
  if (!q || !firstMatch) return null;
  const first = encodeURIComponent(firstMatch[0]);
  try {
    const res = await fetch(`https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(q.toLowerCase())}.json`, {
      headers: { "User-Agent": MOVIEBOX_UA },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.d) ? data.d : [];
    const titleTypes = new Set(["movie", "tvSeries", "tvMiniSeries", "tvMovie", "tvSpecial", "short", "video"]);
    let best = null;
    let bestScore = 0;

    for (const entry of list) {
      const imgUrl = entry?.i?.imageUrl;
      if (!imgUrl) continue;
      if (entry.qid && !titleTypes.has(entry.qid)) continue;
      const sim = titleSimilarityScore(q, entry.l || "", { queryYear: year, candidateYear: entry.y || "" });
      const yrMatch = year && entry.y && String(entry.y) === String(year);
      if (sim < (yrMatch ? 0.58 : 0.68)) continue;

      let score = sim * 10;
      if (yrMatch) score += 5;
      if (entry.qid === "movie" || entry.qid === "tvSeries") score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    if (!best?.i?.imageUrl) return null;
    const resized = String(best.i.imageUrl).replace(/\._V1_[^.]*\.jpg$/i, "._V1_QL80_UX420_.jpg");
    return { poster: mlbdProxyImageUrl(resized), rating: "" };
  } catch {
    return null;
  }
}

async function lookupPosterFromTvMaze(searchTitle, year = "") {
  try {
    const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(searchTitle)}`, {
      headers: { "User-Agent": MOVIEBOX_UA },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const rows = await res.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      const show = row?.show;
      const img = show?.image?.medium || show?.image?.original || "";
      if (!img) continue;
      const showYear = String(show?.premiered || "").slice(0, 4);
      if (titleSimilarityScore(searchTitle, show?.name || "", { queryYear: year, candidateYear: showYear }) >= 0.68) {
        return {
          poster: mlbdProxyImageUrl(img),
          rating: show?.rating?.average ? String(show.rating.average) : ""
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function lookupPosterFromItunes(searchTitle, year = "") {
  try {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTitle)}&media=movie&limit=5`, {
      headers: { "User-Agent": MOVIEBOX_UA },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const item of Array.isArray(data?.results) ? data.results : []) {
      const art = item?.artworkUrl100 || "";
      if (!art) continue;
      const itemYear = String(item?.releaseDate || "").slice(0, 4);
      if (titleSimilarityScore(searchTitle, item.trackName || item.collectionName || "", { queryYear: year, candidateYear: itemYear }) >= 0.68) {
        return { poster: mlbdProxyImageUrl(art.replace("100x100bb", "450x450bb")), rating: "" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function lookupPosterFromWiki(searchTitle, year = "") {
  const results = await Promise.all(
    ["en", "bn"].map(async lang => {
      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${searchTitle} ${year || ""}`.trim())}&gsrlimit=3&prop=pageimages|extracts&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=420&format=json`;
        const res = await fetch(url, {
          headers: { "User-Agent": "MovieStreamBD/1.0" },
          signal: AbortSignal.timeout(2800)
        });
        if (!res.ok) return null;
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {});
        for (const p of pages) {
          const src = p?.thumbnail?.source || "";
          if (!src || /Flag_of_|Commons-logo|Question_book/i.test(src)) continue;
          const cleanTitle = String(p.title || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
          const extract = String(p.extract || "");
          if (/may refer to:/i.test(extract)) continue;
          if (titleSimilarityScore(searchTitle, cleanTitle, { queryYear: year }) >= 0.68) {
            return { poster: mlbdProxyImageUrl(src), rating: "" };
          }
        }
      } catch {}
      return null;
    })
  );
  return results.find(Boolean) || null;
}

async function lookupPosterFromYouTube(searchTitle, languageHint = "", year = "") {
  try {
    const q = `${searchTitle} ${year || ""} ${/bangla|bengali/i.test(languageHint) ? "bangla" : ""} official trailer`.trim();
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(3200)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const matches = [...html.matchAll(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,600}?"text":"([^"]+)"/g)].slice(0, 6);
    const picked = matches.find(m => {
      const rawYtTitle = decodeJsonEscapedText(m[2]);
      const candYear = rawYtTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "";
      return titleSimilarityScore(searchTitle, cleanYoutubeTrailerTitle(rawYtTitle), { queryYear: year, candidateYear: candYear }) >= 0.65;
    });
    const vid = picked?.[1];
    if (!vid) return null;
    return { poster: mlbdProxyImageUrl(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`), rating: "" };
  } catch {
    return null;
  }
}

async function resolvePosterForSingleQuery(searchTitle, item) {
  const year = String(item?.year || "");
  const wantSeries = Boolean(item?.isSeries);
  // 1. Run MovieBox search + IMDb Suggest + TVMaze + iTunes concurrently
  const mbSearchTask = (async () => {
    try {
      const res = await handleMovieBoxRoute("search", new URLSearchParams({ q: searchTitle, page: "1" }));
      const candidates = Array.isArray(res?.items) ? res.items : [];
      const matched = candidates
        .filter(c => c?.poster && !isNigerianContent(c) && !isMusicOrClipSubject(c))
        .map(c => {
          const sim = titleSimilarityScore(searchTitle, c?.title || "", { queryYear: year, candidateYear: c?.year || "" });
          const sameFmt = Boolean(c?.isSeries) === wantSeries;
          const total = sim + (year && c?.year === year ? 0.12 : 0) + (sameFmt ? 0.08 : -0.08);
          return { c, sim, total };
        })
        .filter(x => x.sim >= 0.72 && (Boolean(x.c?.isSeries) === wantSeries || x.sim >= 0.88))
        .sort((a, b) => b.total - a.total)[0]?.c;
      if (matched?.poster) {
        return {
          poster: matched.poster,
          rating: matched.rating || "",
          mbSubjectId: matched.subjectId || "",
          mbDetailPath: matched.detailPath || ""
        };
      }
    } catch {}
    return null;
  })();

  const [mbHit, imdbHit, tvHit, itunesHit] = await Promise.all([
    mbSearchTask,
    lookupPosterFromImdb(searchTitle, year),
    item?.isSeries ? lookupPosterFromTvMaze(searchTitle, year) : Promise.resolve(null),
    lookupPosterFromItunes(searchTitle, year)
  ]);

  const primaryHit = mbHit || imdbHit || tvHit || itunesHit;
  if (primaryHit?.poster) return primaryHit;

  // 2. Wikipedia & YouTube in parallel for regional Bangla/South-Indian/Turkish titles
  const [wikiHit, ytHit] = await Promise.all([
    lookupPosterFromWiki(searchTitle, year),
    lookupPosterFromYouTube(searchTitle, item?.language || "", year)
  ]);
  return wikiHit || ytHit || null;
}

async function resolvePosterForItem(item) {
  const searchTitle = String(item?.searchTitle || cleanMlbdSearchTitle(item?.title || "")).trim();
  if (!searchTitle) return null;
  const year = String(item?.year || "");
  const cacheKey = `posterlookup:${searchTitle.toLowerCase()}|${year}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached || null;
  if (posterInFlight.has(cacheKey)) return await posterInFlight.get(cacheKey);

  const job = (async () => {
    try {
      const queries = [];
      const addQ = (q) => {
        const clean = String(q || "").trim();
        if (clean.length >= 2 && !queries.includes(clean)) queries.push(clean);
      };

      const rawTitle = String(item?.title || "");
      const yrSplit = rawTitle.match(/^(.+?)\s*\((?:19|20)\d{2}[^)]*\)\s+(.+)$/);
      if (yrSplit) {
        const left = cleanMlbdSearchTitle(yrSplit[1]);
        const right = cleanMlbdSearchTitle(yrSplit[2]);
        if (left && right && right.length >= 3) {
          addQ(left);
          addQ(right);
        }
      }

      const altParts = searchTitle
        .split(/\s*[\/|]\s*/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
      for (const p of altParts.slice(0, 2)) addQ(p);
      addQ(searchTitle);

      const strippedSaga = searchTitle.replace(/\b(?:Complete\s+)?Saga\b/gi, "").replace(/\s+/g, " ").trim();
      if (strippedSaga && strippedSaga !== searchTitle) addQ(strippedSaga);

      for (const q of queries.slice(0, 3)) {
        const hit = await resolvePosterForSingleQuery(q, item);
        if (hit?.poster) {
          return setCached(cacheKey, hit, 21600000);
        }
      }

      setCached(cacheKey, false, 3600000);
      return null;
    } finally {
      posterInFlight.delete(cacheKey);
    }
  })();

  posterInFlight.set(cacheKey, job);
  return await job;
}

async function resolveMbBridgeForItem(item) {
  const rawSeed = String(item?.title || item?.searchTitle || "").trim();
  const variants = splitSearchTitleVariants(rawSeed);
  const searchTitle = cleanMlbdSearchTitle(rawSeed) || variants[0] || "";
  if (!searchTitle && !variants.length) return null;
  const year = String(item?.year || "");
  const wantSeries = Boolean(item?.isSeries || /\b(?:S\d{1,2}|Season\s*\d+|Ep(?:isode)?s?\s*\d+)\b/i.test(rawSeed));
  const cacheKey = `mbbridge:${(variants[0] || searchTitle).toLowerCase()}|${year}|${wantSeries ? "s" : "m"}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached || null;

  const queryList = [...new Set([
    ...variants,
    ...(searchTitle ? expandSearchQueryVariants(searchTitle) : [])
  ])].filter(q => q.length >= 2).slice(0, 2);

  try {
    for (const q of queryList) {
      const res = await handleMovieBoxRoute("search", new URLSearchParams({ q, page: "1" })).catch(() => null);
      const candidates = Array.isArray(res?.items) ? res.items : [];
      const matched = candidates
        .filter(c => c && !isNigerianContent(c) && !isMusicOrClipSubject(c) && c?.hasResource !== false)
        .map(c => {
          const sim = titleSimilarityScore(q, c?.title || "", {
            queryYear: year,
            candidateYear: c?.year || "",
            isSeries: wantSeries
          });
          const sameFmt = Boolean(c?.isSeries) === wantSeries;
          const total = sim + (year && c?.year === year ? 0.12 : 0) + (sameFmt ? 0.08 : -0.08);
          return { c, sim, total };
        })
        .filter(x => x.sim >= 0.74 && (Boolean(x.c?.isSeries) === wantSeries || x.sim >= 0.90))
        .sort((a, b) => b.total - a.total)[0]?.c;
      if (matched?.subjectId) {
        const hit = { mbSubjectId: matched.subjectId, mbDetailPath: matched.detailPath || "" };
        return setCached(cacheKey, hit, 21600000);
      }
    }
    return setCached(cacheKey, false, 3600000) || null;
  } catch {
    return null;
  }
}

async function enrichMlbdItemsWithPosters(items = [], maxToEnrich = 24, concurrency = 6) {
  const list = Array.isArray(items) ? items : [];
  // Pass 1: instant in-memory poster + bridge registry match (even if poster already exists)
  for (const item of list) {
    if (!item) continue;
    const reg = lookupPosterRegistry(item.searchTitle || cleanMlbdSearchTitle(item.title || ""), item.year);
    if (!reg) continue;
    let changed = false;
    if (!item.poster && reg.poster) {
      item.poster = reg.poster;
      changed = true;
    }
    if (reg.mbSubjectId && !item.mbSubjectId) {
      item.mbSubjectId = reg.mbSubjectId;
      changed = true;
    }
    if (reg.mbDetailPath && !item.mbDetailPath) {
      item.mbDetailPath = reg.mbDetailPath;
      changed = true;
    }
    if (reg.rating && !item.rating) {
      item.rating = reg.rating;
      changed = true;
    }
    if (changed) registerMlbdItem(item);
  }

  // Pass 2: bounded async enrichment across unpostered cards + bridge lookup for postered cards
  const bridgeLimit = Math.max(maxToEnrich, 48);
  const needPoster = list.filter(it => it && !it.poster && (it.searchTitle || it.title)).slice(0, maxToEnrich);
  const needBridgeOnly = list.filter(it => it && it.poster && !it.mbSubjectId && !it.isUpcoming && (it.searchTitle || it.title)).slice(0, bridgeLimit);
  const step = Math.max(1, Math.min(12, Number(concurrency) || 6));

  for (let i = 0; i < needPoster.length; i += step) {
    const batch = needPoster.slice(i, i + step);
    await Promise.allSettled(
      batch.map(async item => {
        const hit = await resolvePosterForItem(item);
        if (hit?.poster) {
          item.poster = hit.poster;
          if (hit.mbSubjectId) item.mbSubjectId = hit.mbSubjectId;
          if (hit.mbDetailPath) item.mbDetailPath = hit.mbDetailPath;
          if (!item.rating && hit.rating) item.rating = hit.rating;
          registerMlbdItem(item);
        }
      })
    );
  }

  for (let i = 0; i < needBridgeOnly.length; i += step) {
    const batch = needBridgeOnly.slice(i, i + step);
    await Promise.allSettled(
      batch.map(async item => {
        const bridge = await resolveMbBridgeForItem(item);
        if (bridge?.mbSubjectId) {
          item.mbSubjectId = bridge.mbSubjectId;
          if (bridge.mbDetailPath) item.mbDetailPath = bridge.mbDetailPath;
          registerMlbdItem(item);
        }
      })
    );
  }
  return list;
}

const DEFAULT_MLBD_COM_CONTENT_PATHS = [
  "/", "/movies", "/web-series", "/hindi-movies", "/south-indian-movies",
  "/action-movies", "/korean-drama", "/animation-movies",
  "/browse/bangla", "/browse/bangla-dubbed", "/browse/hindi-dubbed", "/browse/dual-audio",
  "/browse/hindi", "/browse/english", "/browse/korean", "/browse/chinese",
  "/browse/japanese", "/browse/tamil", "/browse/telugu", "/browse/malayalam",
  "/browse/punjabi", "/browse/turkish", "/browse/spanish", "/browse/french",
  "/browse/indonesian", "/browse/kannada", "/browse/marathi", "/browse/others",
  "/browse/genre-action", "/browse/genre-adventure", "/browse/genre-animation",
  "/browse/genre-biographical", "/browse/genre-comedy", "/browse/genre-crime",
  "/browse/genre-documentary", "/browse/genre-drama", "/browse/genre-family",
  "/browse/genre-fantasy", "/browse/genre-historical", "/browse/genre-horror",
  "/browse/genre-music", "/browse/genre-musical", "/browse/genre-mystery",
  "/browse/genre-romance", "/browse/genre-sci-fi", "/browse/genre-sports",
  "/browse/genre-superhero", "/browse/genre-survival", "/browse/genre-suspense",
  "/browse/genre-thriller", "/browse/genre-war"
];

async function getMlbdComSitemapPaths() {
  const cached = getCached("mlbdcom:sitemap");
  if (cached) return cached;
  try {
    let xml = "";
    try {
      const res = await fetch("https://movielinkbd.com/sitemap.xml", {
        headers: { ...CHROME_SEC_HEADERS, "User-Agent": MOVIEBOX_UA, Accept: "application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) xml = await res.text();
    } catch {}
    if (!xml) {
      const cRes = await curlHttpRequest("https://movielinkbd.com/sitemap.xml", {
        headers: { ...CHROME_SEC_HEADERS, "User-Agent": MOVIEBOX_UA, Accept: "application/xml,text/xml,*/*" },
        timeoutMs: 8000
      });
      if (cRes?.ok && cRes.text) xml = cRes.text;
    }
    if (xml) {
      const paths = [...new Set(
        [...xml.matchAll(/<loc>https:\/\/movielinkbd\.com(\/[^<]*)<\/loc>/gi)]
          .map(m => (m[1] || "/").trim())
          .filter(p => /^\/(?:$|movies|web-series|hindi-movies|south-indian-movies|action-movies|korean-drama|animation-movies|browse(?:\/|$))/i.test(p))
      )];
      if (paths.length >= 10) {
        return setCached("mlbdcom:sitemap", paths, 3600000);
      }
    }
  } catch {}
  return setCached("mlbdcom:sitemap", DEFAULT_MLBD_COM_CONTENT_PATHS, 600000);
}

let mlbdComFullIndexPromise = null;
async function getMlbdComFullIndex() {
  const cached = getCached("mlbdcom:full-index");
  if (cached) return cached;
  if (mlbdComFullIndexPromise) return await mlbdComFullIndexPromise;

  mlbdComFullIndexPromise = (async () => {
    const paths = await getMlbdComSitemapPaths();
    const all = [];
    const seen = new Set();
    const batchSize = 8;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map(async tp => ({ tp, html: await fetchMlbdComPage(tp) }))
      );
      for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        const cards = extractMlbdComCards(r.value.html, r.value.tp);
        for (const c of cards) {
          const k = c.title.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          all.push(c);
        }
      }
    }
    return setCached("mlbdcom:full-index", all, 600000);
  })().finally(() => {
    mlbdComFullIndexPromise = null;
  });

  return await mlbdComFullIndexPromise;
}

export function mapCategoryToMlbdComUrls(rawPath = "/") {
  const p = String(rawPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/new" || p === "/popular" || p.startsWith("/mostwatch") || p === "/top10" || p === "/recently-updated") {
    return ["/", "/movies", "/web-series"];
  }
  if (p === "/all" || p === "/collections") {
    return ["/", "/movies", "/web-series", ...DEFAULT_MLBD_COM_CONTENT_PATHS.filter(x => x !== "/" && x !== "/movies" && x !== "/web-series")];
  }
  if (p === "/type/movies") return ["/movies", "/", "/hindi-movies", "/south-indian-movies", "/action-movies", "/animation-movies", "/browse/english", "/browse/bangla", "/browse/hindi", "/browse/hindi-dubbed"];
  if (p === "/type/series" || p === "/drama" || p === "/ongoing") return ["/web-series", "/korean-drama", "/browse/genre-drama", "/browse/turkish", "/browse/bangla", "/browse/chinese"];
  if (p === "/southindian" || p.includes("south-indian")) return ["/south-indian-movies", "/browse/tamil", "/browse/telugu", "/browse/malayalam"];
  if (p === "/anime") return ["/animation-movies", "/browse/genre-animation", "/browse/japanese"];
  if (p === "/bollywood" || p === "/language/hindi") {
    return ["/hindi-movies", "/browse/hindi"];
  }
  if (p === "/indian-series") {
    return ["/web-series", "/hindi-movies", "/browse/hindi"];
  }
  if (p === "/language/hindi-dubbed" || p === "/language/hindi-dubbed-series" || p === "/collection/top-rated-hindi-dubbed-action") {
    return p.includes("action")
      ? ["/browse/hindi-dubbed", "/action-movies", "/browse/genre-action"]
      : ["/browse/hindi-dubbed", "/hindi-movies"];
  }
  if (p === "/language/korean" || p.includes("korean-drama")) return ["/korean-drama", "/browse/korean"];
  if (p === "/language/bangla-dubbed" || p.includes("bangla-dubbed")) return ["/browse/bangla-dubbed", "/browse/bangla"];
  if (p === "/language/bengali" || p === "/language/bangla" || p === "/bengali-series" || p.includes("bangla-web-series")) {
    return p.includes("series") ? ["/browse/bangla", "/web-series"] : ["/browse/bangla", "/browse/bangla-dubbed"];
  }
  if (p === "/language/japanese-drama" || p === "/language/japanese") return ["/browse/japanese", "/animation-movies"];
  if (p === "/language/english") return ["/browse/english", "/movies"];
  if (p === "/language/urdu") return ["/browse/hindi", "/browse/others"];
  if (p.includes("mcu") || p.includes("marvel") || p.includes("dc-universe") || p.includes("dceu")) return ["/browse/genre-superhero"];
  if (p === "/category/wwe") return ["/browse/genre-sports"];
  if (p === "/collection/horror-night" || p === "/genre/horror" || p.includes("horror")) return ["/browse/genre-horror"];
  if (p === "/collection/thriller-mystery" || p === "/genre/thriller" || p.includes("thriller")) return ["/browse/genre-thriller", "/browse/genre-mystery"];
  if (p === "/collection/family-animation" || p === "/genre/animation" || p.includes("animation")) return ["/animation-movies", "/browse/genre-animation", "/browse/genre-family"];
  if (p.startsWith("/language/")) {
    const slug = p.slice("/language/".length);
    return [`/browse/${slug}`];
  }
  if (p === "/genre/action") return ["/action-movies", "/browse/genre-action"];
  if (p.startsWith("/genre/")) {
    const slug = p.slice("/genre/".length).replace(/^sci-fi$/, "sci-fi");
    return [`/browse/genre-${slug}`];
  }
  return ["/", "/movies", "/web-series"];
}

function sortMlbdNewestFirst(items = []) {
  const arr = Array.isArray(items) ? items : [];
  const futureCutoff = Date.now() + 12 * 3600 * 1000;
  return arr
    .map((item, idx) => {
      const yr = Number(extractPlausibleYear(item?.title || "", item?.year || "", item?.path || "")) || 0;
      let bestUpload = 0;
      for (const raw of [item?.uploadedAtMs, item?.uploadTimestamp]) {
        const t = parseFlexibleDateMs(raw);
        if (t > 0 && t <= futureCutoff) bestUpload = Math.max(bestUpload, t);
      }
      if (bestUpload === 0 && !item?.fromArchive) {
        for (const raw of [item?.uploadTime, item?.updatedAt, item?.createdAt]) {
          const t = parseFlexibleDateMs(raw);
          if (t > 0 && t <= futureCutoff) bestUpload = Math.max(bestUpload, t);
        }
      }
      let bestRelease = 0;
      for (const raw of [item?.releaseDate, item?.appointmentDate, yr >= 1900 ? `${yr}-01-01` : ""]) {
        const t = parseFlexibleDateMs(raw);
        if (t > 0) {
          bestRelease = t;
          break;
        }
      }
      const isLiveUpdate = !item?.fromArchive;
      const ts = bestUpload > 0 ? bestUpload : bestRelease;
      const isFutureUnreleased = bestUpload === 0 && bestRelease > futureCutoff;
      return { item, idx, yr, bestUpload, ts, isLiveUpdate, isFutureUnreleased };
    })
    .sort((a, b) => {
      if (a.isFutureUnreleased !== b.isFutureUnreleased) return a.isFutureUnreleased ? 1 : -1;
      if (a.isFutureUnreleased && b.isFutureUnreleased) return a.ts - b.ts;
      if (b.ts !== a.ts) return b.ts - a.ts;
      if (b.isLiveUpdate !== a.isLiveUpdate) return b.isLiveUpdate ? 1 : -1;
      if (Boolean(b.bestUpload > 0) !== Boolean(a.bestUpload > 0)) return b.bestUpload > 0 ? 1 : -1;
      if (b.bestUpload !== a.bestUpload) return b.bestUpload - a.bestUpload;
      if (b.yr !== a.yr) return b.yr - a.yr;
      return a.idx - b.idx;
    })
    .map(x => x.item);
}

export function matchesMlbdCategoryItem(item, categoryPath = "/") {
  const p = String(categoryPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (Array.isArray(item?.categories) && item.categories.some(c => String(c || "").toLowerCase().replace(/\/+$/, "") === p)) {
    return true;
  }
  const title = String(item?.title || "");
  const hay = `${title} ${item?.language || ""} ${item?.typeBadge || ""} ${item?.genre || ""} ${item?.episodePill || ""} ${item?.path || ""}`.toLowerCase();
  if (p === "/" || p === "/all" || p === "/collections" || p === "/new" || p === "/popular" || p.startsWith("/mostwatch") || p === "/top10" || p === "/recently-updated" || p === "/top-rated") return true;
  if (p === "/adult18plus" || p === "/midnight" || p === "/genre/adult" || p === "/genre/erotic" || p === "/genre/hot") {
    return Boolean(item?.isAdult || /\b(?:adult|erotic|18\+|xxx|softcore|vivamax|midnight|uncut)\b/i.test(hay));
  }
  if (p === "/type/movies") return !item?.isSeries && !item?.isAnime;
  if (p === "/type/series") return Boolean(item?.isSeries);
  if (p === "/drama") return Boolean(item?.isSeries || /^\/drama\//i.test(String(item?.path || "")) || /\b(?:drama|k-?drama|c-?drama|j-?drama|turkish)\b/i.test(hay));
  if (p === "/ongoing") return Boolean(item?.isSeries) && (/ongoing|added|ep\s*\d+|s\d+/i.test(`${title} ${item?.episodePill || ""} ${item?.uploadTime || ""}`) || true);
  if (p === "/language/hindi-dubbed-series") return Boolean(item?.isSeries) && Boolean(item?.isHindiDubbed || /hindi|dual/i.test(hay));
  if (p === "/language/hindi-dubbed") return Boolean(item?.isHindiDubbed || /hindi\s*dub|dual\s*\[?hindi|\[hindi|in\s*hindi/i.test(hay));
  if (p === "/language/hindi" || p === "/bollywood") return Boolean(item?.isHindiDubbed || /hindi|dual|bollywood/i.test(hay));
  if (p === "/language/dual-audio") return /dual|multi\s*audio|\[hindi/i.test(hay);
  if (p === "/indian-series") {
    return Boolean(item?.isSeries) &&
      !item?.isAnime &&
      /\b(?:indian|bollywood|hindi\s*original|tamil|telugu|malayalam|bengali|marathi|punjabi|hotstar|sonyliv|zee5|jiocinema)\b/i.test(hay) &&
      !/\b(?:korean|k-?drama|turkish|chinese|c-?drama|japanese|anime)\b/i.test(hay);
  }
  if (p === "/language/korean" || p === "/collection/korean-drama-must-watch") {
    const isKorean = /\b(?:korean|k-?drama|korea)\b/i.test(hay);
    return p.includes("must-watch") ? Boolean(item?.isSeries) && isKorean : isKorean;
  }
  if (p === "/language/chinese") return /\b(?:chinese|china|c-?drama|mandarin|cantonese)\b/i.test(hay);
  if (p === "/language/japanese-drama") return Boolean(item?.isSeries) && /\b(?:japanese|japan|j-?drama)\b/i.test(hay);
  if (p === "/language/japanese") return /\b(?:japanese|japan|j-?drama|anime)\b/i.test(hay);
  if (p === "/language/turkish") return /\b(?:turkish|turkey|türkiye)\b/i.test(hay);
  if (p === "/language/bangla-dubbed" || p === "/collection/best-bangla-dubbed-movies") {
    return /bangla\s*dub/i.test(hay) && (p.includes("movies") ? !item?.isSeries : true);
  }
  if (p === "/bengali-series" || p === "/collection/bangla-web-series") {
    return Boolean(item?.isSeries) && /\b(?:bangla|bengali|bangladesh|hoichoi|chorki|bongo)\b/i.test(hay);
  }
  if (p === "/language/bangla" || p === "/language/bengali") return /\b(?:bangla|bengali)\b/i.test(hay);
  if (p === "/collection/top-rated-hindi-dubbed-action") {
    return Boolean(item?.isHindiDubbed || /hindi|dual/i.test(hay)) && /\baction\b/i.test(hay);
  }
  if (p === "/southindian" || p.includes("south-indian")) return /south\s*indian|tamil|telugu|malayalam|kannada/i.test(hay);
  if (p === "/collection/family-animation" || p === "/anime" || p.includes("animation")) {
    return Boolean(item?.isAnime || /^\/anime\//i.test(String(item?.path || "")) || /\b(?:anime|animation|animated|family|pixar|disney|dreamworks|toy\s*story)\b/i.test(hay));
  }
  if (p.includes("mcu") || p.includes("marvel")) return /\b(?:marvel|avengers|iron\s*man|captain\s*america|thor|spider-?man|guardians\s*of\s*the\s*galaxy|ant-?man|doctor\s*strange|black\s*panther|deadpool|wolverine|shang-?chi|eternals|thunderbolts|fantastic\s*four|x-?men|loki|wandavision|moon\s*knight|hawkeye|she-?hulk|ms\.?\s*marvel|what\s*if|daredevil|echo|agatha|venom|captain\s*marvel|black\s*widow)\b/i.test(hay);
  if (p.includes("dc-universe") || p.includes("dceu")) return /\b(?:dc\b|batman|superman|wonder\s*woman|aquaman|the\s*flash|joker|justice\s*league|suicide\s*squad|shazam|black\s*adam|blue\s*beetle|peacemaker|the\s*penguin|creature\s*commandos|harley\s*quinn|green\s*lantern|man\s*of\s*steel)\b/i.test(hay);
  if (p === "/category/wwe") return /\b(?:wwe|wrestlemania|monday\s*night\s*raw|smackdown|summerslam|royal\s*rumble|nxt|survivor\s*series|elimination\s*chamber)\b/i.test(hay);
  if (p === "/genre/action") return /\baction\b/i.test(hay);
  if (p === "/genre/sci-fi") return /\b(?:sci-?fi|science\s*fiction)\b/i.test(hay);
  if (p === "/genre/biographical") return /\b(?:biograph|biopic)\b/i.test(hay);
  if (p === "/genre/historical") return /\b(?:historic|history|period)\b/i.test(hay);
  if (p === "/genre/sports") return /\b(?:sport|wwe|football|soccer|cricket|fifa|boxing|ufc)\b/i.test(hay);
  if (p === "/collection/horror-night" || p === "/genre/horror") {
    return /\b(?:horror|ghost|bhoot|conjuring|exorcist|haunted|demon|witch|zombie|evil\s*dead)\b/i.test(hay);
  }
  if (p === "/collection/thriller-mystery" || p === "/genre/thriller") {
    return /\b(?:thriller|horror|mystery|suspense|crime|detective)\b/i.test(hay);
  }
  if (p === "/language/english") return /\b(?:english|hollywood|usa)\b/i.test(hay);
  if (p === "/language/gujrati" || p === "/language/gujarati") return /\bguj(?:a|u)?rati\b/i.test(hay);
  if (p.startsWith("/language/")) {
    const slug = p.slice("/language/".length).replace(/-/g, " ");
    return hay.includes(slug);
  }
  if (p.startsWith("/genre/")) {
    const slug = p.slice("/genre/".length).replace(/-/g, " ");
    return hay.includes(slug);
  }
  if (p.startsWith("/category/") || p.startsWith("/collection/")) {
    const stopWords = new Set(["best", "top", "rated", "must", "watch", "night", "movies", "movie", "series", "web", "blockbusters", "hits", "collection", "all", "new", "the", "and", "for"]);
    const slugWords = p
      .replace(/^\/(?:category|collection)\//, "")
      .split(/[-_]+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));
    if (!slugWords.length) return false;
    return slugWords.every(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay));
  }
  return false;
}

async function getMlbdComCatalog({ path = "/", q = "", page = 1 } = {}) {
  await ensureMlbdArchiveLoaded();
  const pageNum = Math.max(1, Number(page) || 1);
  const cleanQ = String(q || "").trim();
  const normCat = String(path || "/").toLowerCase().replace(/\/+$/, "") || "/";
  const isTrendingFallback = normCat === "/mostwatch/7d" || normCat === "/mostwatch" || normCat === "/popular";
  const sortMode = normCat === "/top-rated" ? "rating" : (isTrendingFallback || normCat === "/top10") ? "popular" : "latest";
  const archiveRes = queryMlbdArchive({
    q: cleanQ,
    category: normCat,
    includeAdult: Boolean(cleanQ || normCat === "/adult18plus" || normCat === "/midnight" || normCat.startsWith("/genre/adult") || normCat.startsWith("/genre/erotic") || normCat.startsWith("/genre/hot")),
    sort: sortMode,
    offset: 0,
    limit: 2000
  });

  let liveItems = [];
  if (cleanQ) {
    const fullIndex = await getMlbdComFullIndex().catch(() => []);
    const qVariants = expandSearchQueryVariants(cleanQ);
    const allowMusic = /\b(?:song|songs|music|ost|pop|lyric|lyrical|remix|album|naat|bhajan|track|audio)\b/i.test(cleanQ);
    const scored = [];
    for (const it of fullIndex) {
      if (!it || isNigerianContent(it)) continue;
      if (!allowMusic && isMusicOrClipSubject(it)) continue;
      const sc = Math.max(...qVariants.map(qv => scoreSearchMatch(it, qv, { allowBroadMatch: false })));
      if (sc > 0) scored.push({ it, sc });
    }
    scored.sort((a, b) =>
      b.sc - a.sc ||
      (b.it.mbSubjectId ? 1 : 0) - (a.it.mbSubjectId ? 1 : 0) ||
      (b.it.poster ? 1 : 0) - (a.it.poster ? 1 : 0) ||
      Number(b.it.year || 0) - Number(a.it.year || 0)
    );
    liveItems = scored.map(x => x.it);
  } else if (!isTrendingFallback) {
    const targetPages = pageNum === 1 ? mapCategoryToMlbdComUrls(path).slice(0, 3) : [];
    if (targetPages.length) {
      const settled = await Promise.allSettled(
        targetPages.map(async tp => ({ tp, html: await fetchMlbdComPage(tp) }))
      );
      for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        const cards = extractMlbdComCards(r.value.html, r.value.tp);
        for (const c of cards) {
          if (!isNigerianContent(c) && (matchesMlbdCategoryItem(c, path) || ["/", "/new", "/top10", "/recently-updated"].includes(normCat))) {
            liveItems.push(c);
          }
        }
      }
    }
  }

  const seenMap = new Map();
  const seenKeyByTitle = new Map();
  const merged = [];
  const pushUnique = it => {
    if (!it || isNigerianContent(it)) return;
    const k = normalizePosterKey(it.searchTitle || it.title) + "|" + (it.year || "");
    const pKey = it.path || k;
    const existing = seenMap.get(pKey) || (k !== "|" ? seenKeyByTitle.get(k) : null);
    if (existing) {
      if (!existing.poster && it.poster) {
        existing.poster = it.poster;
        existing.rawPoster = it.rawPoster || existing.rawPoster;
      }
      if (!existing.mbSubjectId && it.mbSubjectId) {
        existing.mbSubjectId = it.mbSubjectId;
        existing.mbDetailPath = it.mbDetailPath || existing.mbDetailPath;
      }
      if (!existing.rating && it.rating) existing.rating = it.rating;
      return;
    }
    seenMap.set(pKey, it);
    if (k !== "|") seenKeyByTitle.set(k, it);
    merged.push(it);
  };

  if (cleanQ || isTrendingFallback) {
    for (const it of archiveRes.items) pushUnique(it);
    for (const it of liveItems) pushUnique(it);
  } else {
    for (const it of liveItems) pushUnique(it);
    for (const it of archiveRes.items) pushUnique(it);
  }

  const orderedMerged = (!cleanQ && sortMode === "latest") ? sortMlbdNewestFirst(merged) : merged;
  const perPage = 30;
  const totalCount = Math.max(orderedMerged.length, archiveRes.total || 0);
  const startIdx = (pageNum - 1) * perPage;
  const slice = orderedMerged.slice(startIdx, startIdx + perPage);
  if (slice.some(x => !x.poster || !x.mbSubjectId)) {
    await enrichMlbdItemsWithPosters(slice, 18, 6);
  }
  const maxPage = Math.max(1, Math.ceil(totalCount / perPage));
  const archiveCount = slice.filter(x => x?.fromArchive === true).length;
  const liveCount = slice.length - archiveCount;

  return {
    ok: true,
    source: "movielinkbd",
    activeMirror: "https://movielinkbd.com",
    path,
    upstreamPath: cleanQ ? "/search" : (isTrendingFallback ? "/mostwatch/7d" : mapCategoryToMlbdComUrls(path)[0] || "/"),
    heading: cleanQ ? `Search: ${cleanQ}` : (isTrendingFallback ? "Trending Now (Archive Fallback)" : "All Movies & Series"),
    contentSource: liveCount > 0 && archiveCount > 0 ? "portal+archive" : archiveCount > 0 ? "archive" : "portal",
    isArchiveFallback: archiveCount > 0 || isTrendingFallback,
    liveCount,
    archiveCount,
    items: slice,
    page: pageNum,
    maxPage,
    totalPages: maxPage,
    totalCount,
    hasMore: pageNum < maxPage
  };
}

async function getMlbdComHomeFeed() {
  await ensureMlbdArchiveLoaded();
  const specs = [
    { id: "mlbd-latest", title: "🆕 Latest Releases", path: "/", categoryPath: "/new" },
    { id: "mlbd-movies", title: "🎬 Latest Movies", path: "/movies", categoryPath: "/type/movies" },
    { id: "mlbd-series", title: "📺 Web Series", path: "/web-series", categoryPath: "/type/series" },
    { id: "mlbd-hindi", title: "🇮🇳 Hindi & Dubbed", path: "/hindi-movies", categoryPath: "/language/hindi" },
    { id: "mlbd-hindi-dubbed", title: "🎙️ Hindi Dubbed Archive", path: "/browse/hindi-dubbed", categoryPath: "/language/hindi-dubbed" },
    { id: "mlbd-south", title: "💫 South Indian", path: "/south-indian-movies", categoryPath: "/southIndian" },
    { id: "mlbd-kdrama", title: "🇰🇷 Korean Drama", path: "/korean-drama", categoryPath: "/language/korean" },
    { id: "mlbd-anime", title: "🍥 Anime & Animation", path: "/animation-movies", categoryPath: "/anime" },
    { id: "mlbd-action", title: "💥 Action Hits", path: "/action-movies", categoryPath: "/genre/action" },
    { id: "mlbd-bangla", title: "🇧🇩 Bangla & Dubbed", path: "/browse/bangla", categoryPath: "/language/bangla" },
    { id: "mlbd-bangla-dubbed", title: "🎙️ Bangla Dubbed", path: "/browse/bangla-dubbed", categoryPath: "/language/bangla-dubbed" },
    { id: "mlbd-turkish", title: "🇹🇷 Turkish Drama", path: "/browse/turkish", categoryPath: "/language/turkish" },
    { id: "mlbd-thriller", title: "🔪 Thriller & Horror", path: "/browse/genre-thriller", categoryPath: "/genre/thriller" }
  ];

  // Fetch live portal pages best-effort alongside instant 10,916-title archive
  const livePaths = [...new Set(specs.map(s => s.path))];
  const htmlResults = await Promise.allSettled(
    livePaths.map(async p => ({ path: p, html: await fetchMlbdComPage(p) }))
  );

  const rawByPath = new Map();
  for (const r of htmlResults) {
    if (r.status !== "fulfilled") continue;
    rawByPath.set(r.value.path, extractMlbdComCards(r.value.html, r.value.path));
  }

  const parsedSections = [];
  for (const spec of specs) {
    const archiveItems = queryMlbdArchive({
      category: spec.categoryPath,
      includeAdult: false,
      sort: "latest",
      offset: 0,
      limit: 40
    }).items;
    const liveCards = (rawByPath.get(spec.path) || []).filter(c =>
      spec.id === "mlbd-latest" || matchesMlbdCategoryItem(c, spec.categoryPath)
    );
    const mergedMap = new Map();
    for (const c of [...liveCards, ...archiveItems]) {
      if (!c?.title || isNigerianContent(c)) continue;
      const k = normalizePosterKey(c.searchTitle || c.title) || c.title.toLowerCase();
      const existing = mergedMap.get(k);
      if (!existing) {
        mergedMap.set(k, c);
      } else {
        if (!existing.poster && c.poster) {
          existing.poster = c.poster;
          existing.rawPoster = c.rawPoster || existing.rawPoster;
        }
        if (!existing.mbSubjectId && c.mbSubjectId) {
          existing.mbSubjectId = c.mbSubjectId;
          existing.mbDetailPath = c.mbDetailPath || existing.mbDetailPath;
        }
        if (!existing.rating && c.rating) existing.rating = c.rating;
      }
    }
    const sorted = sortMlbdNewestFirst([...mergedMap.values()]);
    if (sorted.length) {
      parsedSections.push({ ...spec, sorted });
    }
  }

  await Promise.allSettled(
    parsedSections.map(async s => {
      const head = s.sorted.slice(0, 14);
      if (head.some(it => !it.poster || !it.mbSubjectId)) {
        await enrichMlbdItemsWithPosters(head, 10, 6);
      }
      const postered = s.sorted.filter(c => Boolean(c?.poster));
      s.items = (postered.length >= 6 ? postered : s.sorted).slice(0, 36);
    })
  );

  const sections = parsedSections.map(s => ({
    id: s.id,
    title: s.title,
    categoryPath: s.categoryPath,
    items: s.items,
    source: "movielinkbd"
  }));

  const allItems = sections.flatMap(s => s.items);
  const deduped = sortMlbdNewestFirst([...new Map(allItems.map(it => [it.path || it.title.toLowerCase(), it])).values()]);
  const banners = deduped.filter(it => it.poster).slice(0, 10);
  const trending = deduped.slice(0, 32);

  return {
    ok: true,
    source: "movielinkbd",
    activeMirror: "https://movielinkbd.com",
    sections,
    trending,
    banners,
    categories: DEFAULT_FALLBACK_CATEGORIES.map(c => ({ ...c, source: "movielinkbd" })),
    totalItems: mlbdArchiveRecords.length || deduped.length
  };
}

export async function getMlbdCategories() {
  const cached = getCached("categories");
  if (cached) return cached;

  let categories = DEFAULT_FALLBACK_CATEGORIES.map(c => ({ ...c, source: "movielinkbd" }));
  let activeMirror = activeResolvedOrigin;
  try {
    const page = await mlbdFetchPage("/", { ttlMs: 180000 });
    activeMirror = page.origin;
    const parsed = extractCategoriesFromHtml(page.html);
    if (parsed.length) categories = parsed;
  } catch {
    activeMirror = "https://movielinkbd.com";
  }

  const servers = MLBD_MIRRORS.map(m => ({
    ...m,
    active: activeMirror === m.baseUrl || (m.id === "portal" && activeMirror.includes("movielinkbd.com"))
  }));

  return setCached(
    "categories",
    {
      ok: true,
      source: "movielinkbd",
      activeMirror,
      servers,
      categories
    },
    180000
  );
}

export async function getMlbdHomeFeed() {
  await ensureMlbdArchiveLoaded();
  const cached = getCached("home-feed");
  if (cached) return cached;

  try {
    const page = await mlbdFetchPage("/", { ttlMs: 120000 });
    let sections = extractHomeSections(page.html, page.origin);
    const categories = extractCategoriesFromHtml(page.html);

    if (sections.length <= 1) {
      const extraShelves = [
        { id: "mlbd-new", title: "🆕 NEW & POPULAR", path: "/new" },
        { id: "mlbd-movies", title: "🎬 MOVIES", path: "/type/movies" },
        { id: "mlbd-series", title: "📺 SERIES & TV SHOWS", path: "/type/series" },
        { id: "mlbd-south", title: "💫 SOUTH INDIAN", path: "/southIndian/" },
        { id: "mlbd-anime", title: "🍥 ANIME ZONE", path: "/anime/" },
        { id: "mlbd-anim", title: "🎨 ANIMATION", path: "/genre/animation/" }
      ];
      const settled = await Promise.allSettled(
        extraShelves.map(s => getMlbdCatalog({ path: s.path, page: 1 }))
      );
      const built = [];
      for (let i = 0; i < extraShelves.length; i++) {
        const res = settled[i];
        if (res.status === "fulfilled" && Array.isArray(res.value?.items) && res.value.items.length) {
          built.push({
            id: extraShelves[i].id,
            title: extraShelves[i].title,
            categoryPath: extraShelves[i].path.replace(/\/+$/, "") || "/new",
            items: res.value.items.slice(0, 24),
            source: "movielinkbd"
          });
        }
      }
      if (built.length) sections = built;
    }

    const top10Sec = sections.find(s => /top\s*10/i.test(s.title));
    const mostWatchSec = sections.find(s => s !== top10Sec && /^\/mostwatch/i.test(String(s?.categoryPath || "")));
    let trending = Array.isArray(mostWatchSec?.items) ? mostWatchSec.items.filter(x => x && x.fromArchive !== true) : [];
    if (trending.length < 10) {
      const liveTrendingCat = await getMlbdCatalog({ path: "/mostwatch/7d", page: 1 }).catch(() => null);
      if (liveTrendingCat && !liveTrendingCat.isArchiveFallback && Array.isArray(liveTrendingCat.items) && liveTrendingCat.items.length) {
        trending = liveTrendingCat.items.filter(x => x && x.fromArchive !== true);
      }
    }
    const allItems = sections.flatMap(s => s.items);
    const deduped = [...new Map(allItems.map(it => [it.path, it])).values()];
    if (!trending.length) {
      const trendingSec = sections.find(s => s !== top10Sec && /popular|most\s*watch/i.test(s.title)) || top10Sec || sections[0];
      trending = (trendingSec?.items || []).filter(x => x && x.fromArchive !== true);
    }
    const banners = deduped.filter(it => it.poster).slice(0, 10);

    return setCached(
      "home-feed",
      {
        ok: true,
        source: "movielinkbd",
        activeMirror: page.origin,
        sections,
        trending,
        banners,
        categories,
        totalItems: Math.max(deduped.length, mlbdArchiveRecords.length)
      },
      120000
    );
  } catch (err) {
    if (isTemporaryOrRateLimitError(err)) {
      const stale = getStaleCached("home-feed");
      if (stale) return stale;
    } else if (isAuthOrForbiddenError(err)) {
      deleteStaleCached("home-feed");
    }

    if (isCinePulseConfigured()) {
      const cp = await fetchCinePulseApi("home", { source: "movielinkbd", lang: "en" }, { timeoutMs: 12000 });
      const rawCp = cp.data?.separated && cp.data?.movielinkbd ? cp.data.movielinkbd : cp.data;
      if (cp.ok && rawCp) {
        const norm = normalizeCinePulsePayload("home", rawCp);
        let sections = (norm.mlbdSections?.length ? norm.mlbdSections : (norm.sections || [])).filter(s => Array.isArray(s?.items) && s.items.length > 0);
        if (!sections.length) {
          const fallbackGroups = [
            { id: "mlbd-latest", title: "🆕 Latest Releases", categoryPath: "/new", items: rawCp.latestUploads },
            { id: "mlbd-bangla", title: "🇧🇩 Bangla & Dubbed", categoryPath: "/language/bangla", items: rawCp.bangla },
            { id: "mlbd-bollywood", title: "🇮🇳 Hindi & Dubbed", categoryPath: "/language/hindi", items: rawCp.bollywood },
            { id: "mlbd-south", title: "💫 South Indian", categoryPath: "/southIndian", items: rawCp.south }
          ]
            .map(g => ({ ...g, items: normalizeCinePulsePayload("home", { items: g.items }).items || [] }))
            .filter(g => g.items.length > 0);
          sections = fallbackGroups;
        }
        if (sections.length || norm.trending?.length) {
          mlbdCinePulseHasContent = true;
          return setCached("home-feed", {
            ok: true,
            source: "movielinkbd",
            activeMirror: rawCp.activeMirror || "CinePulse Gateway",
            sections,
            trending: norm.trending || sections.flatMap(s => s.items || []).slice(0, 28),
            banners: norm.banners || [],
            categories: norm.categories?.length ? norm.categories : DEFAULT_FALLBACK_CATEGORIES.map(c => ({ ...c, source: "movielinkbd" }))
          }, 120000);
        }
      }
    }
    const portalFeed = await getMlbdComHomeFeed();
    return setCached("home-feed", portalFeed, 120000);
  }
}

export function isMlbdTrendingPath(rawPath = "/") {
  const norm = normalizeUpstreamPath(rawPath)
    .toLowerCase()
    .replace(/\/page\/\d+\/?$/i, "")
    .replace(/\/+$/, "") || "/";
  return norm === "/mostwatch/7d" || norm === "/mostwatch" || norm === "/popular";
}

export function resolveMlbdUpstreamCatalogPath({ path = "/", q = "", page = 1 } = {}) {
  const pageNum = Math.max(1, Math.min(400, Number(page) || 1));
  const cleanQuery = String(q || "").trim();
  const basePath = normalizeUpstreamPath(path);

  if (cleanQuery || basePath === "/search" || basePath.startsWith("/search?")) {
    const searchTerm = cleanQuery || new URL("https://x.test" + basePath).searchParams.get("q") || "";
    return pageNum > 1
      ? `/search/page/${pageNum}/?q=${encodeURIComponent(searchTerm)}`
      : `/search/?q=${encodeURIComponent(searchTerm)}`;
  }
  if (isMlbdTrendingPath(basePath)) {
    return pageNum > 1 ? `/mostwatch/7d/page/${pageNum}/` : "/mostwatch/7d";
  }
  if (basePath === "/" || basePath === "/new" || basePath === "/all") {
    return pageNum > 1 ? `/new/page/${pageNum}/` : "/new";
  }
  const cleanBase = basePath.replace(/\/page\/\d+\/?$/i, "").replace(/\/+$/, "") || "/";
  return pageNum > 1 ? `${cleanBase}/page/${pageNum}/` : `${cleanBase}/`;
}

export function orderMlbdTrendingItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, idx) => ({
      item,
      idx,
      views: Number(item?.views) || parseViewsCount(item?.viewsText || "")
    }))
    .sort((a, b) => (b.views - a.views) || (a.idx - b.idx))
    .map(x => x.item);
}

export async function getMlbdCatalog({ path = "/", q = "", page = 1 } = {}) {
  await ensureMlbdArchiveLoaded();
  const pageNum = Math.max(1, Math.min(400, Number(page) || 1));
  const cleanQuery = String(q || "").trim();
  const basePath = normalizeUpstreamPath(path);
  const isTrendingRoute = !cleanQuery && isMlbdTrendingPath(basePath);
  const normBase = basePath.toLowerCase().replace(/\/page\/\d+\/?$/i, "").replace(/\/+$/, "") || "/";
  const preserveRankingOrder = !cleanQuery && (isTrendingRoute || normBase === "/top10" || normBase === "/top-rated");
  const upstreamPath = resolveMlbdUpstreamCatalogPath({ path: basePath, q: cleanQuery, page: pageNum });

  const cacheKey = `catalog:${upstreamPath}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const pageData = await mlbdFetchPage(upstreamPath, { ttlMs: 90000 });
    const rawLiveItems = extractCardsFromHtml(pageData.html, pageData.origin)
      .filter(item => item && item.fromArchive !== true);

    if (isTrendingRoute && rawLiveItems.length === 0) {
      throw new Error("Live /mostwatch/7d returned zero trending items");
    }

    const items = isTrendingRoute
      ? orderMlbdTrendingItems(rawLiveItems)
      : preserveRankingOrder
        ? rawLiveItems
        : sortMlbdNewestFirst(rawLiveItems);

    const pagination = extractPagination(pageData.html, pageNum);
    const titleMatch = pageData.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

    let finalItems = items;
    let archiveSupplementItems = [];
    // Keep live trending strictly separate from archive fallback; only supplement sparse non-trending category pages
    if (!isTrendingRoute && finalItems.length < 10 && pageNum === 1) {
      const archExtra = queryMlbdArchive({ q: cleanQuery, category: basePath, includeAdult: true, limit: 30 }).items;
      const seen = new Set(finalItems.map(x => x.path));
      archiveSupplementItems = archExtra.filter(x => x && !seen.has(x.path));
      finalItems = [...finalItems, ...archiveSupplementItems].slice(0, 30);
    }

    const archiveCount = finalItems.filter(x => x?.fromArchive === true).length;
    const liveCount = finalItems.length - archiveCount;

    return setCached(
      cacheKey,
      {
        ok: true,
        source: "movielinkbd",
        activeMirror: pageData.origin,
        path: isTrendingRoute ? "/mostwatch/7d" : basePath,
        upstreamPath,
        heading: titleMatch ? stripSiteBrandFromLabel(stripTags(titleMatch[1])) : (isTrendingRoute ? "Trending Now" : ""),
        contentSource: archiveCount > 0 ? "live+archive" : "live",
        isArchiveFallback: false,
        liveCount,
        archiveCount,
        items: finalItems,
        ...pagination
      },
      90000
    );
  } catch (err) {
    if (isTemporaryOrRateLimitError(err)) {
      const stale = getStaleCached(cacheKey);
      if (stale) return stale;
    } else if (isAuthOrForbiddenError(err)) {
      deleteStaleCached(cacheKey);
    }

    if (isCinePulseConfigured()) {
      const cpRoute = cleanQuery ? "search" : "catalog";
      const cpParams = cleanQuery
        ? { q: cleanQuery, page: String(pageNum), source: "movielinkbd" }
        : { category: isTrendingRoute ? "/mostwatch/7d" : basePath, page: String(pageNum), source: "movielinkbd" };
      const cp = await fetchCinePulseApi(cpRoute, cpParams, { timeoutMs: 12000 });
      const rawCp = cp.data?.separated && cp.data?.movielinkbd ? cp.data.movielinkbd : cp.data;
      if (cp.ok && Array.isArray(rawCp?.items) && rawCp.items.length > 0) {
        mlbdCinePulseHasContent = true;
        const norm = normalizeCinePulsePayload(cpRoute, rawCp);
        const cpItems = (norm.items || []).map(it => ({ ...it, fromArchive: false }));
        return setCached(cacheKey, {
          ...norm,
          ok: true,
          source: "movielinkbd",
          activeMirror: rawCp.activeMirror || "CinePulse Gateway",
          path: isTrendingRoute ? "/mostwatch/7d" : basePath,
          upstreamPath,
          contentSource: "cinepulse-live",
          isArchiveFallback: false,
          liveCount: cpItems.length,
          archiveCount: 0,
          items: cpItems,
          page: pageNum
        }, 90000);
      }
    }
    const portalCat = await getMlbdComCatalog({ path: isTrendingRoute ? "/mostwatch/7d" : basePath, q: cleanQuery, page: pageNum });
    return setCached(cacheKey, portalCat, 90000);
  }
}

export async function getMlbdSuggest(rawQuery) {
  await ensureMlbdArchiveLoaded();
  const q = String(rawQuery || "").trim();
  if (!q) return { ok: true, query: "", items: [], suggestions: [] };

  const archiveRes = queryMlbdArchive({ q, includeAdult: true, sort: "popular", offset: 0, limit: 24 });
  const cat = await Promise.race([
    getMlbdCatalog({ path: "/search", q, page: 1 }).catch(() => ({ items: [] })),
    new Promise(r => setTimeout(() => r({ items: [] }), mlbdDirectMirrorsBlocked ? 3500 : 6000))
  ]);
  const seen = new Set();
  const items = [];
  for (const it of [...sortMlbdNewestFirst(cat.items || []), ...(archiveRes.items || [])]) {
    if (!it || isNigerianContent(it)) continue;
    const key = it.path || it.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
    if (items.length >= 24) break;
  }
  const suggestions = collectTitleSuggestions(q, { items, limit: 12 });
  return {
    ok: true,
    source: "movielinkbd",
    query: q,
    items,
    suggestions
  };
}

async function lookupExternalTitleMetadata(searchTitle, year = "") {
  const q = String(searchTitle || "").trim();
  if (!q) return {};
  const firstMatch = q.toLowerCase().match(/[a-z0-9]/);
  const imdbTask = firstMatch
    ? fetch(`https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstMatch[0])}/${encodeURIComponent(q.toLowerCase())}.json`, {
        headers: { "User-Agent": MOVIEBOX_UA },
        signal: AbortSignal.timeout(4500)
      })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          const list = Array.isArray(data?.d) ? data.d : [];
          const best = list
            .map(entry => {
              const sim = titleSimilarityScore(q, entry?.l || "", { queryYear: year, candidateYear: entry?.y || "" });
              const yrMatch = year && entry?.y && String(entry.y) === String(year);
              return { entry, sim, yrMatch, score: sim * 10 + (yrMatch ? 4 : 0) };
            })
            .filter(x => x.sim >= (x.yrMatch ? 0.58 : 0.68))
            .sort((a, b) => b.score - a.score)[0]?.entry;
          if (!best) return null;
          const img = best.i?.imageUrl
            ? mlbdProxyImageUrl(String(best.i.imageUrl).replace(/\._V1_[^.]*\.jpg$/i, "._V1_QL80_UX420_.jpg"))
            : "";
          const stars = String(best.s || "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 6)
            .map((name, idx) => ({ staffId: `imdb-${idx}`, name, role: "Cast" }));
          return {
            title: best.l || "",
            year: best.y ? String(best.y) : "",
            poster: img,
            staff: stars,
            qid: best.qid || ""
          };
        })
        .catch(() => null)
    : Promise.resolve(null);

  const wikiTask = fetch(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${q} ${year || ""} film`.trim())}&gsrlimit=3&prop=extracts|pageimages&exintro=1&explaintext=1&pithumbsize=420&format=json`,
    { headers: { "User-Agent": "MovieStreamBD/1.0" }, signal: AbortSignal.timeout(3500) }
  )
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      const pages = Object.values(data?.query?.pages || {});
      const best = pages.find(p => {
        const cleanPageTitle = String(p?.title || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
        const extract = String(p?.extract || "");
        if (/may refer to:/i.test(extract)) return false;
        const sim = titleSimilarityScore(q, cleanPageTitle, { queryYear: year });
        if (sim < 0.68) return false;
        if (year) {
          const leadYr = extract.slice(0, 260).match(/\b(19\d\d|20\d\d)\b/)?.[1];
          if (leadYr && Math.abs(Number(leadYr) - Number(year)) >= 2) return false;
        }
        return true;
      });
      if (!best) return null;
      return {
        description: String(best.extract || "").trim().slice(0, 600),
        poster: best.thumbnail?.source ? mlbdProxyImageUrl(best.thumbnail.source) : ""
      };
    })
    .catch(() => null);

  const ytTask = fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} ${year || ""} official trailer`.trim())}`,
    { headers: { "User-Agent": MOVIEBOX_UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(3800) }
  )
    .then(r => (r.ok ? r.text() : ""))
    .then(html => {
      const m = [...html.matchAll(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,600}?"text":"([^"]+)"/g)]
        .slice(0, 6)
        .find(x => {
          const rawYtTitle = decodeJsonEscapedText(x[2]);
          const candYear = rawYtTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "";
          return titleSimilarityScore(q, cleanYoutubeTrailerTitle(rawYtTitle), { queryYear: year, candidateYear: candYear }) >= 0.65;
        });
      const vid = m?.[1] || "";
      return vid ? { trailerYoutubeId: vid, poster: mlbdProxyImageUrl(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`) } : null;
    })
    .catch(() => null);

  const [imdb, wiki, yt] = await Promise.all([imdbTask, wikiTask, ytTask]);
  return {
    poster: imdb?.poster || wiki?.poster || yt?.poster || "",
    year: imdb?.year || year || "",
    description: wiki?.description || "",
    staff: imdb?.staff || [],
    trailerYoutubeId: yt?.trailerYoutubeId || ""
  };
}

async function resolveMlbdTitleViaMovieBox(rawPath, hintTitle = "", extraQuery = {}) {
  const cleanPath = String(rawPath || "").trim();
  const regItem = mlbdItemRegistry.get(cleanPath) || mlbdItemRegistry.get(normalizeUpstreamPath(cleanPath));
  const rawSlugTitle = cleanPath
    .replace(/^\/(?:mlbd\/)?(?:movie|series|drama|anime)\//i, "")
    .replace(/\/+$/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(?:19|20)\d{2}(?:\s+\d+)?$/, "")
    .trim();
  const rawSeed = hintTitle || regItem?.searchTitle || regItem?.title || rawSlugTitle;
  const searchVariants = splitSearchTitleVariants(rawSeed);
  const primarySearch = cleanMlbdSearchTitle(rawSeed) || searchVariants[0] || "";
  if (!primarySearch && !searchVariants.length) {
    return { params: null, regItem, searchName: "" };
  }

  let targetSubjectId = "";
  let targetDetailPath = "";
  const targetYear = String(
    regItem?.year ||
    String(hintTitle || "").match(/\((19\d\d|20\d\d)\)/)?.[1] ||
    cleanPath.match(/-(19\d\d|20\d\d)(?:$|[-/\b])/)?.[1] ||
    ""
  );

  if (regItem?.mbSubjectId) {
    targetSubjectId = regItem.mbSubjectId;
    targetDetailPath = regItem.mbDetailPath || "";
  }

  if (!targetSubjectId) {
    const expandedVariants = [...new Set([...searchVariants, ...expandSearchQueryVariants(rawSeed)])];
    const queriesToTry = expandedVariants.length ? expandedVariants.slice(0, 4) : [primarySearch];
    const searchResults = await Promise.allSettled(
      queriesToTry.map(q => handleMovieBoxRoute("search", new URLSearchParams({ q, page: "1" })))
    );
    const candidateMap = new Map();
    for (const sr of searchResults) {
      if (sr.status !== "fulfilled" || !Array.isArray(sr.value?.items)) continue;
      for (const c of sr.value.items) {
        if (!c || isNigerianContent(c) || isMusicOrClipSubject(c)) continue;
        const k = c.subjectId || c.path;
        if (k && !candidateMap.has(k)) candidateMap.set(k, c);
      }
    }
    const candidates = [...candidateMap.values()];
    const wantSeries = Boolean(
      regItem?.isSeries ||
      /^\/(?:mlbd\/)?(?:series|drama|anime)\//i.test(cleanPath) ||
      /\b(?:S\d{1,2}|Season\s*\d+|Ep(?:isode)?s?\s*\d+)\b/i.test(rawSeed)
    );
    const scored = candidates
      .map(c => {
        const bestSim = Math.max(...queriesToTry.map(qv => titleSimilarityScore(qv, c?.title || "", { queryYear: targetYear, candidateYear: c?.year || "", isSeries: wantSeries })));
        const sameFmt = Boolean(c?.isSeries) === Boolean(wantSeries);
        const typeBonus = sameFmt ? 0.12 : -0.10;
        const yrBonus = targetYear && String(c?.year || "") === targetYear ? 0.16 : 0;
        const resBonus = c?.hasResource !== false ? 0.08 : 0;
        return { c, sim: bestSim, sameFmt, total: bestSim + typeBonus + yrBonus + resBonus };
      })
      .filter(x => x.sim >= 0.72 && (x.sameFmt || x.sim >= 0.88))
      .sort((a, b) => b.total - a.total);
    const best = scored[0]?.c;
    if (best) {
      targetSubjectId = best.subjectId || "";
      targetDetailPath = best.detailPath || "";
    }
  }

  const matchedName = searchVariants[0] || primarySearch;
  if (!targetSubjectId && !targetDetailPath) {
    return { params: null, regItem, searchName: matchedName };
  }

  const params = new URLSearchParams({
    title: matchedName,
    ...(targetSubjectId ? { subjectId: targetSubjectId } : {}),
    ...(targetDetailPath ? { detailPath: targetDetailPath } : {}),
    ...extraQuery
  });
  return { params, regItem, searchName: matchedName };
}

async function fetchPlayerFrameData(frameSrc, page) {
  if (!frameSrc) return { pd2: null, inlineData: null };
  const pUrl = new URL(frameSrc, page.origin);
  const candidateOrigins = [...new Set([
    page.origin,
    activeResolvedOrigin,
    ...MLBD_MIRRORS.filter(m => /\.movielinkbd\.(?:de|one|tv|shop)$/i.test(m.baseUrl)).map(m => m.baseUrl)
  ])].filter(Boolean);

  for (const origin of candidateOrigins) {
    try {
      const pHeaders = {
        Referer: origin === page.origin ? page.finalUrl : `${origin}/`,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin"
      };
      if (origin === page.origin && page.cookies) pHeaders.Cookie = page.cookies;
      const pPage = await fetchMirrorOnce(origin, pUrl.pathname + pUrl.search, pHeaders, 12000);
      if (pPage.res.ok && pPage.text) {
        const fetchedPd2 = extractBalancedJson(pPage.text, /window\.__PD2\s*=\s*/i);
        const fetchedInline = extractBalancedJson(pPage.text, /(?:var|let|const|window\.)\s*mlbdInlinePlayerData\s*=\s*/i);
        if (fetchedPd2 || fetchedInline) {
          return { pd2: fetchedPd2, inlineData: fetchedInline };
        }
      }
    } catch (err) {
      console.warn("[MovieLinkBD player frame fetch]", origin, err?.message || err);
    }
  }
  return { pd2: null, inlineData: null };
}

async function resolveLiveMlbdPathBySearch(hintTitle = "", cleanPath = "", yearHint = "") {
  try {
    const rawSlugTitle = String(cleanPath || "")
      .replace(/^\/(?:mlbd\/)?(?:movie|series|drama|anime)\//i, "")
      .replace(/\/+$/g, "")
      .replace(/[-_]+/g, " ")
      .trim();
    const rawSeed = String(hintTitle || "").trim() || rawSlugTitle;
    const baseQuery = cleanMlbdSearchTitle(rawSeed);
    if (!baseQuery || baseQuery.length < 2) return "";

    const searchPage = await mlbdFetchPage(`/search/?q=${encodeURIComponent(baseQuery)}`, { ttlMs: 60000 }).catch(() => null);
    if (!searchPage?.html) return "";
    const cards = extractCardsFromHtml(searchPage.html, searchPage.origin);
    if (!cards.length) return "";

    const wantRange = parseEpisodeRangeFromTitle(rawSeed) || parseEpisodeRangeFromTitle(rawSlugTitle);
    const wantSeries = /^\/(?:mlbd\/)?(?:series|drama|anime)\//i.test(cleanPath) || Boolean(wantRange);
    const scored = cards
      .filter(c => c?.path && normalizeUpstreamPath(c.path) !== cleanPath)
      .map(c => {
        const sim = titleSimilarityScore(baseQuery, c.searchTitle || c.title || "", {
          queryYear: yearHint,
          candidateYear: c.year || "",
          isSeries: wantSeries
        });
        let bonus = 0;
        if (Boolean(c.isSeries) === wantSeries) bonus += 0.12;
        if (yearHint && String(c.year || "") === String(yearHint)) bonus += 0.10;
        const cRange = parseEpisodeRangeFromTitle(c.title || "");
        if (wantRange && cRange && wantRange.startEp === cRange.startEp && wantRange.endEp === cRange.endEp) {
          bonus += 0.25;
        }
        return { c, sim, total: sim + bonus };
      })
      .filter(x => x.sim >= 0.65)
      .sort((a, b) => b.total - a.total || (b.c.uploadedAtMs || 0) - (a.c.uploadedAtMs || 0));

    return scored[0]?.c?.path || "";
  } catch {
    return "";
  }
}

export async function getMlbdDetails(rawPath, hintTitle = "", extraOpts = {}) {
  await ensureMlbdArchiveLoaded();
  const cleanPath = normalizeUpstreamPath(rawPath);
  if (cleanPath === "/") {
    throw new Error("Movie or series path is required");
  }

  const dubLock = extraOpts?.dubLock ? "1" : "0";
  const cacheKey = `details:${cleanPath}:${dubLock}`;
  if (!extraOpts?.bypassCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  let page;
  try {
    page = await mlbdFetchPage(cleanPath, { ttlMs: 120000, bypassCache: Boolean(extraOpts?.bypassCache) });
  } catch {
    const regItemPre = mlbdItemRegistry.get(String(rawPath || "").trim()) || mlbdItemRegistry.get(cleanPath) || mlbdArchiveByPath.get(cleanPath);
    if (!extraOpts?._noLiveSearch && !mlbdDirectMirrorsBlocked) {
      const yrGuess = String(regItemPre?.year || String(hintTitle || "").match(/\((19\d\d|20\d\d)\)/)?.[1] || "");
      const recoveredPath = await resolveLiveMlbdPathBySearch(hintTitle || regItemPre?.title || "", cleanPath, yrGuess);
      if (recoveredPath && recoveredPath !== cleanPath) {
        return await getMlbdDetails(recoveredPath, hintTitle || regItemPre?.title || "", { ...extraOpts, _noLiveSearch: true });
      }
    }
    if (isCinePulseConfigured()) {
      const cp = await fetchCinePulseApi("details", {
        path: cleanPath,
        title: String(hintTitle || regItemPre?.title || ""),
        source: "movielinkbd"
      }, { timeoutMs: 12000 });
      const cpRawDetail = cp.data?.detail || (cp.data?.title ? cp.data : null);
      if (cp.ok && cpRawDetail) {
        const cpDetail = normalizeCinePulseDetail(cpRawDetail, cleanPath);
        if (cpDetail && cpDetail.hasResource) {
          mlbdCinePulseHasContent = true;
          cpDetail.mlbdOriginalPath = rawPath;
          cpDetail.source = "movielinkbd-cinepulse";
          if (!cpDetail.poster && regItemPre?.poster) cpDetail.poster = regItemPre.poster;
          if (!cpDetail.rawPoster && regItemPre?.rawPoster) cpDetail.rawPoster = regItemPre.rawPoster;
          return setCached(cacheKey, { ok: true, source: "movielinkbd", detail: attachFastRelatedSeasons(cpDetail, rawPath, hintTitle) }, 120000);
        }
      }
    }

    const { params, regItem: regHit, searchName } = await resolveMlbdTitleViaMovieBox(
      rawPath,
      hintTitle,
      extraOpts?.dubLock ? { dubLock: "1" } : {}
    );
    const regItem = regHit || regItemPre;
    const fallbackSlugTitle = cleanPath
      .replace(/^\/(?:mlbd\/)?(?:movie|series|drama|anime)\//i, "")
      .replace(/\/+$/g, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, m => m.toUpperCase());
    const displayTitle = dedupeRepeatedTitleYear(regItem?.title || String(hintTitle || "").trim() || searchName || fallbackSlugTitle || "Title Details");
    const yearMatch = displayTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || cleanPath.match(/-(19\d\d|20\d\d)(?:$|[-/\b])/)?.[1] || regItem?.year || "";
    const parsedEpRange = parseEpisodeRangeFromTitle(displayTitle);
    const isSeries = Boolean(
      regItem?.isSeries ||
      /^\/(?:mlbd\/)?(?:series|drama|anime)\//i.test(cleanPath) ||
      parsedEpRange ||
      /\b(?:S\d{1,2}|Season\s*\d+|Ep(?:isode)?s?\s*\d+)\b/i.test(displayTitle)
    );

    if (params) {
      const mbDetails = await handleMovieBoxRoute("details", params).catch(() => null);
      const bridgeVariants = splitSearchTitleVariants(displayTitle);
      const bridgeSim = mbDetails?.detail
        ? Math.max(
            titleSimilarityScore(searchName, mbDetails.detail.title || "", { queryYear: yearMatch, candidateYear: mbDetails.detail.year || "", isSeries }),
            ...bridgeVariants.map(v => titleSimilarityScore(v, mbDetails.detail.title || "", { queryYear: yearMatch, candidateYear: mbDetails.detail.year || "", isSeries }))
          )
        : 0;
      if (mbDetails?.detail && bridgeSim >= 0.72 && !isMusicOrClipSubject(mbDetails.detail)) {
        let startEpisodeIndex = 0;
        const mbEps = Array.isArray(mbDetails.detail.episodes) ? mbDetails.detail.episodes : [];
        if (parsedEpRange?.season && mbEps.length) {
          const exactIdx = mbEps.findIndex(
            ep => Number(ep.seasonNumber ?? ep.se ?? 0) === parsedEpRange.season &&
                  Number(ep.episodeNumber ?? ep.ep ?? 0) === (parsedEpRange.startEp || 1)
          );
          const seasonFirstIdx = mbEps.findIndex(
            ep => Number(ep.seasonNumber ?? ep.se ?? 0) === parsedEpRange.season
          );
          if (exactIdx >= 0) startEpisodeIndex = exactIdx;
          else if (seasonFirstIdx >= 0) startEpisodeIndex = seasonFirstIdx;
        }
        const detail = {
          ...mbDetails.detail,
          mlbdOriginalPath: rawPath,
          poster: mbDetails.detail.poster || regItem?.poster || "",
          rawPoster: mbDetails.detail.rawPoster || regItem?.rawPoster || "",
          startEpisodeIndex,
          source: "movielinkbd-bridge"
        };
        return setCached(cacheKey, { ok: true, source: "movielinkbd", detail: attachFastRelatedSeasons(detail, rawPath, displayTitle) }, 120000);
      }
    }

    // Build accurate metadata detail for this exact MLBD title (never return an unrelated mock item or wrong-movie bridge)
    const lookupTerms = splitSearchTitleVariants(searchName || displayTitle);
    const meta = await lookupExternalTitleMetadata(lookupTerms[0] || cleanMlbdSearchTitle(displayTitle), yearMatch);
    const poster = regItem?.poster || meta.poster || "";
    const rawPoster = regItem?.rawPoster || "";
    const isUpcoming = isUpcomingUnreleased({
      title: displayTitle,
      typeBadge: regItem?.typeBadge,
      year: yearMatch,
      releaseDate: regItem?.releaseDate,
      isUpcoming: regItem?.isUpcoming
    });
    const inferredLang = regItem?.language ||
      (/bangla\s*dubbed/i.test(displayTitle) ? "Bangla Dubbed"
        : /bangla|bengali/i.test(displayTitle) ? "Bangla"
        : /hindi\s*dubbed|dual\s*audio/i.test(displayTitle) ? "Hindi Dubbed"
        : /korean/i.test(displayTitle) ? "Korean"
        : /turkish/i.test(displayTitle) ? "Turkish"
        : "English");

    let episodes = [];
    if (isSeries) {
      const seNum = parsedEpRange?.season || 1;
      const startEp = parsedEpRange?.startEp || 1;
      const endEp = parsedEpRange?.endEp || 1;
      for (let ep = startEp; ep <= endEp; ep++) {
        episodes.push({
          label: `S${String(seNum).padStart(2, "0")}E${String(ep).padStart(2, "0")}`,
          number: ep,
          episodeNumber: ep,
          seasonNumber: seNum,
          se: seNum,
          ep,
          sources: [],
          subtitles: [],
          audioTracks: [],
          downloadButtons: []
        });
      }
    } else {
      episodes = [
        {
          label: isUpcoming ? `${displayTitle} (Upcoming)` : "Full Video",
          number: 1,
          episodeNumber: 1,
          seasonNumber: 0,
          se: 0,
          ep: 1,
          sources: [],
          subtitles: [],
          audioTracks: [],
          downloadButtons: []
        }
      ];
    }

    const desc =
      meta.description ||
      (isUpcoming
        ? `${displayTitle} is listed on MovieStreamBD as an upcoming release. Direct streaming sources will appear once it releases.`
        : `${displayTitle} metadata loaded from MovieStreamBD catalog. Watch the official trailer or tap Retry Stream to reconnect mirror servers.`);

    const detail = {
      source: "movielinkbd",
      id: regItem?.id || cleanPath.split("/").pop() || cleanPath,
      subjectId: regItem?.id || cleanPath,
      path: rawPath.startsWith("/") ? rawPath : cleanPath,
      detailPath: cleanPath,
      title: displayTitle,
      year: String(yearMatch || meta.year || ""),
      rating: String(regItem?.rating || ""),
      poster,
      rawPoster,
      quality: String(regItem?.quality || "HD"),
      episodePill: String(regItem?.episodePill || ""),
      viewsText: String(regItem?.viewsText || ""),
      description: desc,
      storyline: desc,
      language: inferredLang,
      type: regItem?.type || (isSeries ? "series" : "movie"),
      typeBadge: isSeries ? "Series" : (regItem?.typeBadge || "Movie"),
      isMovie: !isSeries,
      isSeries,
      isUpcoming,
      hasResource: false,
      trailerYoutubeId: meta.trailerYoutubeId || "",
      staff: meta.staff || [],
      totalEpisodes: episodes.length,
      episodes,
      downloadButtons: []
    };
    const outPayload = { ok: true, source: "movielinkbd", detail: attachFastRelatedSeasons(detail, rawPath, displayTitle) };
    return isUpcoming ? setCached(cacheKey, outPayload, 120000) : outPayload;
  }

  const html = page.html;

  // 1. Parse JSON-LD / OG metadata + Copy rich metadata (staff, trailer, communityScore, qualityNote)
  const ogTitle = stripTags(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] || "");
  const h1Title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const titleTag = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const cleanTitle = stripSiteBrandFromLabel((h1Title || ogTitle || titleTag).replace(/\s*\|\s*MovieLinkBD.*$/i, "").replace(/\s*Download\s*$/i, "").trim());

  const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || "";
  const posterCardImg = html.match(/class="[^"]*poster[^"]*"[^>]*>[\s\S]{0,250}?(?:data-src|src)="(https?:\/\/[^"]+)"/i)?.[1] || "";
  const rawPoster = ogImage || posterCardImg;
  const poster = rawPoster ? mlbdProxyImageUrl(rawPoster) : "";

  const ogDesc = stripTags(html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]+)"/i)?.[1] || "");
  const synopsisEl = stripTags(html.match(/<div[^>]+class="[^"]*(?:synopsis|storyline|description|plot)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  const description = synopsisEl || ogDesc;

  const trailerYoutubeId = html.match(/data-mlbd-trailer=["']([a-zA-Z0-9_-]{6,20})["']/i)?.[1] || "";
  const communityScore = stripTags(html.match(/data-summary=["']([^"']+)["']/i)?.[1] || "");
  const qualityNote = stripTags(html.match(/<div[^>]+class=["'][^"']*movie-info-view[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");

  const parsedStaff = [];
  const castRe = /<a[^>]+class=["']mlbd-cast__p["'][^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>[\s\S]*?<small>([\s\S]*?)<\/small>/gi;
  let cm;
  while ((cm = castRe.exec(html)) && parsedStaff.length < 18) {
    const name = stripTags(cm[3]);
    if (!name) continue;
    parsedStaff.push({
      staffId: String(cm[1] || `mlbd-${parsedStaff.length}`),
      avatarUrl: cm[2] ? mlbdProxyImageUrl(cm[2]) : "",
      name,
      role: stripTags(cm[4]) || "Cast"
    });
  }

  // 2. Check mlbdInlinePlayerData or mlbdHdFrame (/p/<token>) -> window.__PD2
  let inlineData = extractBalancedJson(html, /(?:var|let|const|window\.)\s*mlbdInlinePlayerData\s*=\s*/i);
  const frameSrc =
    html.match(/id="mlbdHdFrame"[^>]+src="([^"]+)"/i)?.[1] ||
    html.match(/src="(\/p\/[A-Za-z0-9._~-]{8,})"/i)?.[1] ||
    "";

  let pd2 = extractBalancedJson(html, /window\.__PD2\s*=\s*/i);
  let playerToken = "";
  if (frameSrc) {
    playerToken = frameSrc.replace(/^.*\/p\//, "");
    const frameRes = await fetchPlayerFrameData(frameSrc, page);
    if (frameRes.pd2) pd2 = frameRes.pd2;
    if (!inlineData && frameRes.inlineData) inlineData = frameRes.inlineData;
  }

  // If page returned a soft-fallback listing (e.g. "Recently Updated") or frame fetch failed with empty PD2, recover via live MLBD search
  if (!pd2 && !inlineData && !extraOpts?._noLiveSearch) {
    const regFallback = mlbdItemRegistry.get(String(rawPath || "").trim()) || mlbdItemRegistry.get(cleanPath) || mlbdArchiveByPath.get(cleanPath);
    const softListingPage = /^(?:Recently Updated|Latest|Trending|Home|Search)/i.test(cleanTitle) || !frameSrc;
    const seedTitle = String(hintTitle || regFallback?.title || (softListingPage ? "" : cleanTitle) || "").trim();
    const yrHint = String(regFallback?.year || seedTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "");
    const recoveredPath = await resolveLiveMlbdPathBySearch(seedTitle, cleanPath, yrHint);
    if (recoveredPath && recoveredPath !== cleanPath) {
      return await getMlbdDetails(recoveredPath, seedTitle, { ...extraOpts, _noLiveSearch: true });
    }
  }

  const baseData = pd2 || inlineData || {};
  const pageSubs = extractPageSubtitles(html, page.origin);
  const globalSubs = [...mapPd2Subtitles(baseData.subs || baseData.subtitles, 0), ...pageSubs];
  const dedupGlobalSubs = [...new Map(globalSubs.map(s => [s.label + "|" + s.language, s])).values()];
  const globalAudio = mapPd2AudioTracks(baseData.audio);

  const pageDownloadButtons = extractDownloadButtonsFromHtml(html, page.origin);
  const epDownloadMap = extractEpisodeDownloadMap(html, page.origin);

  const finalTitle = baseData.title || cleanTitle || "Untitled";
  const rawEpisodes = Array.isArray(baseData.episodes) && baseData.episodes.length ? baseData.episodes : null;

  let episodes = [];
  if (rawEpisodes) {
    episodes = rawEpisodes.map((ep, idx) => {
      const seasonNum = Number(ep?.season ?? ep?.seasonNumber ?? 0) || 0;
      const epNum = Number(ep?.number ?? ep?.episodeNumber ?? idx + 1) || idx + 1;
      const sources = buildSourcesForPd2Entry(ep, baseData, finalTitle);
      const subs = [...mapPd2Subtitles(ep?.subs, idx * 10), ...dedupGlobalSubs];
      const uniqSubs = [...new Map(subs.map(s => [s.label + "|" + s.language, s])).values()];
      const epDlBtns =
        epDownloadMap.get(`${seasonNum}:${epNum}`) ||
        epDownloadMap.get(`ep:${epNum}`) ||
        (rawEpisodes.length === 1 ? pageDownloadButtons : []);

      // Include Direct MP4 links right inside downloadButtons too so download.html shows Direct MP4 + gateway links
      const mp4SourceButtons = sources
        .filter(s => s.format === "MP4")
        .map(s => ({
          label: `Direct MP4 (${s.quality})`,
          quality: s.quality,
          url: s.url,
          type: "mp4",
          provider: s.provider
        }));

      return {
        label: ep?.label || (rawEpisodes.length === 1 ? "Full Video" : `Episode ${epNum}`),
        number: epNum,
        episodeNumber: epNum,
        seasonNumber: seasonNum,
        se: seasonNum,
        ep: epNum,
        sources,
        subtitles: uniqSubs,
        audioTracks: mapPd2AudioTracks(ep?.audio).length ? mapPd2AudioTracks(ep?.audio) : globalAudio,
        downloadButtons: [...mp4SourceButtons, ...epDlBtns],
        masterHls: ep?.master ? mlbdProxyHlsUrl(ep.master) : "",
        directMp4: ep?.mp4 ? mlbdProxyStreamUrl(ep.mp4, `${finalTitle} - ${ep?.label || `Ep ${epNum}`}.mp4`) : ""
      };
    });
  } else {
    const fallbackSources = buildSourcesForPd2Entry({}, baseData, finalTitle);
    const mp4Buttons = fallbackSources
      .filter(s => s.format === "MP4")
      .map(s => ({ label: `Direct MP4 (${s.quality})`, quality: s.quality, url: s.url, type: "mp4", provider: s.provider }));
    const parsedRange = parseEpisodeRangeFromTitle(hintTitle || finalTitle);
    const fallbackSe = /^\/(?:series|drama|anime)\//i.test(cleanPath) ? (parsedRange?.season || 1) : 0;
    const fallbackEp = parsedRange?.startEp || 1;
    episodes = [
      {
        label: fallbackSe > 0 ? `Episode ${fallbackEp}` : "Full Video",
        number: fallbackEp,
        episodeNumber: fallbackEp,
        seasonNumber: fallbackSe,
        se: fallbackSe,
        ep: fallbackEp,
        sources: fallbackSources,
        subtitles: dedupGlobalSubs,
        audioTracks: globalAudio,
        downloadButtons: [...mp4Buttons, ...pageDownloadButtons]
      }
    ];
  }

  const isSeries = /^\/(?:series|drama|anime)\//i.test(cleanPath) || episodes.length > 1;
  const startIdx = Number.isInteger(baseData.startEp) && baseData.startEp >= 0 && baseData.startEp < episodes.length
    ? baseData.startEp
    : 0;
  const year = String(baseData.year || finalTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "");
  const regMeta = mlbdItemRegistry.get(String(rawPath || "").trim()) || mlbdItemRegistry.get(cleanPath) || mlbdArchiveByPath.get(cleanPath);
  const inferredLang =
    String(baseData.langs || regMeta?.language || "").trim() ||
    (/bangla\s*dub/i.test(`${hintTitle} ${finalTitle}`) ? "Bangla Dubbed"
      : /bangla|bengali/i.test(`${hintTitle} ${finalTitle}`) ? "Bangla"
      : /hindi\s*dub|dual\s*audio/i.test(`${hintTitle} ${finalTitle}`) ? "Hindi Dubbed"
      : "");
  const hasStreamSources = episodes.some(e => Array.isArray(e.sources) && e.sources.length > 0);

  const detail = {
    source: "movielinkbd",
    id: String(baseData.id || cleanPath.split("/").pop() || cleanPath),
    subjectId: String(baseData.id || cleanPath),
    path: cleanPath,
    detailPath: cleanPath,
    title: finalTitle,
    year,
    poster: baseData.poster ? mlbdProxyImageUrl(baseData.poster) : poster,
    rawPoster: String(baseData.poster || rawPoster || ""),
    description,
    storyline: description,
    language: inferredLang,
    isMovie: !isSeries,
    isSeries,
    typeBadge: isSeries ? "Series" : "Movie",
    totalEpisodes: episodes.length,
    startEpisodeIndex: startIdx,
    playerToken,
    playerFramePath: frameSrc,
    trailerYoutubeId,
    communityScore,
    qualityNote,
    staff: parsedStaff,
    audioTracks: globalAudio,
    subtitles: dedupGlobalSubs,
    episodes,
    downloadButtons: pageDownloadButtons,
    hasResource: hasStreamSources || episodes.some(e => e.downloadButtons.length > 0)
  };

  const payloadOut = { ok: true, source: "movielinkbd", detail: attachFastRelatedSeasons(detail, rawPath, finalTitle) };
  // Never lock an empty broken player frame response in cache for 2 minutes
  return hasStreamSources ? setCached(cacheKey, payloadOut, 120000) : payloadOut;
}

function attachFastRelatedSeasons(detailObj, rawPath = "", hintTitle = "") {
  if (!detailObj || typeof detailObj !== "object") return detailObj;
  loadMlbdArchiveFromDisk();
  const baseSeriesName = extractBaseSeriesTitle(hintTitle || detailObj.title || "");
  const cleanSelfPath = normalizeUpstreamPath(detailObj.path || rawPath);
  const selfTitleKey = `${String(detailObj.title || "").trim()} ${String(detailObj.qualityNote || detailObj.episodePill || "").trim()}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const matchingSiblings = [];
  const seenPaths = new Set([cleanSelfPath, String(rawPath || "")]);
  const seenTitleKeys = new Set();
  if (selfTitleKey) seenTitleKeys.add(selfTitleKey);

  if (baseSeriesName && baseSeriesName.length >= 3) {
    const baseLower = baseSeriesName.toLowerCase();
    for (const item of mlbdArchiveRecords) {
      if (!item?.path || seenPaths.has(item.path)) continue;
      if (extractBaseSeriesTitle(item.title).toLowerCase() === baseLower) {
        seenPaths.add(item.path);
        const titleKey = `${String(item.title || "").trim()}`.toLowerCase().replace(/\s+/g, " ").trim();
        if (titleKey && seenTitleKeys.has(titleKey)) continue;
        if (titleKey) seenTitleKeys.add(titleKey);
        matchingSiblings.push(item);
      }
    }
  }

  const dubs = Array.isArray(detailObj.dubs) ? [...detailObj.dubs] : [];
  const seenLabels = new Set(dubs.map(d => String(d?.label || d?.language || "").toLowerCase()).filter(Boolean));
  if (!dubs.length && detailObj.path) {
    const inferredPrimary =
      String(detailObj.language || "").split("·")[0].trim() ||
      (/bangla\s*dub/i.test(`${hintTitle} ${detailObj.title}`) ? "Bangla Dubbed"
        : /bangla|bengali/i.test(`${hintTitle} ${detailObj.title}`) ? "Bangla"
        : /hindi\s*dub|dual/i.test(`${hintTitle} ${detailObj.title}`) ? "Hindi Dubbed"
        : "Original Audio");
    seenLabels.add(inferredPrimary.toLowerCase());
    dubs.push({
      id: `dub-primary-${cleanSelfPath}`,
      label: inferredPrimary,
      language: inferredPrimary,
      path: detailObj.path,
      active: true
    });
  }
  for (const sib of matchingSiblings) {
    const sibLang = String(sib.language || "").trim();
    if (sibLang && !seenLabels.has(sibLang.toLowerCase())) {
      seenLabels.add(sibLang.toLowerCase());
      dubs.push({
        id: `dub-${sib.id}`,
        label: sibLang,
        language: sibLang,
        path: sib.path,
        active: false
      });
    }
  }

  const out = { ...detailObj, dubs };
  if ((!out.relatedSeasons || !out.relatedSeasons.length) && matchingSiblings.length && (out.isSeries || matchingSiblings.length >= 1)) {
    out.relatedSeasons = matchingSiblings.slice(0, 12);
  }
  return out;
}

export async function findExactTitleMlbdBackup(rawTitle = "", wantMovie = true) {
  try {
    await ensureMlbdArchiveLoaded();
    const cleanStrictBase = s =>
      extractBaseSeriesTitle(String(s || "").replace(/\(\s*(?:19|20)\d{2}\s*\)[\s\S]*$/, ""))
        .replace(/\b(?:HQ|Dubbed|Subbed|Dub|Sub|Uncut|Extended|Malayalam|Tamil|Telugu|Kannada|English|Korean|Japanese|Chinese|Spanish|French|Punjabi|Marathi|WebRip|BluRay|HDRip|1080p|720p|480p|CAMRip|PREHD|HDCAM|ESub|MSub|HEVC|x264|x265|IMAX|Remastered|Director'?s?\s*Cut)\b/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    const norm = s => cleanStrictBase(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const baseTitle = cleanStrictBase(rawTitle);
    const wantNorm = norm(baseTitle);
    if (baseTitle.length < 3 || wantNorm.length < 3) return null;

    const langHintMatch = String(rawTitle || "").match(/\b(Hindi|Bangla|Bengali|Tamil|Telugu|Malayalam|English)\b/i);
    const wantLang = langHintMatch ? langHintMatch[1].toLowerCase() : "";
    const scoreCandidate = it => {
      let sc = wantMovie === !it.isSeries ? 10 : 0;
      if (wantLang && String(`${it.title} ${it.language}`).toLowerCase().includes(wantLang)) sc += 5;
      return sc;
    };

    const matches = mlbdArchiveRecords
      .filter(it => it?.path && norm(it.title) === wantNorm)
      .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

    let matchedPath = matches[0]?.path || "";
    if (!matchedPath && !mlbdDirectMirrorsBlocked) {
      const searchPage = await mlbdFetchPage(`/search/?q=${encodeURIComponent(baseTitle)}`, { ttlMs: 60000 }).catch(() => null);
      if (searchPage?.html) {
        const cards = extractCardsFromHtml(searchPage.html, searchPage.origin)
          .filter(it => norm(it.title) === wantNorm)
          .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
        matchedPath = cards[0]?.path || "";
      }
    }
    if (!matchedPath) return null;
    const { detail } = await getMlbdDetails(matchedPath, rawTitle);
    return detail && (detail.hasResource || detail.episodes?.some(ep => ep.sources?.length)) ? detail : null;
  } catch {
    return null;
  }
}

export async function getMlbdStream({ path = "", se = 0, ep = 1, title = "", dubLock = false } = {}) {
  let { detail } = await getMlbdDetails(path, title, { dubLock });
  if (detail?.source === "movielinkbd-bridge" && detail?.subjectId) {
    const params = new URLSearchParams({
      subjectId: String(detail.subjectId),
      detailPath: String(detail.detailPath || ""),
      se: String(se || 0),
      ep: String(ep || 1),
      title: String(title || detail.title || "")
    });
    if (dubLock) params.set("dubLock", "1");
    return await handleMovieBoxRoute("stream", params);
  }

  const pickChosen = det => {
    const eps = Array.isArray(det?.episodes) ? det.episodes : [];
    const targetSe = Number(se) || 0;
    const targetEp = Number(ep) || 0;
    return (
      eps.find(e => Number(e.seasonNumber) === targetSe && Number(e.episodeNumber) === targetEp) ||
      eps.find(e => Number(e.episodeNumber) === targetEp) ||
      eps[Math.max(0, Math.min(eps.length - 1, Number(det?.startEpisodeIndex) || 0))] ||
      eps[0]
    );
  };

  let chosen = pickChosen(detail);
  let sources = Array.isArray(chosen?.sources) ? chosen.sources : [];
  let subtitles = Array.isArray(chosen?.subtitles) ? chosen.subtitles : [];
  let audioTracks = Array.isArray(chosen?.audioTracks) ? chosen.audioTracks : [];

  // Retry bypassing cache + live MLBD search if initial fetch returned 0 sources
  if (!sources.length) {
    try {
      const fresh = await getMlbdDetails(path, title || detail?.title || "", { dubLock, bypassCache: true });
      if (fresh?.detail) {
        if (fresh.detail.source === "movielinkbd-bridge" && fresh.detail.subjectId) {
          const params = new URLSearchParams({
            subjectId: String(fresh.detail.subjectId),
            detailPath: String(fresh.detail.detailPath || ""),
            se: String(se || 0),
            ep: String(ep || 1),
            title: String(title || fresh.detail.title || "")
          });
          if (dubLock) params.set("dubLock", "1");
          return await handleMovieBoxRoute("stream", params);
        }
        const freshChosen = pickChosen(fresh.detail);
        if (Array.isArray(freshChosen?.sources) && freshChosen.sources.length) {
          detail = fresh.detail;
          chosen = freshChosen;
          sources = freshChosen.sources;
          subtitles = Array.isArray(freshChosen.subtitles) ? freshChosen.subtitles : subtitles;
          audioTracks = Array.isArray(freshChosen.audioTracks) ? freshChosen.audioTracks : audioTracks;
        }
      }
    } catch {}
  }

  if (!sources.length && (title || detail?.title)) {
    try {
      const backupDet = await findExactTitleMlbdBackup(title || detail?.title, !detail?.isSeries);
      if (backupDet) {
        const bChosen = pickChosen(backupDet);
        if (Array.isArray(bChosen?.sources) && bChosen.sources.length) {
          detail = backupDet;
          chosen = bChosen;
          sources = bChosen.sources;
          subtitles = Array.isArray(bChosen.subtitles) ? bChosen.subtitles : subtitles;
          audioTracks = Array.isArray(bChosen.audioTracks) ? bChosen.audioTracks : audioTracks;
        }
      }
    } catch {}
  }

  const targetSe = Number(se) || 0;
  const targetEp = Number(ep) || 0;
  if ((detail?.source === "movielinkbd-cinepulse" || !sources.length) && isCinePulseConfigured()) {
    const cp = await fetchCinePulseApi("stream", {
      path: normalizeUpstreamPath(detail?.path || path),
      subjectId: String(detail?.subjectId || ""),
      se: String(targetSe),
      ep: String(targetEp),
      title: String(title || detail?.title || ""),
      source: detail?.source === "movielinkbd-cinepulse" ? "movielinkbd" : "all"
    }, { timeoutMs: 14000 });
    if (cp.ok && cp.data) {
      const norm = normalizeCinePulsePayload("stream", cp.data);
      const cpSources = Array.isArray(norm?.sources) ? norm.sources : [];
      if (cpSources.length) {
        sources = cpSources;
        subtitles = Array.isArray(norm?.subtitles) && norm.subtitles.length ? norm.subtitles : subtitles;
        audioTracks = Array.isArray(norm?.audioTracks) && norm.audioTracks.length ? norm.audioTracks : audioTracks;
      }
    }
  }

  return {
    ok: true,
    source: "movielinkbd",
    stream: {
      sources,
      subtitles,
      audioTracks,
      hasResource: sources.length > 0,
      isTrailer: false,
      trailerYoutubeId: detail?.trailerYoutubeId || ""
    },
    sources,
    subtitles,
    audioTracks,
    trailerYoutubeId: detail?.trailerYoutubeId || "",
    downloadButtons: chosen?.downloadButtons || detail.downloadButtons || [],
    message: sources.length
      ? ""
      : detail?.isUpcoming
        ? `Upcoming release (${detail.year || "2026"}) — Official details & trailer available; full stream opens after release.`
        : "Direct video stream is unavailable on this server right now — watch the official trailer or tap Retry Stream."
  };
}

export function rewriteMlbdHlsPlaylist(rawText, playlistUrl) {
  let nextIsVariant = false;
  return String(rawText || "")
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        if (/^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF)/i.test(trimmed)) {
          nextIsVariant = true;
        }
        return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
          try {
            const abs = new URL(uri, playlistUrl).href;
            if (!validateExternalHttpUrl(abs)) return `URI="${uri}"`;
            const isSubM3u8 =
              /\.m3u8(?:$|[?#])/i.test(abs) ||
              /\/(?:hls|m|vsub)\//i.test(abs) ||
              /^#EXT-X-MEDIA:.*TYPE=(?:AUDIO|VIDEO)/i.test(trimmed);
            const isInitMap = /^#EXT-X-MAP/i.test(trimmed) || /^#EXT-X-KEY/i.test(trimmed);
            const proxied = isSubM3u8 && !isInitMap
              ? mlbdProxyHlsUrl(abs)
              : mlbdProxyStreamUrl(abs);
            return `URI="${proxied}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      try {
        const abs = new URL(trimmed, playlistUrl).href;
        if (!validateExternalHttpUrl(abs)) return line;
        const isSubPlaylist = nextIsVariant || /\.m3u8(?:$|[?#])/i.test(abs) || /\/(?:hls|m)\//i.test(abs);
        nextIsVariant = false;
        return isSubPlaylist ? mlbdProxyHlsUrl(abs) : mlbdProxyStreamUrl(abs);
      } catch {
        nextIsVariant = false;
        return line;
      }
    })
    .join("\n");
}

export function getActiveMlbdReferer() {
  return activeResolvedOrigin.endsWith("/") ? activeResolvedOrigin : `${activeResolvedOrigin}/`;
}
