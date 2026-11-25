import { MOVIEBOX_UA, handleMovieBoxRoute, signMediaToken, verifyMediaToken } from "./moviebox-api.js";

export const MLBD_MIRRORS = [
  { id: "primary", name: "Primary", baseUrl: "https://fvuyyu.movielinkbd.at", priority: 1 },
  { id: "mirror2", name: "Mirror 2", baseUrl: "https://h5esed.movielinkbd.at", priority: 2 },
  { id: "mirror3", name: "Mirror 3", baseUrl: "https://movielinkbd.com", priority: 3 },
  { id: "backup", name: "Backup", baseUrl: "https://cmyyhb.movielinkbd.at", priority: 4 }
];

const DEFAULT_FALLBACK_CATEGORIES = [
  { label: "Latest & Home", path: "/", group: "Collections", icon: "🏠" },
  { label: "Bangla Movies", path: "/language/bangla", group: "Languages & Regions", icon: "🇧🇩" },
  { label: "Bangla Dubbed", path: "/language/bangla-dubbed", group: "Languages & Regions", icon: "🎙️" },
  { label: "Hindi Dubbed", path: "/language/hindi-dubbed", group: "Languages & Regions", icon: "🎤" },
  { label: "Hindi Movies", path: "/language/hindi", group: "Languages & Regions", icon: "🇮🇳" },
  { label: "Dual Audio", path: "/language/dual-audio", group: "Languages & Regions", icon: "🎧" },
  { label: "English / Hollywood", path: "/language/english", group: "Languages & Regions", icon: "🎥" },
  { label: "K-Drama", path: "/language/korean", group: "Languages & Regions", icon: "🇰🇷" },
  { label: "C-Drama", path: "/language/chinese", group: "Languages & Regions", icon: "🇨🇳" },
  { label: "Tamil", path: "/language/tamil", group: "Languages & Regions", icon: "🎞️" },
  { label: "Telugu", path: "/language/telugu", group: "Languages & Regions", icon: "🎞️" },
  { label: "Malayalam", path: "/language/malayalam", group: "Languages & Regions", icon: "🎞️" },
  { label: "Turkish Drama", path: "/language/turkish", group: "Languages & Regions", icon: "🇹🇷" },
  { label: "Indonesian", path: "/language/indonesian", group: "Languages & Regions", icon: "🇮🇩" },
  { label: "Movies", path: "/type/movies", group: "Collections", icon: "🎬" },
  { label: "Web Series", path: "/type/series", group: "Collections", icon: "📺" },
  { label: "South Indian", path: "/southIndian", group: "Languages & Regions", icon: "🌏" },
  { label: "Anime Zone", path: "/anime", group: "Collections", icon: "🍥" },
  { label: "Animation", path: "/genre/animation", group: "Genres", icon: "🎨" },
  { label: "MCU Collection", path: "/collection/mcu-marvel-cinematic-universe", group: "Collections", icon: "🛡️" },
  { label: "DC Universe", path: "/collection/dc-universe-dceu-dcu", group: "Collections", icon: "🦇" },
  { label: "WWE", path: "/category/wwe", group: "Collections", icon: "🤼" },
  { label: "Action", path: "/genre/action", group: "Genres", icon: "💥" },
  { label: "Thriller", path: "/genre/thriller", group: "Genres", icon: "🔪" },
  { label: "Horror", path: "/genre/horror", group: "Genres", icon: "👻" },
  { label: "Romance", path: "/genre/romance", group: "Genres", icon: "❤️" }
];

const mlbdCache = new Map();
const mlbdInFlight = new Map();
const mlbdItemRegistry = new Map();
const posterRegistry = new Map();
const posterInFlight = new Map();
let activeResolvedOrigin = "https://fvuyyu.movielinkbd.at";
let mirrorsBlockedUntil = 0;

