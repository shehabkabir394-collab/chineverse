import { MOVIEBOX_UA, signMediaToken, verifyMediaToken } from "./moviebox-api.js";

export const MLBD_MIRRORS = [
  { id: "primary", name: "Primary", baseUrl: "https://h5esed.movielinkbd.at", priority: 1 },
  { id: "mirror2", name: "Mirror 2", baseUrl: "https://movielinkbd.at", priority: 2 },
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
let activeResolvedOrigin = "https://h5esed.movielinkbd.at";

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
  return /^\/(?:mlbd\/|movie\/|series\/|anime\/)/i.test(s);
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

async function fetchMirrorOnce(baseUrl, pathWithQuery, extraHeaders = {}, timeoutMs = 14000) {
  const target = new URL(pathWithQuery, baseUrl).href;
  const res = await fetch(target, {
    headers: {
      "User-Agent": MOVIEBOX_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const finalOrigin = new URL(res.url || target).origin;
  const cookies = cookieStringFromResponse(res);
  const text = await res.text();
  return { res, text, finalUrl: res.url || target, finalOrigin, cookies };
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
  const re = /https:\/\/([a-z0-9.-]*movielinkbd\.[a-z]{2,10})/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const origin = `https://${m[1].toLowerCase()}`;
    if (origin === "https://movielinkbd.com" || origin === "https://www.movielinkbd.com" || origin === "https://movielinkbd.at") continue;
    if (!seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}

export async function mlbdFetchPage(upstreamPath = "/", options = {}) {
  const cleanPath = normalizeUpstreamPath(upstreamPath);
  const cacheKey = `page:${cleanPath}`;
  const ttlMs = options.ttlMs ?? 90000;
  if (!options.bypassCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  if (mlbdInFlight.has(cacheKey)) {
    return await mlbdInFlight.get(cacheKey);
  }

  const job = (async () => {
    const candidateBases = [...new Set([
      activeResolvedOrigin,
      ...MLBD_MIRRORS.map(m => m.baseUrl),
      "https://movielinkbd.tv"
    ])];
    const tried = new Set();

    let lastErr = null;
    for (let i = 0; i < candidateBases.length; i++) {
      const base = candidateBases[i];
      if (!base || tried.has(base)) continue;
      tried.add(base);
      try {
        const extra = options.headers || {};
        const out = await fetchMirrorOnce(base, cleanPath, extra, options.timeoutMs || 14000);
        if (out.res.ok && out.text && out.text.length > 400) {
          if (isPortalLandingHtml(out.text)) {
            for (const discovered of extractMirrorOriginsFromPortal(out.text)) {
              if (!tried.has(discovered) && !candidateBases.includes(discovered)) {
                candidateBases.push(discovered);
              }
            }
            lastErr = new Error(`Portal landing or challenge page from ${base}`);
            continue;
          }
          activeResolvedOrigin = out.finalOrigin || base;
          const result = {
            html: out.text,
            finalUrl: out.finalUrl,
            origin: out.finalOrigin,
            cookies: out.cookies,
            mirrorUsed: base
          };
          return setCached(cacheKey, result, ttlMs);
        }
        lastErr = new Error(`HTTP ${out.res.status} from ${base}`);
      } catch (err) {
        lastErr = err;
      }
    }
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
    if (/^\/(?:movie|series|anime)\/[^/]+/i.test(p)) return p;
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
    const hrefMatch = chunk.match(/href="([^"]*\/(?:movie|series|anime)\/[^"]+)"/i);
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
    const isSeries = /^\/(?:series|anime)\//i.test(itemPath) || /series|drama|episode|s\d+/i.test(`${typeText} ${epBadge}`);
    const isAnime = /^\/anime\//i.test(itemPath) || /anime/i.test(`${typeText} ${title}`);
    const ratingMatch = chunk.match(/★\s*(\d+(?:\.\d+)?)/);

    items.push({
      id: itemPath.split("/").pop() || itemPath,
      path: itemPath,
      title,
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
    });
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
    const rawLabel = stripTags(m[2]);
    if (!rawLabel || rawLabel.length > 42 || /show all/i.test(rawLabel)) continue;
    if (seen.has(rawPath)) continue;
    seen.add(rawPath);

    const group = rawPath.startsWith("/language/") || rawPath === "/southIndian"
      ? "Languages & Regions"
      : rawPath.startsWith("/genre/")
        ? "Genres"
        : "Collections";

    const cleanLabel = rawLabel.replace(/^[^\p{L}\p{N}]+/u, "").trim() || rawLabel;
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

function extractHomeSections(html, baseOrigin) {
  const sections = [];
  const railSplits = String(html || "").split(/<section[^>]+class="[^"]*rail-section[^"]*"[^>]*>/i);
  for (let i = 1; i < railSplits.length; i++) {
    const secHtml = railSplits[i].split(/<\/section>/i)[0] || "";
    const titleRaw = secHtml.match(/<h[1-4][^>]*class="[^"]*mlbd-rail-title[^"]*"[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ||
      secHtml.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ||
      "Featured";
    const title = stripTags(titleRaw);
    const items = extractCardsFromHtml(secHtml, baseOrigin);
    if (title && items.length) {
      sections.push({
        id: `mlbd-${i}`,
        title,
        items,
        source: "movielinkbd"
      });
    }
  }

  if (!sections.length) {
    const fallbackItems = extractCardsFromHtml(html, baseOrigin);
    if (fallbackItems.length) {
      sections.push({ id: "mlbd-latest", title: "🔥 MovieLinkBD Latest", items: fallbackItems, source: "movielinkbd" });
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
      provider: "MovieLinkBD Mirror"
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
      provider: "MovieLinkBD Mirror"
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
  const safeBase = String(filenameBase || pd2Fallback?.title || "MovieLinkBD")
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
      provider: "MovieLinkBD Direct MP4",
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
      provider: "MovieLinkBD Multi-Audio HLS",
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
        provider: "MovieLinkBD Player"
      });
    }
  }

  return sources;
}

export async function getMlbdCategories() {
  const cached = getCached("categories");
  if (cached) return cached;

  let categories = [...DEFAULT_FALLBACK_CATEGORIES];
  let activeMirror = activeResolvedOrigin;
  try {
    const page = await mlbdFetchPage("/", { ttlMs: 180000 });
    activeMirror = page.origin;
    const parsed = extractCategoriesFromHtml(page.html);
    if (parsed.length) categories = parsed;
  } catch {}

  const servers = MLBD_MIRRORS.map(m => ({
    ...m,
    active: activeMirror === m.baseUrl || (m.id === "primary" && activeMirror.includes("movielinkbd.at"))
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

  const page = await mlbdFetchPage("/", { ttlMs: 120000 });
  const sections = extractHomeSections(page.html, page.origin);
  const categories = extractCategoriesFromHtml(page.html);

  const top10Sec = sections.find(s => /top\s*10/i.test(s.title));
  const trendingSec = sections.find(s => /new|popular|recently/i.test(s.title)) || sections[0];
  const allItems = sections.flatMap(s => s.items);
  const deduped = [...new Map(allItems.map(it => [it.path, it])).values()];
  const trending = top10Sec?.items?.length ? top10Sec.items : trendingSec?.items || deduped.slice(0, 18);
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
}

export async function getMlbdCatalog({ path = "/", q = "", page = 1 } = {}) {
  const pageNum = Math.max(1, Math.min(200, Number(page) || 1));
  const cleanQuery = String(q || "").trim();
  const basePath = normalizeUpstreamPath(path);

  let upstreamPath = "/";
  if (cleanQuery || basePath === "/search" || basePath.startsWith("/search?")) {
    const searchTerm = cleanQuery || new URL("https://x.test" + basePath).searchParams.get("q") || "";
    upstreamPath = pageNum > 1
      ? `/search/page/${pageNum}?q=${encodeURIComponent(searchTerm)}`
      : `/search?q=${encodeURIComponent(searchTerm)}`;
  } else if (basePath === "/") {
    upstreamPath = pageNum > 1 ? `/new/page/${pageNum}` : "/";
  } else {
    const cleanBase = basePath.replace(/\/page\/\d+\/?$/i, "").replace(/\/+$/, "") || "/";
    upstreamPath = pageNum > 1 ? `${cleanBase}/page/${pageNum}` : cleanBase;
  }

  const cacheKey = `catalog:${upstreamPath}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

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

export async function getMlbdDetails(rawPath) {
  const cleanPath = normalizeUpstreamPath(rawPath);
  if (cleanPath === "/") {
    throw new Error("Movie or series path is required");
  }

  const cacheKey = `details:${cleanPath}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const page = await mlbdFetchPage(cleanPath, { ttlMs: 120000 });
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

export async function getMlbdStream({ path = "", se = 0, ep = 1 } = {}) {
  const { detail } = await getMlbdDetails(path);
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