function normalizePosterKey(title = "") {
  return decodeHtmlEntities(String(title || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTitle(str = "") {
  const stop = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "from", "part", "movie", "series", "season", "ep"]);
  return normalizePosterKey(str)
    .split(" ")
    .filter(w => w.length >= 2 && !stop.has(w));
}

function titleSimilarityScore(queryTitle = "", candidateTitle = "") {
  const qNorm = normalizePosterKey(queryTitle);
  const cNorm = normalizePosterKey(candidateTitle);
  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 1;
  if ((qNorm.length >= 5 && cNorm.includes(qNorm)) || (cNorm.length >= 5 && qNorm.includes(cNorm))) return 0.88;

  const qTokens = tokenizeTitle(queryTitle);
  const cTokens = new Set(tokenizeTitle(candidateTitle));
  if (!qTokens.length || !cTokens.size) return 0;
  let hits = 0;
  for (const t of qTokens) {
    if (cTokens.has(t)) hits++;
  }
  return hits / Math.max(qTokens.length, 1);
}

function registerPosterInCache(item) {
  if (!item || !item.poster) return;
  const searchKey = normalizePosterKey(item.searchTitle || cleanMlbdSearchTitle(item.title || ""));
  if (!searchKey) return;
  const entry = {
    poster: item.poster,
    rating: item.rating || "",
    mbSubjectId: item.mbSubjectId || item.subjectId || "",
    mbDetailPath: item.mbDetailPath || item.detailPath || ""
  };
  if (item.year) {
    posterRegistry.set(`${searchKey}|${item.year}`, entry);
  }
  if (!posterRegistry.has(searchKey)) {
    posterRegistry.set(searchKey, entry);
  }
  if (posterRegistry.size > 4000) {
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
  return posterRegistry.get(key) || null;
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
  if (mlbdItemRegistry.size > 3500) {
    const oldest = mlbdItemRegistry.keys().next().value;
    if (oldest) mlbdItemRegistry.delete(oldest);
  }
}

function cleanMlbdSearchTitle(rawTitle) {
  return decodeHtmlEntities(String(rawTitle || ""))
    .replace(/\s*[—–-]\s*MovieLinkBD.*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:19|20)\d{2}[^)]*\)/g, " ")
    .replace(/\((?:hindi|bangla|bengali|english|tamil|telugu|malayalam|korean|dual\s*audio|dubbed|org|hq|uncut)[^)]*\)/gi, " ")
    .replace(/\b(?:S\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?|Season\s*\d+|Ep(?:isode)?\s*\d+(?:\s*[-–]\s*\d+)?|Full\s*HD|HDRip|WEB-?DL|BluRay|HEVC|1080p|720p|480p|4K|ORG|HQ|Uncut|Added|Completed|Complete|Dual\s*Audio|Multi\s*Audio|(?:Hindi|Bangla|Bengali|Tamil|Telugu|Malayalam|Korean|English)\s*(?:HQ|ORG)?\s*Dubbed)\b/gi, " ")
    .replace(/\s+(?:Hindi|Bangla|Bengali|Dubbed|ORG|HQ)+$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function setCached(key, val, ttlMs = 90000) {
  mlbdCache.set(key, { val, exp: Date.now() + ttlMs });
  if (mlbdCache.size > 400) {
    const oldest = mlbdCache.keys().next().value;
    if (oldest) mlbdCache.delete(oldest);
  }
  return val;
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

const BLOCKED_TRAP_HOSTS = new Set(["movielinkbd.tv", "www.movielinkbd.tv", "movielinkbd.app", "www.movielinkbd.app"]);

function ensureTrailingSlashPath(pathWithQuery) {
  const raw = String(pathWithQuery || "/");
  const qIdx = raw.indexOf("?");
  const p = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const q = qIdx >= 0 ? raw.slice(qIdx) : "";
  if (!p || p === "/" || p === "/new" || /^\/(?:movie|series|drama|anime|p|updates)\//i.test(p)) {
    return raw;
  }
  return (p.endsWith("/") ? p : p + "/") + q;
}

async function fetchMirrorOnce(baseUrl, pathWithQuery, extraHeaders = {}, timeoutMs = 14000) {
  let currentUrl = new URL(pathWithQuery, baseUrl).href;
  let allCookies = [];
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(currentUrl, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...extraHeaders
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const hopCookies = cookieStringFromResponse(res);
    if (hopCookies) allCookies.push(hopCookies);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch {}
      if (!loc) return { res, text: "", finalUrl: currentUrl, finalOrigin: new URL(currentUrl).origin, cookies: allCookies.join("; ") };
      const nextUrl = new URL(loc, currentUrl);
      if (BLOCKED_TRAP_HOSTS.has(nextUrl.hostname.toLowerCase())) {
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
    return { res, text, finalUrl: res.url || currentUrl, finalOrigin, cookies: allCookies.join("; ") };
  }
  throw new Error(`Too many redirects from ${baseUrl}`);
}

function isPortalLandingHtml(html) {
  const s = String(html || "");
  if (!s) return true;
  if (/cf-mitigated|Just a moment\.\.\./i.test(s)) return true;
  const hasContentMarkers = /movie-card|rail-section|mlbdHdFrame|__PD2|mlbdInlinePlayerData/i.test(s);
  if (hasContentMarkers) return false;
  return /MovieLinkBD\.com\s*[—-]\s*Official/i.test(s) || /<meta[^>]+name="generator"[^>]*>/i.test(s) || s.length < 1200;
}

function extractMirrorOriginsFromPortal(html) {
  const out = [];
  const seen = new Set();
  const re = /https:\/\/([a-z0-9-]+\.movielinkbd\.at)/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const origin = `https://${m[1].toLowerCase()}`;
    if (origin === "https://www.movielinkbd.at") continue;
    if (!seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}

async function discoverLiveMirrorOrigin(timeoutMs = 8000) {
  try {
    const portal = await fetchMirrorOnce("https://movielinkbd.com", "/", {}, timeoutMs);
    if (portal.res.ok && portal.text) {
      const origins = extractMirrorOriginsFromPortal(portal.text);
      if (origins.length) return origins;
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
    throw new Error("MovieLinkBD mirrors temporarily blocked");
  }

  if (mlbdInFlight.has(cacheKey)) {
    return await mlbdInFlight.get(cacheKey);
  }

  const job = (async () => {
    const candidateBases = [...new Set([
      activeResolvedOrigin,
      ...MLBD_MIRRORS.map(m => m.baseUrl)
    ])].filter(b => {
      try { return !BLOCKED_TRAP_HOSTS.has(new URL(b).hostname.toLowerCase()); } catch { return false; }
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

    for (let i = 0; i < candidateBases.length; i++) {
      const base = candidateBases[i];
      if (!base || tried.has(base)) continue;
      tried.add(base);

      // Portal root movielinkbd.com only gives mirror origins, not full category pages
      if (/^https?:\/\/(?:www\.)?movielinkbd\.com$/i.test(base)) {
        if (!portalChecked) {
          portalChecked = true;
          const discovered = await discoverLiveMirrorOrigin(options.timeoutMs || 8000);
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
          const out = await fetchMirrorOnce(base, reqVariant, extra, options.timeoutMs || 14000);
          if (out.blockedRedirect) {
            lastErr = new Error(`Blocked redirect (${out.blockedRedirect}) from ${base}`);
            continue;
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
            const result = {
              html: out.text,
              finalUrl: out.finalUrl,
              origin: out.finalOrigin,
              cookies: out.cookies,
              mirrorUsed: base
            };
            return setCached(cacheKey, result, ttlMs);
          }
          lastErr = new Error(`HTTP ${out.res.status} from ${base}${reqVariant}`);
        } catch (err) {
          lastErr = err;
        }
      }

      if (!portalChecked) {
        portalChecked = true;
        const discovered = await discoverLiveMirrorOrigin(options.timeoutMs || 8000);
        for (const d of discovered) {
          if (!tried.has(d) && !candidateBases.includes(d)) {
            candidateBases.splice(i + 1, 0, d);
          }
        }
      }
    }
    mirrorsBlockedUntil = Date.now() + 120000;
    throw lastErr || new Error("All MovieLinkBD mirrors are currently unreachable");
  })();

  mlbdInFlight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    mlbdInFlight.delete(cacheKey);
  }
}

export async function getMlbdServerHealth() {
  const cached = getCached("server-health");
  if (cached) return cached;

  const checks = await Promise.all(
    MLBD_MIRRORS.map(async mirror => {
      const started = Date.now();
      try {
        const res = await fetch(mirror.baseUrl + "/", {
          method: "HEAD",
          headers: { "User-Agent": MOVIEBOX_UA },
          redirect: "follow",
          signal: AbortSignal.timeout(8000)
        });
        const latencyMs = Date.now() - started;
        return {
          id: mirror.id,
          name: mirror.name,
          baseUrl: mirror.baseUrl,
          resolvedUrl: res.url || mirror.baseUrl,
          priority: mirror.priority,
          status: res.status,
          ok: res.ok,
          online: res.ok,
          latencyMs
        };
      } catch (err) {
        return {
          id: mirror.id,
          name: mirror.name,
          baseUrl: mirror.baseUrl,
          resolvedUrl: mirror.baseUrl,
          priority: mirror.priority,
          status: 0,
          ok: false,
          online: false,
          latencyMs: Date.now() - started,
          error: err?.message || "Unreachable"
        };
      }
    })
  );

  const primaryOnline = checks.find(c => c.online);
  if (primaryOnline?.resolvedUrl) {
    try {
      activeResolvedOrigin = new URL(primaryOnline.resolvedUrl).origin;
    } catch {}
  }

  return setCached(
    "server-health",
    {
      ok: true,
      activeMirror: activeResolvedOrigin,
      onlineCount: checks.filter(c => c.online).length,
      totalMirrors: checks.length,
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
    const u = /^https?:\/\//i.test(s) ? new URL(s) : new URL(s, "https://movielinkbd.at");
    const p = u.pathname;
    if (/^\/(?:movie|series|drama|anime)\/[^/]+/i.test(p)) return p;
    return "";
  } catch {
    return "";
  }
}

export function extractCardsFromHtml(html, baseOrigin = activeResolvedOrigin) {
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
    const yearMatch = title.match(/\((19\d\d|20\d\d)\)/);
    const isSeries = /^\/(?:series|drama|anime)\//i.test(itemPath) || /series|drama|episode|s\d+/i.test(`${typeText} ${epBadge}`);
    const isAnime = /^\/anime\//i.test(itemPath) || /anime/i.test(`${typeText} ${title}`);
    const ratingMatch = chunk.match(/★\s*(\d+(?:\.\d+)?)/);

    const builtItem = {
      id: itemPath.split("/").pop() || itemPath,
      path: itemPath,
      title,
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
      year: yearMatch ? yearMatch[1] : "",
      rating: ratingMatch ? ratingMatch[1] : "",
      viewsText: views,
      uploadTime,
      hasResource: !/upcoming|release soon/i.test(quality + " " + title),
      isHindiDubbed: /hindi|dual/i.test(`${language} ${title}`),
      source: "movielinkbd",
      detailsEndpoint: `/api/details?path=${encodeURIComponent(itemPath)}`
    };
    registerMlbdItem(builtItem);
    items.push(builtItem);
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

    const cleanLabel = (rawLabel.replace(/^[^\p{L}\p{N}]+/u, "").trim() || rawLabel).replace(/MovieLinkBD/gi, "MovieStreamBD");
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
    const title = stripTags(titleRaw).replace(/MovieLinkBD/gi, "MovieStreamBD");
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
      sections.push({ id: "mlbd-latest", title: "🔥 MovieStreamBD Latest", categoryPath: "/new", items: fallbackItems, source: "movielinkbd" });
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

  const res = await fetch(`https://movielinkbd.com${clean}`, {
    headers: {
      "User-Agent": MOVIEBOX_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from movielinkbd.com${clean}`);
  const html = await res.text();
  return setCached(cacheKey, html, 180000);
}

function buildMlbdComItem({ title, rawPoster = "", rating = "", year = "", typeText = "", href = "", languageHint = "" }) {
  const cleanTitle = stripTags(title).replace(/<small>[\s\S]*?<\/small>/gi, "").trim();
  if (!cleanTitle) return null;
  const yr = String(year || cleanTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "");
  const isSeries = /^\/(?:series|drama|anime)\//i.test(href) ||
    /series|drama|season|s\d{1,2}|ep\s*\d+/i.test(`${typeText} ${cleanTitle}`);
  const isAnime = /^\/anime\//i.test(href) || /anime/i.test(`${typeText} ${cleanTitle}`);

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
  const regHit = !absPoster ? lookupPosterRegistry(searchTitle, yr) : null;
  const isHindi = /hindi|dual\s*audio/i.test(`${cleanTitle} ${languageHint}`);
  const isBangla = /bangla|bengali/i.test(`${cleanTitle} ${languageHint}`);
  const item = {
    id: itemPath.split("/").pop() || itemPath,
    path: itemPath,
    title: cleanTitle,
    searchTitle,
    poster: absPoster ? mlbdProxyImageUrl(absPoster) : (regHit?.poster || ""),
    rawPoster: absPoster,
    mbSubjectId: regHit?.mbSubjectId || "",
    mbDetailPath: regHit?.mbDetailPath || "",
    quality: /full\s*hd|1080p/i.test(cleanTitle) ? "1080p" : "HD",
    language: languageHint || (isHindi ? "Hindi Dubbed" : isBangla ? "Bangla" : ""),
    type: isAnime ? "anime" : isSeries ? "series" : "movie",
    isSeries,
    isMovie: !isSeries,
    isAnime,
    typeBadge: isAnime ? "Anime" : isSeries ? "Series" : "Movie",
    year: yr,
    rating: String(rating || regHit?.rating || ""),
    hasResource: !/upcoming|release soon/i.test(cleanTitle),
    isHindiDubbed: isHindi,
    source: "movielinkbd",
    detailsEndpoint: `/api/details?path=${encodeURIComponent(itemPath)}&title=${encodeURIComponent(searchTitle)}`
  };
  registerMlbdItem(item);
  return item;
}

function extractMlbdComCards(html, pagePath = "/") {
  const items = [];
  const seen = new Set();
  const s = String(html || "");
  const langHint = pagePath.includes("hindi-dubbed")
    ? "Hindi Dubbed"
    : pagePath.includes("hindi")
      ? "Hindi"
      : pagePath.includes("bangla-dubbed")
        ? "Bangla Dubbed"
        : pagePath.includes("bangla")
          ? "Bangla"
          : pagePath.includes("korean")
            ? "Korean"
            : pagePath.includes("south-indian")
              ? "South Indian"
              : pagePath.includes("dual-audio")
                ? "Dual Audio"
                : "";

  // 1. Parse .mlbd-cat-card anchors (on /)
  const catChunks = s.split(/<a\s+class="mlbd-cat-card"/i);
  for (let i = 1; i < catChunks.length; i++) {
    const chunk = catChunks[i].slice(0, 1800);
    const href = chunk.match(/href="([^"]+)"/i)?.[1] || "";
    const rawTitle = stripTags(chunk.match(/<span\s+class="mlbd-cat-t"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const rawPoster = chunk.match(/src="(https?:\/\/[^"]+)"/i)?.[1] || "";
    const typeText = stripTags(chunk.match(/<i\s+class="mlbd-cat-type"[^>]*>([\s\S]*?)<\/i>/i)?.[1] || "");
    const rating = stripTags(chunk.match(/<b>\s*★?\s*([^<]+)<\/b>/i)?.[1] || "");
    const built = buildMlbdComItem({ title: rawTitle, rawPoster, rating, typeText, href, languageHint: langHint });
    if (built && !seen.has(built.title.toLowerCase())) {
      seen.add(built.title.toLowerCase());
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
    const built = buildMlbdComItem({ title: rawTitle, rawPoster, rating, typeText, languageHint: langHint });
    if (built && !seen.has(built.title.toLowerCase())) {
      seen.add(built.title.toLowerCase());
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
          if (seen.has(cleanName.toLowerCase())) continue;
          seen.add(cleanName.toLowerCase());
          const built = buildMlbdComItem({
            title: cleanName,
            rawPoster: typeof it.image === "string" ? it.image : "",
            rating: it.aggregateRating?.ratingValue ? String(it.aggregateRating.ratingValue) : "",
            typeText: it["@type"] === "TVSeries" ? "Series" : it["@type"] === "Movie" ? "Movie" : "",
            languageHint: langHint
          });
          if (built) items.push(built);
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
    if (!rawTitle || seen.has(rawTitle.toLowerCase())) continue;
    seen.add(rawTitle.toLowerCase());
    const built = buildMlbdComItem({ title: rawTitle, year: yr, languageHint: langHint });
    if (built) items.push(built);
  }

  return items;
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
    const tokens = tokenizeTitle(q);
    const titleTypes = new Set(["movie", "tvSeries", "tvMiniSeries", "tvMovie", "tvSpecial", "short", "video"]);
    let best = null;
    let bestScore = 0;

    for (const entry of list) {
      const imgUrl = entry?.i?.imageUrl;
      if (!imgUrl) continue;
      if (entry.qid && !titleTypes.has(entry.qid)) continue;
      const sim = titleSimilarityScore(q, entry.l || "");
      const yrMatch = year && entry.y && String(entry.y) === String(year);
      // Single non-numeric foreign titles (e.g. Hercai, Safir) often return translated English titles on IMDb
      const singleForeignOk = tokens.length === 1 && !/\d/.test(q) && Boolean(entry.qid);
      if (sim < 0.45 && !singleForeignOk) continue;

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

async function lookupPosterFromTvMaze(searchTitle) {
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
      if (titleSimilarityScore(searchTitle, show?.name || "") >= 0.5) {
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

async function lookupPosterFromItunes(searchTitle) {
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
      if (titleSimilarityScore(searchTitle, item.trackName || item.collectionName || "") >= 0.55) {
        return { poster: mlbdProxyImageUrl(art.replace("100x100bb", "450x450bb")), rating: "" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function lookupPosterFromWiki(searchTitle) {
  const results = await Promise.all(
    ["en", "bn"].map(async lang => {
      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchTitle)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=420&format=json`;
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
          if (lang === "bn" || titleSimilarityScore(searchTitle, p.title || "") >= 0.55) {
            return { poster: mlbdProxyImageUrl(src), rating: "" };
          }
        }
      } catch {}
      return null;
    })
  );
  return results.find(Boolean) || null;
}

async function lookupPosterFromYouTube(searchTitle, languageHint = "") {
  try {
    const q = `${searchTitle} ${/bangla|bengali/i.test(languageHint) ? "bangla" : ""}`.trim();
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
    const picked = matches.find(m => titleSimilarityScore(searchTitle, m[2]) >= 0.4) || matches[0];
    const vid = picked?.[1] || html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/)?.[1];
    if (!vid) return null;
    return { poster: mlbdProxyImageUrl(`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`), rating: "" };
  } catch {
    return null;
  }
}

async function resolvePosterForSingleQuery(searchTitle, item) {
  const year = String(item?.year || "");
  // 1. MovieBox title-verified match (also attaches playback subjectId!)
  try {
    const res = await handleMovieBoxRoute("search", new URLSearchParams({ q: searchTitle, page: "1" }));
    const candidates = Array.isArray(res?.items) ? res.items : [];
    const matched = candidates
      .map(c => ({ c, score: titleSimilarityScore(searchTitle, c?.title || "") + (year && c?.year === year ? 0.2 : 0) }))
      .filter(x => x.c?.poster && x.score >= 0.55)
      .sort((a, b) => b.score - a.score)[0]?.c;
    if (matched?.poster) {
      return {
        poster: matched.poster,
        rating: matched.rating || "",
        mbSubjectId: matched.subjectId || "",
        mbDetailPath: matched.detailPath || ""
      };
    }
  } catch {}

  // 2. IMDb Suggest + TVMaze + iTunes in parallel
  const [imdbHit, tvHit, itunesHit] = await Promise.all([
    lookupPosterFromImdb(searchTitle, year),
    item?.isSeries ? lookupPosterFromTvMaze(searchTitle) : Promise.resolve(null),
    lookupPosterFromItunes(searchTitle)
  ]);
  const metaHit = imdbHit || tvHit || itunesHit;
  if (metaHit?.poster) return metaHit;

  // 3. Wikipedia & YouTube in parallel for regional Bangla/South-Indian titles
  const [wikiHit, ytHit] = await Promise.all([
    lookupPosterFromWiki(searchTitle),
    lookupPosterFromYouTube(searchTitle, item?.language || "")
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
      const altParts = searchTitle
        .split(/\s*[\/|]\s*/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
      const queries = altParts.length > 1 ? altParts.slice(0, 2) : [searchTitle];

      for (const q of queries) {
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

async function enrichMlbdItemsWithPosters(items = [], maxToEnrich = 24, concurrency = 4) {
  const list = Array.isArray(items) ? items : [];
  // Pass 1: instant in-memory poster registry match
  for (const item of list) {
    if (!item || item.poster) continue;
    const reg = lookupPosterRegistry(item.searchTitle || cleanMlbdSearchTitle(item.title || ""), item.year);
    if (reg?.poster) {
      item.poster = reg.poster;
      if (reg.mbSubjectId && !item.mbSubjectId) item.mbSubjectId = reg.mbSubjectId;
      if (reg.mbDetailPath && !item.mbDetailPath) item.mbDetailPath = reg.mbDetailPath;
      if (reg.rating && !item.rating) item.rating = reg.rating;
      registerMlbdItem(item);
    }
  }

  // Pass 2: bounded async enrichment so shared cPanel/Cloudflare workers stay under socket & subrequest limits
  const needPoster = list.filter(it => it && !it.poster && (it.searchTitle || it.title)).slice(0, maxToEnrich);
  if (!needPoster.length) return list;

  const step = Math.max(1, Math.min(6, Number(concurrency) || 4));
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
  return list;
}

function mapCategoryToMlbdComUrls(rawPath = "/") {
  const p = String(rawPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/new" || p === "/popular" || p.startsWith("/mostwatch") || p === "/top10" || p === "/recently-updated") {
    return ["/", "/movies", "/web-series"];
  }
  if (p === "/all") {
    return ["/", "/movies", "/web-series", "/hindi-movies", "/south-indian-movies", "/korean-drama", "/animation-movies", "/browse/bangla"];
  }
  if (p === "/type/movies") return ["/movies"];
  if (p === "/type/series") return ["/web-series"];
  if (p === "/southindian") return ["/south-indian-movies"];
  if (p === "/anime") return ["/animation-movies"];
  if (p === "/bollywood" || p === "/indian-series" || p === "/language/hindi") {
    return ["/hindi-movies", "/browse/hindi"];
  }
  if (p === "/language/hindi-dubbed" || p === "/language/hindi-dubbed-series") {
    return ["/browse/hindi-dubbed", "/hindi-movies"];
  }
  if (p === "/language/korean") return ["/korean-drama", "/browse/korean"];
  if (p === "/language/bengali" || p === "/language/bangla" || p === "/bengali-series") return ["/browse/bangla"];
  if (p === "/language/bangla-dubbed") return ["/browse/bangla-dubbed"];
  if (p === "/language/japanese-drama" || p === "/language/japanese") return ["/browse/japanese", "/animation-movies"];
  if (p === "/language/urdu") return ["/browse/hindi", "/browse/others"];
  if (p.startsWith("/language/")) {
    const slug = p.slice("/language/".length);
    return [`/browse/${slug}`];
  }
  if (p === "/genre/action") return ["/action-movies", "/browse/genre-action"];
  if (p === "/genre/animation") return ["/animation-movies", "/browse/genre-animation"];
  if (p.startsWith("/genre/")) {
    const slug = p.slice("/genre/".length);
    return [`/browse/genre-${slug}`];
  }
  return ["/", "/movies", "/web-series"];
}

async function getMlbdComCatalog({ path = "/", q = "", page = 1 } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const cleanQ = String(q || "").trim();
  const targetPages = cleanQ
    ? ["/", "/movies", "/web-series", "/hindi-movies", "/south-indian-movies", "/korean-drama", "/animation-movies", "/action-movies", "/browse/bangla", "/browse/hindi-dubbed", "/browse/dual-audio"]
    : mapCategoryToMlbdComUrls(path);

  const settled = await Promise.allSettled(
    targetPages.map(async tp => ({ tp, html: await fetchMlbdComPage(tp) }))
  );

  let all = [];
  const seen = new Set();
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

  if (cleanQ) {
    const tokens = cleanQ.toLowerCase().split(/\s+/).filter(Boolean);
    all = all.filter(it => {
      const hay = `${it.title} ${it.searchTitle || ""} ${it.language || ""}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  const perPage = 24;
  const startIdx = (pageNum - 1) * perPage;
  const slice = all.slice(startIdx, startIdx + perPage);
  await enrichMlbdItemsWithPosters(slice, 12, 4);
  const maxPage = Math.max(1, Math.ceil(all.length / perPage));

  return {
    ok: true,
    source: "movielinkbd",
    activeMirror: "https://movielinkbd.com",
    path,
    upstreamPath: targetPages[0] || "/",
    heading: cleanQ ? `Search: ${cleanQ}` : "MovieStreamBD Library",
    items: slice,
    page: pageNum,
    maxPage,
    totalPages: maxPage,
    hasMore: pageNum < maxPage
  };
}

async function getMlbdComHomeFeed() {
  const specs = [
    { id: "mlbd-latest", title: "🆕 MovieStreamBD Latest Releases", path: "/", categoryPath: "/new" },
    { id: "mlbd-movies", title: "🎬 MovieStreamBD Latest Movies", path: "/movies", categoryPath: "/type/movies" },
    { id: "mlbd-series", title: "📺 MovieStreamBD Web Series", path: "/web-series", categoryPath: "/type/series" },
    { id: "mlbd-hindi", title: "🇮🇳 MovieStreamBD Hindi & Dubbed", path: "/hindi-movies", categoryPath: "/language/hindi" },
    { id: "mlbd-south", title: "💫 MovieStreamBD South Indian", path: "/south-indian-movies", categoryPath: "/southIndian" },
    { id: "mlbd-kdrama", title: "🇰🇷 MovieStreamBD Korean Drama", path: "/korean-drama", categoryPath: "/language/korean" },
    { id: "mlbd-anime", title: "🍥 MovieStreamBD Anime & Animation", path: "/animation-movies", categoryPath: "/anime" },
    { id: "mlbd-action", title: "💥 MovieStreamBD Action Hits", path: "/action-movies", categoryPath: "/genre/action" },
    { id: "mlbd-bangla", title: "🇧🇩 MovieStreamBD Bangla & Dubbed", path: "/browse/bangla", categoryPath: "/language/bangla" },
    { id: "mlbd-hindi-dubbed", title: "🎙️ MovieStreamBD Hindi Dubbed Archive", path: "/browse/hindi-dubbed", categoryPath: "/language/hindi-dubbed" }
  ];

  // Fetch postered pages first so posterRegistry is warm for /browse/* sections
  const htmlResults = await Promise.allSettled(
    specs.map(async s => ({ spec: s, html: await fetchMlbdComPage(s.path) }))
  );

  const parsedSections = [];
  for (const r of htmlResults) {
    if (r.status !== "fulfilled") continue;
    const cards = extractMlbdComCards(r.value.html, r.value.spec.path).slice(0, 24);
    if (cards.length) {
      parsedSections.push({ ...r.value.spec, items: cards });
    }
  }

  // Enrich missing posters with a single bounded pool across sections (avoids socket/subrequest exhaustion)
  await enrichMlbdItemsWithPosters(parsedSections.flatMap(sec => sec.items), 16, 4);

  const sections = parsedSections.map(s => ({
    id: s.id,
    title: s.title,
    categoryPath: s.categoryPath,
    items: s.items,
    source: "movielinkbd"
  }));

  const allItems = sections.flatMap(s => s.items);
  const deduped = [...new Map(allItems.map(it => [it.title.toLowerCase(), it])).values()];
  const banners = deduped.filter(it => it.poster).slice(0, 8);
  const trending = deduped.slice(0, 20);

  return {
    ok: true,
    source: "movielinkbd",
    activeMirror: "https://movielinkbd.com",
    sections,
    trending,
    banners,
    categories: DEFAULT_FALLBACK_CATEGORIES.map(c => ({ ...c, source: "movielinkbd" })),
    totalItems: deduped.length
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
    active: activeMirror === m.baseUrl || (m.id === "mirror3" && activeMirror.includes("movielinkbd.com"))
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
  const cached = getCached("home-feed");
  if (cached) return cached;

  try {
    const page = await mlbdFetchPage("/", { ttlMs: 120000 });
    let sections = extractHomeSections(page.html, page.origin);
    const categories = extractCategoriesFromHtml(page.html);

    if (sections.length <= 1) {
      const extraShelves = [
        { id: "mlbd-new", title: "🆕 NEW & POPULAR", path: "/new" },
        { id: "mlbd-movies", title: "🎬 MOVIES", path: "/type/movies/" },
        { id: "mlbd-series", title: "📺 SERIES & TV SHOWS", path: "/type/series/" },
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
            items: res.value.items.slice(0, 20),
            source: "movielinkbd"
          });
        }
      }
      if (built.length) sections = built;
    }

    const top10Sec = sections.find(s => /top\s*10/i.test(s.title));
    const trendingSec = sections.find(s => s !== top10Sec && /new|popular|recently/i.test(s.title)) || sections.find(s => s !== top10Sec) || sections[0];
    const allItems = sections.flatMap(s => s.items);
    const deduped = [...new Map(allItems.map(it => [it.path, it])).values()];
    const top10Set = new Set((top10Sec?.items || []).map(it => it.path));
    const nonTop10 = deduped.filter(it => !top10Set.has(it.path));
    const trending = trendingSec?.items?.length ? trendingSec.items : (nonTop10.length ? nonTop10.slice(0, 18) : deduped.slice(0, 18));
    const banners = deduped.filter(it => it.poster).slice(0, 8);

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
        totalItems: deduped.length
      },
      120000
    );
  } catch {
    const portalFeed = await getMlbdComHomeFeed();
    return setCached("home-feed", portalFeed, 120000);
  }
}

export async function getMlbdCatalog({ path = "/", q = "", page = 1 } = {}) {
  const pageNum = Math.max(1, Math.min(200, Number(page) || 1));
  const cleanQuery = String(q || "").trim();
  const basePath = normalizeUpstreamPath(path);

  let upstreamPath = "/";
  if (cleanQuery || basePath === "/search" || basePath.startsWith("/search?")) {
    const searchTerm = cleanQuery || new URL("https://x.test" + basePath).searchParams.get("q") || "";
    upstreamPath = pageNum > 1
      ? `/search/page/${pageNum}/?q=${encodeURIComponent(searchTerm)}`
      : `/search/?q=${encodeURIComponent(searchTerm)}`;
  } else if (basePath === "/") {
    upstreamPath = pageNum > 1 ? `/new/page/${pageNum}/` : "/new";
  } else if (basePath === "/new") {
    upstreamPath = pageNum > 1 ? `/new/page/${pageNum}/` : "/new";
  } else {
    const cleanBase = basePath.replace(/\/page\/\d+\/?$/i, "").replace(/\/+$/, "") || "/";
    upstreamPath = pageNum > 1 ? `${cleanBase}/page/${pageNum}/` : `${cleanBase}/`;
  }

  const cacheKey = `catalog:${upstreamPath}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const pageData = await mlbdFetchPage(upstreamPath, { ttlMs: 90000 });
    const items = extractCardsFromHtml(pageData.html, pageData.origin);
    const pagination = extractPagination(pageData.html, pageNum);
    const titleMatch = pageData.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

    return setCached(
      cacheKey,
      {
        ok: true,
        source: "movielinkbd",
        activeMirror: pageData.origin,
        path: basePath,
        upstreamPath,
        heading: titleMatch ? stripTags(titleMatch[1]) : "",
        items,
        ...pagination
      },
      90000
    );
  } catch {
    const portalCat = await getMlbdComCatalog({ path: basePath, q: cleanQuery, page: pageNum });
    return setCached(cacheKey, portalCat, 90000);
  }
}

export async function getMlbdSuggest(rawQuery) {
  const q = String(rawQuery || "").trim();
  if (!q) return { ok: true, query: "", items: [], suggestions: [] };

  const cat = await getMlbdCatalog({ path: "/search", q, page: 1 });
  const items = (cat.items || []).slice(0, 12);
  return {
    ok: true,
    source: "movielinkbd",
    query: q,
    items,
    suggestions: items.map(it => it.title)
  };
}

async function resolveMlbdTitleViaMovieBox(rawPath, hintTitle = "", extraQuery = {}) {
  const cleanPath = String(rawPath || "").trim();
  const regItem = mlbdItemRegistry.get(cleanPath) || mlbdItemRegistry.get(normalizeUpstreamPath(cleanPath));
  const rawSlugTitle = cleanPath
    .replace(/^\/(?:mlbd\/)?(?:movie|series|drama|anime)\//i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(?:19|20)\d{2}(?:\s+\d+)?$/, "")
    .trim();
  const searchName = cleanMlbdSearchTitle(hintTitle || regItem?.searchTitle || regItem?.title || rawSlugTitle);
  if (!searchName) {
    throw new Error("MovieLinkBD title could not be resolved");
  }

  let targetSubjectId = regItem?.mbSubjectId || "";
  let targetDetailPath = regItem?.mbDetailPath || "";

  if (!targetSubjectId) {
    const searchRes = await handleMovieBoxRoute("search", new URLSearchParams({ q: searchName, page: "1" }));
    const candidates = Array.isArray(searchRes?.items) ? searchRes.items : [];
    const wantSeries = regItem?.isSeries ?? /^\/(?:mlbd\/)?(?:series|drama|anime)\//i.test(cleanPath);
    const best =
      candidates.find(c => Boolean(c.isSeries) === Boolean(wantSeries) && c.isHindiDubbed) ||
      candidates.find(c => Boolean(c.isSeries) === Boolean(wantSeries)) ||
      candidates[0];
    if (best) {
      targetSubjectId = best.subjectId || "";
      targetDetailPath = best.detailPath || "";
    }
  }

  const params = new URLSearchParams({
    title: searchName,
    ...(targetSubjectId ? { subjectId: targetSubjectId } : {}),
    ...(targetDetailPath ? { detailPath: targetDetailPath } : {}),
    ...extraQuery
  });
  return { params, regItem, searchName };
}

export async function getMlbdDetails(rawPath, hintTitle = "", extraOpts = {}) {
  const cleanPath = normalizeUpstreamPath(rawPath);
  if (cleanPath === "/") {
    throw new Error("Movie or series path is required");
  }

  const dubLock = extraOpts?.dubLock ? "1" : "0";
  const cacheKey = `details:${cleanPath}:${dubLock}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let page;
  try {
    page = await mlbdFetchPage(cleanPath, { ttlMs: 120000 });
  } catch {
    const { params, regItem } = await resolveMlbdTitleViaMovieBox(rawPath, hintTitle, extraOpts?.dubLock ? { dubLock: "1" } : {});
    const mbDetails = await handleMovieBoxRoute("details", params);
    if (!mbDetails?.detail) {
      throw new Error("MovieLinkBD mirror unreachable and title not found");
    }
    const matchedMb = titleSimilarityScore(regItem?.searchTitle || "", mbDetails.detail.title || "") >= 0.45;
    const detail = {
      ...mbDetails.detail,
      mlbdOriginalPath: rawPath,
      poster: (matchedMb ? mbDetails.detail.poster : "") || regItem?.poster || mbDetails.detail.poster || "",
      source: "movielinkbd-bridge"
    };
    return setCached(cacheKey, { ok: true, source: "movielinkbd", detail }, 120000);
  }

  const html = page.html;

  // 1. Parse JSON-LD / OG metadata
  const ogTitle = stripTags(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] || "");
  const h1Title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const titleTag = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const cleanTitle = (h1Title || ogTitle || titleTag).replace(/\s*\|\s*MovieLinkBD.*$/i, "").replace(/\s*Download\s*$/i, "").trim();

  const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || "";
  const posterCardImg = html.match(/class="[^"]*poster[^"]*"[^>]*>[\s\S]{0,250}?(?:data-src|src)="(https?:\/\/[^"]+)"/i)?.[1] || "";
  const rawPoster = ogImage || posterCardImg;
  const poster = rawPoster ? mlbdProxyImageUrl(rawPoster) : "";

  const ogDesc = stripTags(html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]+)"/i)?.[1] || "");
  const synopsisEl = stripTags(html.match(/<div[^>]+class="[^"]*(?:synopsis|storyline|description|plot)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
  const description = synopsisEl || ogDesc;

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
    try {
      const pUrl = new URL(frameSrc, page.origin);
      const pHeaders = {
        Referer: page.finalUrl,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin"
      };
      if (page.cookies) pHeaders.Cookie = page.cookies;
      const pPage = await fetchMirrorOnce(page.origin, pUrl.pathname + pUrl.search, pHeaders, 14000);
      if (pPage.res.ok && pPage.text) {
        const fetchedPd2 = extractBalancedJson(pPage.text, /window\.__PD2\s*=\s*/i);
        if (fetchedPd2) pd2 = fetchedPd2;
        if (!inlineData) {
          inlineData = extractBalancedJson(pPage.text, /(?:var|let|const|window\.)\s*mlbdInlinePlayerData\s*=\s*/i);
        }
      }
    } catch (err) {
      console.warn("[MovieLinkBD player frame fetch]", err?.message || err);
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
    episodes = [
      {
        label: "Full Video",
        number: 1,
        episodeNumber: 1,
        seasonNumber: 0,
        se: 0,
        ep: 1,
        sources: fallbackSources,
        subtitles: dedupGlobalSubs,
        audioTracks: globalAudio,
        downloadButtons: [...mp4Buttons, ...pageDownloadButtons]
      }
    ];
  }

  const isSeries = /^\/(?:series|anime)\//i.test(cleanPath) || episodes.length > 1;
  const startIdx = Number.isInteger(baseData.startEp) && baseData.startEp >= 0 && baseData.startEp < episodes.length
    ? baseData.startEp
    : 0;
  const year = String(baseData.year || finalTitle.match(/\((19\d\d|20\d\d)\)/)?.[1] || "");

  const detail = {
    source: "movielinkbd",
    id: String(baseData.id || cleanPath.split("/").pop() || cleanPath),
    subjectId: String(baseData.id || cleanPath),
    path: cleanPath,
    detailPath: cleanPath,
    title: finalTitle,
    year,
    poster: baseData.poster ? mlbdProxyImageUrl(baseData.poster) : poster,
    description,
    storyline: description,
    language: String(baseData.langs || ""),
    isMovie: !isSeries,
    isSeries,
    typeBadge: isSeries ? "Series" : "Movie",
    totalEpisodes: episodes.length,
    startEpisodeIndex: startIdx,
    playerToken,
    playerFramePath: frameSrc,
    audioTracks: globalAudio,
    subtitles: dedupGlobalSubs,
    episodes,
    downloadButtons: pageDownloadButtons,
    hasResource: episodes.some(e => e.sources.length > 0 || e.downloadButtons.length > 0)
  };

  return setCached(cacheKey, { ok: true, source: "movielinkbd", detail }, 120000);
}

export async function getMlbdStream({ path = "", se = 0, ep = 1, title = "", dubLock = false } = {}) {
  const { detail } = await getMlbdDetails(path, title, { dubLock });
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

  const episodes = Array.isArray(detail?.episodes) ? detail.episodes : [];
  const targetSe = Number(se) || 0;
  const targetEp = Number(ep) || 0;

  let chosen = episodes.find(e => Number(e.seasonNumber) === targetSe && Number(e.episodeNumber) === targetEp) ||
    episodes.find(e => Number(e.episodeNumber) === targetEp) ||
    episodes[Math.max(0, Math.min(episodes.length - 1, Number(detail.startEpisodeIndex) || 0))] ||
    episodes[0];

  const sources = Array.isArray(chosen?.sources) ? chosen.sources : [];
  const subtitles = Array.isArray(chosen?.subtitles) ? chosen.subtitles : [];
  const audioTracks = Array.isArray(chosen?.audioTracks) ? chosen.audioTracks : [];

  return {
    ok: true,
    source: "movielinkbd",
    stream: {
      sources,
      subtitles,
      audioTracks,
      hasResource: sources.length > 0,
      isTrailer: false
    },
    sources,
    subtitles,
    audioTracks,
    downloadButtons: chosen?.downloadButtons || detail.downloadButtons || [],
    message: sources.length ? "" : "No playable direct stream found for this episode."
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
              /\/(?:hls|m)\//i.test(abs) ||
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
