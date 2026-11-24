const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str) {
  const padded = String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(str).length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function md5Hex(input) {
  const msg = textEncoder.encode(String(input));
  const bitLen = msg.length * 8;
  const padLen = ((56 - ((msg.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(msg.length + 1 + padLen + 8);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, bitLen >>> 0, true);
  view.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(offset + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const sum = (A + F + K[i] + M[g]) >>> 0;
      const rot = ((sum << s[i]) | (sum >>> (32 - s[i]))) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rot) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true);
  out.setUint32(4, b0, true);
  out.setUint32(8, c0, true);
  out.setUint32(12, d0, true);
  return Array.from(new Uint8Array(out.buffer), b => b.toString(16).padStart(2, "0")).join("");
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256Bytes(msgBytes) {
  const bitLen = msgBytes.length * 8;
  const padLen = ((56 - ((msgBytes.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(msgBytes.length + 1 + padLen + 8);
  buf.set(msgBytes);
  buf[msgBytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  view.setUint32(buf.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(32));
  out.setUint32(0, h0, false); out.setUint32(4, h1, false);
  out.setUint32(8, h2, false); out.setUint32(12, h3, false);
  out.setUint32(16, h4, false); out.setUint32(20, h5, false);
  out.setUint32(24, h6, false); out.setUint32(28, h7, false);
  return new Uint8Array(out.buffer);
}

function hmacSha256Base64Url(secret, message) {
  let keyBytes = textEncoder.encode(String(secret));
  if (keyBytes.length > 64) keyBytes = sha256Bytes(keyBytes);
  const blockKey = new Uint8Array(64);
  blockKey.set(keyBytes);
  const oPad = new Uint8Array(64);
  const iPad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    oPad[i] = blockKey[i] ^ 0x5c;
    iPad[i] = blockKey[i] ^ 0x36;
  }
  const msgBytes = textEncoder.encode(String(message));
  const inner = new Uint8Array(64 + msgBytes.length);
  inner.set(iPad);
  inner.set(msgBytes, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(oPad);
  outer.set(innerHash, 64);
  return toBase64Url(sha256Bytes(outer));
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const MOVIEBOX_API = "https://h5-api.aoneroom.com";
export const MOVIEBOX_MIRRORS = [MOVIEBOX_API, "https://moviebox.ph"];
export const MOVIEBOX_SPORT_API = "https://h5-sport-api.aoneroom.com";
export const MOVIEBOX_REFERER = "https://moviebox01.com/";
export const MOVIEBOX_PLAYER_REFERER = "https://movie-box.co/";
export const MOVIEBOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_TOKEN_SECRET = Array.from(
  sha256Bytes(textEncoder.encode("chineverse-media-proxy-v1")),
  b => b.toString(16).padStart(2, "0")
).join("");
let configuredTokenSecret = "";

export function configureMediaSecret(secret) {
  const clean = String(secret || "").trim();
  if (clean) configuredTokenSecret = clean;
}

function getTokenSecret() {
  return configuredTokenSecret || globalThis.process?.env?.MEDIA_PROXY_SECRET || DEFAULT_TOKEN_SECRET;
}

const cache = new Map();
const inFlightFetches = new Map();
const subjectIndex = new Map();
let lastGoodHomeFeed = null;

export const CATEGORIES = [
  { label: "Trending Now", path: "/mostwatch/7d", group: "Collections", icon: "🔥" },
  { label: "Top 10 This Week", path: "/top10", group: "Collections", icon: "🏆" },
  { label: "IMDb Top Rated", path: "/top-rated", group: "Collections", icon: "⭐" },
  { label: "Movies", path: "/type/movies", group: "Collections", icon: "🎬" },
  { label: "Web Series", path: "/type/series", group: "Collections", icon: "📺" },
  { label: "Recently Added", path: "/new", group: "Collections", icon: "🆕" },
  { label: "Recently Updated", path: "/recently-updated", group: "Collections", icon: "🔄" },
  { label: "Short Drama", path: "/shorts", group: "Collections", icon: "⚡" },
  { label: "Upcoming", path: "/upcoming", group: "Collections", icon: "⏳" },
  { label: "Midnight (18+)", path: "/adult18plus", group: "Collections", icon: "🔞" },
  { label: "Hindi Dubbed", path: "/language/hindi-dubbed", group: "Languages & Regions", icon: "🇮🇳" },
  { label: "Hindi Dubbed Web Series", path: "/language/hindi-dubbed-series", group: "Languages & Regions", icon: "🎙️" },
  { label: "Bollywood", path: "/bollywood", group: "Languages & Regions", icon: "🎬" },
  { label: "Hollywood", path: "/language/english", group: "Languages & Regions", icon: "🎥" },
  { label: "South Indian", path: "/southIndian", group: "Languages & Regions", icon: "🌏" },
  { label: "K-Drama", path: "/language/korean", group: "Languages & Regions", icon: "🇰🇷" },
  { label: "C-Drama", path: "/language/chinese", group: "Languages & Regions", icon: "🇨🇳" },
  { label: "J-Drama", path: "/language/japanese-drama", group: "Languages & Regions", icon: "🇯🇵" },
  { label: "Turkish Drama", path: "/language/turkish", group: "Languages & Regions", icon: "🇹🇷" },
  { label: "Indian Web Series", path: "/indian-series", group: "Languages & Regions", icon: "🇮🇳" },
  { label: "Bengali", path: "/language/bengali", group: "Languages & Regions", icon: "🇧🇩" },
  { label: "Bengali Series", path: "/bengali-series", group: "Languages & Regions", icon: "🇧🇩" },
  { label: "Bangla Dubbed", path: "/language/bangla-dubbed", group: "Languages & Regions", icon: "🎧" },
  { label: "Tamil", path: "/language/tamil", group: "Languages & Regions", icon: "🎞️" },
  { label: "Telugu", path: "/language/telugu", group: "Languages & Regions", icon: "🎞️" },
  { label: "Malayalam", path: "/language/malayalam", group: "Languages & Regions", icon: "🎞️" },
  { label: "Punjabi", path: "/language/punjabi", group: "Languages & Regions", icon: "🎵" },
  { label: "Pakistani Drama", path: "/language/urdu", group: "Languages & Regions", icon: "🇵🇰" },
  { label: "Thai Drama", path: "/language/thai", group: "Languages & Regions", icon: "🇹🇭" },
  { label: "Indonesian", path: "/language/indonesian", group: "Languages & Regions", icon: "🇮🇩" },
  { label: "Filipino", path: "/language/filipino", group: "Languages & Regions", icon: "🇵🇭" },
  { label: "Spanish", path: "/language/spanish", group: "Languages & Regions", icon: "🇪🇸" },
  { label: "French", path: "/language/french", group: "Languages & Regions", icon: "🇫🇷" },
  { label: "Anime", path: "/anime", group: "Languages & Regions", icon: "🍥" },
  { label: "Action", path: "/genre/action", group: "Genres", icon: "💥" },
  { label: "Adventure", path: "/genre/adventure", group: "Genres", icon: "🧭" },
  { label: "Animation", path: "/genre/animation", group: "Genres", icon: "🎨" },
  { label: "Adult", path: "/genre/adult", group: "Genres", icon: "💋" },
  { label: "Comedy", path: "/genre/comedy", group: "Genres", icon: "😂" },
  { label: "Crime", path: "/genre/crime", group: "Genres", icon: "🕵️" },
  { label: "Documentary", path: "/genre/documentary", group: "Genres", icon: "📽️" },
  { label: "Drama", path: "/genre/drama", group: "Genres", icon: "🎭" },
  { label: "Erotic", path: "/genre/erotic", group: "Genres", icon: "🔥" },
  { label: "Family", path: "/genre/family", group: "Genres", icon: "👨‍👩‍👧" },
  { label: "History", path: "/genre/history", group: "Genres", icon: "🏛️" },
  { label: "Horror", path: "/genre/horror", group: "Genres", icon: "👻" },
  { label: "Hot (18+)", path: "/genre/hot", group: "Genres", icon: "❤️‍🔥" },
  { label: "Music", path: "/genre/music", group: "Genres", icon: "🎶" },
  { label: "Mystery", path: "/genre/mystery", group: "Genres", icon: "🔍" },
  { label: "Romance", path: "/genre/romance", group: "Genres", icon: "❤️" },
  { label: "Sci-Fi", path: "/genre/sci-fi", group: "Genres", icon: "🚀" },
  { label: "Sport", path: "/genre/sport", group: "Genres", icon: "⚽" },
  { label: "Thriller", path: "/genre/thriller", group: "Genres", icon: "🔪" },
  { label: "War", path: "/genre/war", group: "Genres", icon: "⚔️" }
];

const COUNTRY_LANGUAGE_MAP = {
  "south korea": "Korean",
  korea: "Korean",
  china: "Chinese",
  taiwan: "Chinese",
  "hong kong": "Chinese",
  japan: "Japanese",
  india: "Hindi",
  bangladesh: "Bengali",
  pakistan: "Urdu",
  thailand: "Thai",
  indonesia: "Indonesian",
  philippines: "Filipino",
  "united states": "English",
  "united kingdom": "English",
  canada: "English",
  australia: "English",
  france: "French",
  spain: "Spanish",
  turkey: "Turkish"
};

export function buildMovieBoxHeaders(extra = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const reversed = String(ts).split("").reverse().join("");
  const hash = md5Hex(reversed);
  return {
    "User-Agent": MOVIEBOX_UA,
    Accept: "application/json",
    "Content-Type": "application/json",
    Referer: MOVIEBOX_REFERER,
    "X-Client-Info": JSON.stringify({ timezone: "Asia/Dhaka" }),
    "X-Vip-Restrict": "0",
    "X-No-High-Risk-Restrict": "1",
    "X-Request-Lang": "en",
    "X-Client-Token": `${ts},${hash}`,
    ...extra
  };
}

export function signMediaToken(url) {
  const payload = toBase64Url(textEncoder.encode(String(url)));
  const sig = hmacSha256Base64Url(getTokenSecret(), payload);
  return `${payload}.${sig}`;
}

export function verifyMediaToken(token) {
  const raw = String(token || "");
  const dot = raw.indexOf(".");
  if (dot <= 0) return "";
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = hmacSha256Base64Url(getTokenSecret(), payload);
  if (!timingSafeEqualStr(sig, expected)) return "";
  try {
    const decoded = textDecoder.decode(fromBase64Url(payload));
    const parsed = new URL(decoded);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function proxyImageUrl(rawUrl, filename = "poster.jpg") {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (clean.startsWith("/api/moviebox-image/")) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    const safeName = String(filename || "poster.jpg").replace(/[^a-zA-Z0-9._-]/g, "");
    return `/api/moviebox-image/${safeName || "poster.jpg"}?t=${encodeURIComponent(signMediaToken(parsed.href))}`;
  } catch {
    return "";
  }
}

function setCacheEntry(key, data, ttlMs) {
  if (ttlMs <= 0) return;
  if (cache.size > 900) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function mbFetch(url, options = {}, ttlMs = 0) {
  const method = (options.method || "GET").toUpperCase();
  const cacheKey = `${method}:${url}:${options.body || ""}`;
  if (ttlMs > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
  }
  if (inFlightFetches.has(cacheKey)) {
    return await inFlightFetches.get(cacheKey);
  }

  const run = (async () => {
    const isMainApi = url.startsWith(MOVIEBOX_API);
    const hosts = isMainApi ? MOVIEBOX_MIRRORS : [null];
    let lastJson = null;
    let lastError = null;

    for (let round = 0; round < 2; round++) {
      if (round > 0) {
        await new Promise(r => setTimeout(r, 550 + Math.floor(Math.random() * 350)));
      }
      for (const host of hosts) {
        const targetUrl = host && isMainApi ? host + url.slice(MOVIEBOX_API.length) : url;
        const customHeaders = { ...(options.headers || {}) };
        if (host && host !== MOVIEBOX_API && (!customHeaders.Referer || customHeaders.Referer === MOVIEBOX_REFERER)) {
          customHeaders.Referer = `${host}/`;
        } else if (host && host !== MOVIEBOX_API && customHeaders.Referer?.startsWith(MOVIEBOX_PLAYER_REFERER)) {
          customHeaders.Referer = `${host}/${customHeaders.Referer.slice(MOVIEBOX_PLAYER_REFERER.length)}`;
        }
        try {
          const response = await fetch(targetUrl, {
            method,
            headers: buildMovieBoxHeaders(customHeaders),
            body: options.body,
            signal: AbortSignal.timeout(options.timeoutMs || 18000)
          });
          const text = await response.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            lastError = new Error(`MovieBox API returned non-JSON (${response.status})`);
            continue;
          }
          lastJson = json;
          if (response.status === 429 || json?.code === 429 || response.status >= 500) {
            continue;
          }
          if (ttlMs > 0 && response.ok && json && json.code === 0) {
            setCacheEntry(cacheKey, json, ttlMs);
          }
          return json;
        } catch (err) {
          lastError = err;
        }
      }
    }
    if (lastJson) return lastJson;
    throw lastError || new Error("MovieBox upstream unavailable");
  })();

  inFlightFetches.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlightFetches.delete(cacheKey);
  }
}

function inferLanguage(subject) {
  const title = String(subject?.title || "");
  const country = String(subject?.countryName || subject?.country || "").toLowerCase();
  const dubs = Array.isArray(subject?.dubs) ? subject.dubs : [];
  const hasHindiDub =
    /\[hindi\]|hindi dub/i.test(title) ||
    dubs.some(d => /hindi|^hi$/i.test(String(d?.lanName || d?.lanCode || d?.language || "")));
  const baseLang = COUNTRY_LANGUAGE_MAP[country] || "";
  if (hasHindiDub && baseLang && baseLang !== "Hindi") {
    return `${baseLang} · Hindi Dubbed`;
  }
  if (hasHindiDub) return "Hindi Dubbed";
  return baseLang || subject?.countryName || "International";
}

export function normalizeSubject(raw, extra = {}) {
  if (!raw || typeof raw !== "object") return null;
  const s = raw.subject && typeof raw.subject === "object" ? { ...raw.subject, ...raw, title: raw.title || raw.subject.title } : raw;
  const subjectId = String(s.subjectId || s.id || "").trim();
  const detailPath = String(s.detailPath || "").trim();
  const title = String(s.title || "").trim();
  if ((!subjectId && !detailPath && !title) || s.webHighRisk === true) return null;

  const subjectType = Number(s.subjectType || 1);
  const genreStr = String(s.genre || "").trim();
  const isAnime =
    extra.isAnime === true ||
    /\banime\b/i.test(genreStr) ||
    (subjectType === 6 && !/music/i.test(genreStr) && /anime|animation/i.test(`${genreStr} ${title}`));
  const type =
    isAnime
      ? "anime"
      : subjectType === 2 || subjectType === 7
        ? "series"
        : "movie";
  const typeBadge =
    isAnime
      ? "Anime"
      : subjectType === 2
        ? "Series"
        : subjectType === 7
          ? "Short Drama"
          : "Movie";

  const rawPoster =
    extra.poster ||
    extra.previewImage ||
    s.cover?.url ||
    s.cover?.thumbnail ||
    (typeof s.cover === "string" ? s.cover : "") ||
    s.verticalPoster?.url ||
    s.horizontalCover?.url ||
    s.image?.url ||
    (typeof s.image === "string" ? s.image : "") ||
    (typeof s.poster === "string" ? s.poster : s.poster?.url || "") ||
    (Array.isArray(s.stills) && s.stills[0]?.url ? s.stills[0].url : "") ||
    "";
  const poster = proxyImageUrl(rawPoster, "poster.jpg");
  const rawTrailer = String(s.trailer?.videoAddress?.url || "").trim();
  const trailerUrl = rawTrailer ? `/api/cinepulse-media?mb=${encodeURIComponent(signMediaToken(rawTrailer))}` : "";
  const hasResource = s.hasResource !== false;
  const path = subjectId
    ? `/mb/${subjectId}/${detailPath || subjectId}`
    : detailPath
      ? `/mb/${detailPath}`
      : "";
  const releaseDate = String(s.releaseDate || s.appointmentDate || "").trim();
  const language = inferLanguage(s);
  const dubs = Array.isArray(s.dubs) ? s.dubs : [];
  const isHindiDubbed =
    extra._hindiCatalog === true ||
    /hindi/i.test(title) ||
    /hindi/i.test(language) ||
    dubs.some(d => /hindi|^hi$/i.test(String(d?.lanName || d?.lanCode || "")));

  const item = {
    id: subjectId || detailPath,
    subjectId,
    detailPath,
    path,
    title: title || "Untitled",
    description: String(s.description || "").trim(),
    storyline: String(s.description || "").trim(),
    hasResource,
    trailerUrl,
    releaseDate,
    year: releaseDate.slice(0, 4),
    duration: Number(s.duration || 0),
    genre: genreStr,
    country: String(s.countryName || s.country || "").trim(),
    rating: String(s.imdbRatingValue || "").trim(),
    views: Number(s.imdbRatingCount || s.appointmentCnt || 0),
    subjectType,
    type,
    mediaType: type,
    typeBadge,
    isMovie: subjectType === 1 && !isAnime,
    isSeries: subjectType === 2 || subjectType === 7,
    isAnime,
    quality: String(s.corner || "").trim() || "1080p",
    language,
    dubs,
    isHindiDubbed,
    _hindiCatalog: isHindiDubbed,
    _latestFeed: true,
    _dramaCatalog: subjectType === 2 || subjectType === 7,
    _koreanCatalog: /korea/i.test(String(s.countryName || "")),
    _animeCatalog: isAnime,
    ...extra,
    poster,
    previewImage: poster,
    posterUrl: poster,
    cover: poster
  };

  if (subjectId) {
    subjectIndex.set(subjectId, item);
  }
  if (detailPath) {
    subjectIndex.set(detailPath.toLowerCase(), item);
  }
  return item;
}

function indexList(list, extra = {}) {
  return (Array.isArray(list) ? list : [])
    .map(item => normalizeSubject(item, extra))
    .filter(Boolean);
}

function parseMbPath(pathStr) {
  const clean = String(pathStr || "").replace(/^\/+(?:mb|movie|series)\//, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    return { subjectId: parts[0], detailPath: parts.slice(1).join("/") };
  }
  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    return { subjectId: parts[0], detailPath: "" };
  }
  return { subjectId: "", detailPath: parts.join("/") };
}

async function resolveSubjectIdentity({ pathStr = "", subjectId = "", detailPath = "", title = "" }) {
  let sid = String(subjectId || "").trim();
  let dp = String(detailPath || "").trim();
  if (pathStr) {
    const parsed = parseMbPath(pathStr);
    if (!sid && parsed.subjectId) sid = parsed.subjectId;
    if (!dp && parsed.detailPath) dp = parsed.detailPath;
  }
  if (sid && (!dp || dp === sid)) {
    const cached = subjectIndex.get(sid);
    if (cached?.detailPath) dp = cached.detailPath;
  }
  if (!sid && dp) {
    const cached = subjectIndex.get(dp.toLowerCase());
    if (cached?.subjectId) sid = cached.subjectId;
  }
  if (!sid && title) {
    const q = String(title).trim().toLowerCase();
    for (const item of subjectIndex.values()) {
      if (item.title.toLowerCase() === q) {
        sid = item.subjectId;
        dp = item.detailPath;
        break;
      }
    }
  }
  return { subjectId: sid, detailPath: dp };
}

let warmPromise = null;
async function warmSubjectIndexIfNeeded() {
  if (subjectIndex.size >= 240) return;
  if (warmPromise) return await warmPromise;
  warmPromise = (async () => {
    const tasks = [
      () => getHomeFeed(),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=1&perPage=28`, {}, 300000).then(j => indexList(j?.data?.subjectList)),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 1, sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items)),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 2, sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items)),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 2, genre: "Anime", sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items, { isAnime: true })),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 1, country: "India", sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items)),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 2, country: "Korea", sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items)),
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 1, country: "Bangladesh", sort: "Hottest" }) }, 300000).then(j => indexList(j?.data?.items))
    ];
    for (let i = 0; i < tasks.length; i += 3) {
      await Promise.allSettled(tasks.slice(i, i + 3).map(fn => fn()));
    }
  })().finally(() => { warmPromise = null; });
  return await warmPromise;
}

function mapPlatformName(name) {
  const raw = String(name || "").trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = {
    netflix: "Netflix",
    primevideo: "PrimeVideo",
    amazonprime: "PrimeVideo",
    disney: "Disney",
    disneyplus: "Disney",
    appletv: "AppleTV",
    appletvplus: "AppleTV",
    viu: "Viu",
    hulu: "Hulu",
    zee5: "Zee5",
    vivamax: "Vivamax",
    hoichoi: "Hoichoi",
    showmax: "Showmax"
  };
  return map[key] || raw || "Netflix";
}

function parseReleaseTs(item) {
  const candidates = [
    item?.releaseDate,
    item?.appointmentDate,
    item?.uploadedAtMs,
    item?.year && /^\d{4}$/.test(String(item.year)) ? `${item.year}-01-01` : ""
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
    const s = String(raw || "").trim();
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

function sortByReleaseNewest(items) {
  const now = Date.now();
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ta = parseReleaseTs(a);
    const tb = parseReleaseTs(b);
    const aFuture = ta > now;
    const bFuture = tb > now;
    if (aFuture !== bFuture) return aFuture ? 1 : -1;
    if (aFuture && bFuture) return ta - tb;
    if (tb !== ta) return tb - ta;
    return (Number(b?.views) || 0) - (Number(a?.views) || 0);
  });
}

async function getHindiDubbedPool() {
  const cacheKey = "pool:hindi-dubbed-v1";
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  const filterReq = (channelId) =>
    mbFetch(
      `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
      { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId, classify: "Hindi dub", sort: "Latest" }) },
      180000
    ).then(j => indexList(j?.data?.items, { _hindiCatalog: true }).filter(x => x.hasResource !== false));

  const [mRes, sRes] = await Promise.allSettled([filterReq(1), filterReq(2)]);
  const combined = [
    ...(mRes.status === "fulfilled" ? mRes.value : []),
    ...(sRes.status === "fulfilled" ? sRes.value : [])
  ];
  const deduped = [...new Map(combined.filter(x => x && (x.subjectId || x.path)).map(x => [x.subjectId || x.path, x])).values()];
  const sorted = sortByReleaseNewest(deduped);
  if (sorted.length) setCacheEntry(cacheKey, sorted, 180000);
  return sorted;
}

function categoryToFilterBody(category, page = 1) {
  const c = String(category || "").toLowerCase();
  const body = { page, perPage: 24, channelId: 1, sort: "Latest" };
  if (c.includes("series") || c === "/drama" || c.includes("drama") || c === "cv:drama" || c.includes("recently-updated")) {
    body.channelId = 2;
    body.sort = "Latest";
  }
  if (c.includes("anime")) {
    body.channelId = 2;
    body.genre = "Anime";
    body.sort = "Latest";
  }
  if (c.includes("short")) body.channelId = 7;
  if (c.includes("korean")) {
    body.channelId = 2;
    body.country = "Korea";
  } else if (c.includes("chinese")) {
    body.channelId = 2;
    body.country = "China";
  } else if (c.includes("japanese-drama") || c.includes("j-drama")) {
    body.channelId = 2;
    body.country = "Japan";
  } else if (c.includes("japanese")) {
    body.country = "Japan";
  } else if (c.includes("turkish")) {
    body.channelId = 2;
    body.country = "Turkey";
  } else if (c.includes("hindi-dubbed-series")) {
    body.channelId = 2;
    body.classify = "Hindi dub";
  } else if (c.includes("hindi-dubbed") || c.includes("hindi dub")) {
    body.classify = "Hindi dub";
  } else if (c.includes("indian-series")) {
    body.channelId = 2;
    body.country = "India";
  } else if (c.includes("bengali-series")) {
    body.channelId = 2;
    body.country = "Bangladesh";
    body.sort = "Latest";
  } else if (c.includes("tamil") || c.includes("telugu") || c.includes("malayalam") || c.includes("punjabi")) {
    body.country = "India";
    body.sort = "Latest";
  } else if (c.includes("hindi")) {
    body.country = "India";
  } else if (c.includes("bollywood") || c.includes("/trending/india")) {
    body.country = "India";
  } else if (c.includes("bangla-dubbed") || c.includes("bangla dubbed")) {
    body.country = "Bangladesh";
    body.sort = "Latest";
  } else if (c.includes("bangla") || c.includes("bengali") || c.includes("bangladesh")) {
    body.country = "Bangladesh";
    body.sort = "Latest";
  } else if (c.includes("pakistan") || c.includes("urdu")) {
    body.channelId = 2;
    body.country = "Pakistan";
  } else if (c.includes("thai")) {
    body.channelId = 2;
    body.country = "Thailand";
  } else if (c.includes("indonesian")) {
    body.country = "Indonesia";
  } else if (c.includes("filipino")) {
    body.country = "Philippines";
  } else if (c.includes("spanish")) {
    body.channelId = 2;
    body.country = "Spain";
  } else if (c.includes("french")) {
    body.country = "France";
  } else if (c.includes("english") || c.includes("hollywood")) {
    body.country = "United States";
  }
  if (c.startsWith("/genre/")) {
    const rawGenre = (category.split("/").pop() || "").toLowerCase();
    const genreAliases = {
      "sci-fi": "Sci-Fi",
      scifi: "Sci-Fi",
      action: "Action",
      adult: "Adult",
      "18+": "18+",
      "adult18+": "Adult",
      erotic: "Erotic",
      hot: "Hot",
      adventure: "Adventure",
      animation: "Animation",
      comedy: "Comedy",
      crime: "Crime",
      documentary: "Documentary",
      drama: "Drama",
      family: "Family",
      fantasy: "Fantasy",
      history: "History",
      horror: "Horror",
      music: "Music",
      mystery: "Mystery",
      romance: "Romance",
      sport: "Sport",
      thriller: "Thriller",
      war: "War"
    };
    body.genre = genreAliases[rawGenre] || rawGenre.replace(/(^|-)\w/g, m => m.toUpperCase());
  } else if (c.includes("adult18plus") || c === "/midnight" || c === "/18+") {
    body.genre = "Adult";
  }
  return body;
}

export async function getHomeFeed() {
  const filterCall = (body, extra = {}) =>
    mbFetch(
      `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
      { method: "POST", body: JSON.stringify(body) },
      180000
    ).then(j => indexList(j?.data?.items, extra).filter(x => x.hasResource !== false));

  const [
    homeRes,
    trendingRes,
    upcomingRes,
    hindiMoviesRes,
    top10Res,
    latestMoviesRes,
    hindiSeriesRes,
    kDramaRes,
    southIndianRes,
    animeRes,
    hollywoodRes,
    bengaliRes,
    recentlyUpdatedRes
  ] = await Promise.allSettled([
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/home?host=movie-box.co`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=1&perPage=28`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/upcoming-subject-list?page=1&perPage=18`, {}, 300000),
    filterCall({ page: 1, perPage: 18, channelId: 1, classify: "Hindi dub", sort: "Latest" }, { _hindiCatalog: true }),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/ranking-list/content?id=872031290915189720&page=1&perPage=12`, {}, 180000)
      .then(j => indexList(j?.data?.subjectList).filter(x => x.hasResource !== false)),
    filterCall({ page: 1, perPage: 18, channelId: 1, sort: "Latest" }),
    filterCall({ page: 1, perPage: 18, channelId: 2, classify: "Hindi dub", sort: "Latest" }, { _hindiCatalog: true }),
    filterCall({ page: 1, perPage: 18, channelId: 2, country: "Korea", sort: "Latest" }),
    filterCall({ page: 1, perPage: 18, channelId: 1, country: "India", sort: "Latest" }),
    filterCall({ page: 1, perPage: 18, channelId: 2, genre: "Anime", sort: "Latest" }, { isAnime: true, _animeCatalog: true }),
    filterCall({ page: 1, perPage: 18, channelId: 1, country: "United States", sort: "Latest" }),
    filterCall({ page: 1, perPage: 18, channelId: 1, country: "Bangladesh", sort: "Latest" }),
    filterCall({ page: 1, perPage: 18, channelId: 2, sort: "Latest" })
  ]);

  const homeData = homeRes.status === "fulfilled" ? homeRes.value?.data || {} : {};
  const opList = Array.isArray(homeData.operatingList) ? homeData.operatingList : [];

  const banners = [];
  const sections = [];
  const upcoming = [];

  for (const op of opList) {
    if (op.type === "BANNER" && Array.isArray(op.banner?.items)) {
      for (const b of op.banner.items) {
        const bannerRawImg = b.image?.url || b.subject?.cover?.url || "";
        const item = normalizeSubject(b.subject || b, {
          poster: proxyImageUrl(bannerRawImg, "poster.jpg"),
          previewImage: proxyImageUrl(bannerRawImg, "poster.jpg")
        });
        if (item && item.subjectId && /^\d+$/.test(item.subjectId) && item.hasResource !== false) banners.push(item);
      }
    } else if (op.type === "SUBJECTS_MOVIE" && Array.isArray(op.subjects) && op.subjects.length) {
      const title = String(op.title || "Featured").trim();
      if (/nollywood|black shows/i.test(title)) continue;
      const items = sortByReleaseNewest(indexList(op.subjects).filter(x => x.hasResource !== false));
      if (items.length) {
        sections.push({
          title,
          badge: "MOVIEBOX LIVE",
          categoryPath: /k-drama/i.test(title)
            ? "/language/korean"
            : /c-drama/i.test(title)
              ? "/language/chinese"
              : /anime/i.test(title)
                ? "/anime"
                : /series/i.test(title)
                  ? "/type/series"
                  : "/type/movies",
          items
        });
      }
    } else if (op.type === "APPOINTMENT_LIST" && Array.isArray(op.subjects)) {
      upcoming.push(...indexList(op.subjects));
    }
  }

  const pick = (res, fallback = []) => (res.status === "fulfilled" && Array.isArray(res.value) && res.value.length ? res.value : fallback);

  const hindiItems = sortByReleaseNewest(pick(hindiMoviesRes));
  if (hindiItems.length) {
    sections.unshift({
      title: "Hindi Dubbed — Movies & Series",
      badge: "HINDI AUDIO",
      categoryPath: "/language/hindi-dubbed",
      items: hindiItems
    });
  }

  const trendingRaw =
    trendingRes.status === "fulfilled"
      ? indexList(trendingRes.value?.data?.subjectList).filter(x => x.hasResource !== false)
      : [];
  const trendingTop10 = trendingRaw.length ? trendingRaw : (lastGoodHomeFeed?.trending || []);
  const trending = sortByReleaseNewest(trendingTop10);
  const rawUpcoming =
    upcomingRes.status === "fulfilled" ? indexList(upcomingRes.value?.data?.items) : [];
  const upcomingList = rawUpcoming.length ? rawUpcoming : (upcoming.length ? upcoming : (lastGoodHomeFeed?.upcoming || []));

  const platforms = Array.isArray(homeData.platformList) && homeData.platformList.length
    ? homeData.platformList.map(p => ({ name: p.name }))
    : (lastGoodHomeFeed?.platforms || []);

  const finalSections = sections.length ? sections : (lastGoodHomeFeed?.sections || []);
  const allPool = [
    ...trending,
    ...pick(top10Res),
    ...hindiItems,
    ...pick(latestMoviesRes),
    ...pick(hollywoodRes),
    ...pick(southIndianRes),
    ...pick(kDramaRes),
    ...finalSections.flatMap(s => s.items || [])
  ];
  const uniqPool = [...new Map(allPool.filter(x => x && (x.subjectId || x.path)).map(x => [x.subjectId || x.path, x])).values()];
  const imdbTopRated = [...uniqPool]
    .filter(x => Number(x.rating) > 0)
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || parseReleaseTs(b) - parseReleaseTs(a))
    .slice(0, 18);

  const curated = {
    trending,
    top10: pick(top10Res, trendingTop10.slice(0, 10)).slice(0, 10),
    hindiMovies: hindiItems,
    latestMovies: sortByReleaseNewest(pick(latestMoviesRes, lastGoodHomeFeed?.curated?.latestMovies || [])),
    hindiSeries: sortByReleaseNewest(pick(hindiSeriesRes, lastGoodHomeFeed?.curated?.hindiSeries || [])),
    kDramas: sortByReleaseNewest(pick(kDramaRes, lastGoodHomeFeed?.curated?.kDramas || [])),
    southIndian: sortByReleaseNewest(pick(southIndianRes, lastGoodHomeFeed?.curated?.southIndian || [])),
    anime: sortByReleaseNewest(pick(animeRes, lastGoodHomeFeed?.curated?.anime || [])),
    hollywood: sortByReleaseNewest(pick(hollywoodRes, lastGoodHomeFeed?.curated?.hollywood || [])),
    bengali: sortByReleaseNewest(pick(bengaliRes, lastGoodHomeFeed?.curated?.bengali || [])),
    recentlyAdded: sortByReleaseNewest(pick(latestMoviesRes, trending)).slice(0, 16),
    recentlyUpdated: sortByReleaseNewest(pick(recentlyUpdatedRes, lastGoodHomeFeed?.curated?.recentlyUpdated || [])),
    imdbTopRated,
    upcoming: upcomingList
  };

  const result = {
    ok: true,
    categories: CATEGORIES,
    platforms,
    banners: banners.length ? banners : (trending.length ? trending.slice(0, 6) : (lastGoodHomeFeed?.banners || [])),
    trending,
    upcoming: upcomingList,
    sections: finalSections,
    curated
  };
  if (sections.length && trendingRaw.length) {
    lastGoodHomeFeed = result;
  }
  return result;
}

export async function handleMovieBoxRoute(legacy, query) {
  switch (legacy) {
    case "home":
      return await getHomeFeed();

    case "categories":
      return { ok: true, categories: CATEGORIES };

    case "trending": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const perPage = Math.min(28, Math.max(1, Number(query.get("perPage") || 24)));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=${page}&perPage=${perPage}`,
        {},
        180000
      );
      const items = sortByReleaseNewest(indexList(j?.data?.subjectList));
      return {
        ok: true,
        items,
        pager: j?.data?.pager || {},
        totalPages: Number(j?.data?.pager?.totalCount ? Math.ceil(j.data.pager.totalCount / perPage) : 5)
      };
    }

    case "ranking": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const perPage = Math.min(24, Math.max(1, Number(query.get("perPage") || 20)));
      const id = String(query.get("id") || "872031290915189720");
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/ranking-list/content?id=${encodeURIComponent(id)}&page=${page}&perPage=${perPage}`,
        {},
        180000
      );
      const items = indexList(j?.data?.subjectList);
      return { ok: true, title: j?.data?.title || "Top Charts", items, pager: j?.data?.pager || {} };
    }

    case "search": {
      const keyword = String(query.get("q") || query.get("keyword") || "").trim();
      const page = Math.max(1, Number(query.get("page") || 1));
      const rawTypes = String(query.get("subjectType") || "0")
        .split(",")
        .map(n => Number(n.trim()))
        .filter(n => Number.isFinite(n) && n > 0);
      const subjectType = rawTypes.length === 1 ? rawTypes[0] : 0;
      if (!keyword) return { ok: true, items: [], page: 1, totalPages: 1 };

      const matchesType = item => {
        if (!rawTypes.length) return true;
        const st = Number(item.subjectType || 1);
        if (rawTypes.includes(st)) return true;
        if (rawTypes.includes(6) && (item.isAnime === true || /anime|animation/i.test(`${item.genre} ${item.typeBadge} ${item.title}`))) return true;
        if (rawTypes.includes(7) && /short/i.test(`${item.typeBadge} ${item.genre}`)) return true;
        return false;
      };

      // 1) Try direct MovieBox subject/search endpoint first
      try {
        const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
          method: "POST",
          body: JSON.stringify({ keyword, page, perPage: 24, subjectType })
        });
        if (j?.code === 0 && Array.isArray(j?.data?.items)) {
          const items = indexList(j.data.items).filter(matchesType);
          return {
            ok: true,
            items,
            pager: j.data.pager || {},
            totalPages: j.data.pager?.hasMore ? page + 1 : page
          };
        }
      } catch {
        // Fall through to suggestion + enriched catalog index search
      }

      // 2) Enriched multi-token + suggest + filter search fallback
      await warmSubjectIndexIfNeeded();
      const lower = keyword.toLowerCase();
      const tokens = lower.split(/\s+/).filter(Boolean);
      const uniq = new Map();

      const scoreItem = item => {
        const titleLower = String(item.title || "").toLowerCase();
        const hay = `${titleLower} ${item.genre} ${item.country} ${item.language} ${item.typeBadge} ${item.description}`.toLowerCase();
        if (titleLower === lower) return 100;
        if (titleLower.startsWith(lower)) return 80;
        if (titleLower.includes(lower)) return 60;
        if (tokens.length > 1 && tokens.every(t => hay.includes(t))) return 40;
        if (hay.includes(lower)) return 25;
        if (rawTypes.includes(6) && /anime/i.test(lower) && (item.isAnime || /animation|anime/i.test(item.genre))) return 20;
        return 0;
      };

      const collectFromIndex = terms => {
        for (const item of subjectIndex.values()) {
          if (!item.subjectId || !matchesType(item)) continue;
          let sc = scoreItem(item);
          if (!sc && Array.isArray(terms) && terms.length) {
            const tLower = item.title.toLowerCase();
            if (terms.some(w => tLower.includes(w))) sc = 35;
          }
          if (sc > 0) {
            const prev = uniq.get(item.subjectId);
            if (!prev || sc > prev._sc) uniq.set(item.subjectId, { ...item, _sc: sc });
          }
        }
      };

      let suggestTerms = [];
      try {
        const sg = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search-suggest`, {
          method: "POST",
          body: JSON.stringify({ keyword, perPage: 10 })
        }, 45000);
        for (const s of sg?.data?.items || []) {
          if (s?.subject) {
            const norm = normalizeSubject(s.subject);
            if (norm?.subjectId && matchesType(norm)) uniq.set(norm.subjectId, { ...norm, _sc: 90 });
          } else if (typeof s?.word === "string" && s.word.trim()) {
            suggestTerms.push(s.word.trim().toLowerCase());
          }
        }
      } catch {}

      collectFromIndex(suggestTerms);

      // If keyword hints at a genre/country/language, also pull live filtered titles on demand
      const dynamicFilters = [];
      if (/hindi/i.test(lower)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 1, classify: "Hindi dub", sort: "Hottest" }, extra: { _hindiCatalog: true } });
      if (/bengali|bangla/i.test(lower)) {
        dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 1, country: "Bangladesh", sort: "Hottest" }, extra: {} });
        dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 2, country: "Bangladesh", sort: "Hottest" }, extra: {} });
      }
      if (/korean|k-?drama/i.test(lower)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 2, country: "Korea", sort: "Hottest" }, extra: {} });
      if (/anime/i.test(lower) || rawTypes.includes(6)) {
        dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 2, genre: "Anime", sort: "Hottest" }, extra: { isAnime: true, _animeCatalog: true } });
        dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 1, genre: "Anime", sort: "Hottest" }, extra: { isAnime: true, _animeCatalog: true } });
      }
      if (/short/i.test(lower) || rawTypes.includes(7)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 7, sort: "Hottest" }, extra: { subjectType: 7 } });
      if (dynamicFilters.length && uniq.size < 12) {
        await Promise.allSettled(
          dynamicFilters.map(df =>
            mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
              method: "POST",
              body: JSON.stringify(df.body)
            }, 120000).then(j => indexList(j?.data?.items, df.extra))
          )
        );
        collectFromIndex(suggestTerms);
      }

      const list = [...uniq.values()]
        .sort((a, b) => (b._sc || 0) - (a._sc || 0) || (b.views || 0) - (a.views || 0))
        .map(({ _sc, ...rest }) => rest);
      return { ok: true, items: list, page: 1, totalPages: 1 };
    }

    case "suggest": {
      const keyword = String(query.get("q") || query.get("keyword") || "").trim();
      const pool = await getHindiDubbedPool().catch(() => []);
      if (!keyword) {
        return { ok: true, items: pool.slice(0, 12) };
      }
      const lower = keyword.toLowerCase();
      const poolMatches = pool.filter(item =>
        `${item.title} ${item.genre} ${item.country} ${item.description}`.toLowerCase().includes(lower)
      );
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/search-suggest`,
        {
          method: "POST",
          body: JSON.stringify({ keyword: `${keyword} hindi`, perPage: 10 })
        },
        45000
      ).catch(() => null);
      const raw = Array.isArray(j?.data?.items) ? j.data.items : [];
      const liveItems = raw
        .map(x => (x?.subject ? normalizeSubject(x.subject, { _hindiCatalog: true }) : null))
        .filter(x => x && (x.isHindiDubbed || /hindi/i.test(`${x.title} ${x.language}`)));
      const merged = sortByReleaseNewest(
        [...new Map([...poolMatches, ...liveItems].map(x => [x.subjectId || x.path || x.title, x])).values()]
      );
      return { ok: true, items: merged.length ? merged : pool.slice(0, 12) };
    }

    case "hot-search": {
      const pool = await getHindiDubbedPool().catch(() => []);
      if (pool.length) {
        const titles = [...new Set(pool.map(x => String(x.title || "").trim()).filter(Boolean))].slice(0, 16);
        return { ok: true, items: titles, subjects: pool.slice(0, 16) };
      }
      return {
        ok: true,
        items: ["Hindi Dubbed Movies", "Hindi Dubbed Series", "South Indian Hindi Dubbed", "Korean Drama Hindi", "Anime Hindi Dub", "Bollywood Hindi"]
      };
    }

    case "filter-options": {
      await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/filter`, {}, 600000).catch(() => null);
      return {
        ok: true,
        languages: ["Hindi", "Korean", "Chinese", "English", "Bengali", "Japanese", "Tamil", "Urdu"],
        types: ["Movie", "Series", "Anime", "Short Drama"],
        genres: ["Action", "Adult", "Adventure", "Animation", "Comedy", "Crime", "Drama", "Erotic", "Family", "Fantasy", "Horror", "Hot", "Mystery", "Romance", "Sci-Fi", "Thriller"]
      };
    }

    case "catalog":
    case "filter": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const cat = String(query.get("category") || query.get("path") || "");
      const lower = cat.toLowerCase();

      if (lower === "/upcoming") {
        return await handleMovieBoxRoute("upcoming", query);
      }
      if (lower === "/shorts" || lower === "/reels") {
        return await handleMovieBoxRoute("shorts", query);
      }
      if (lower === "/mostwatch/7d" || lower === "/new") {
        return await handleMovieBoxRoute("trending", query);
      }
      if (lower === "/top10") {
        const home = await getHomeFeed();
        const items = Array.isArray(home?.curated?.top10) && home.curated.top10.length
          ? home.curated.top10
          : (home?.trending || []).slice(0, 10);
        return { ok: true, items, page: 1, totalPages: 1 };
      }
      if (lower === "/top-rated") {
        const home = await getHomeFeed();
        const items = Array.isArray(home?.curated?.imdbTopRated) && home.curated.imdbTopRated.length
          ? home.curated.imdbTopRated
          : [...(home?.trending || [])].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
        return { ok: true, items, page: 1, totalPages: 1 };
      }
      if (lower.includes("adult18plus") || lower === "/midnight" || lower === "/18+" || lower === "/genre/18+") {
        const calls = [
          { page, perPage: 12, channelId: 1, genre: "Adult", sort: "Latest" },
          { page, perPage: 12, channelId: 1, genre: "Erotic", sort: "Latest" },
          { page, perPage: 12, channelId: 1, genre: "Hot", sort: "Latest" },
          { page, perPage: 12, channelId: 2, genre: "Adult", sort: "Latest" },
          { page, perPage: 12, channelId: 1, classify: "Midnight", sort: "Latest" }
        ];
        if (page === 1) {
          calls.push({ page: 1, perPage: 12, channelId: 1, genre: "18+" });
        }
        const results = await Promise.allSettled([
          ...calls.map(b =>
            mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify(b) }, 120000)
              .then(r => indexList(r?.data?.items).filter(x => x.hasResource !== false))
          ),
          ...(page === 1
            ? [
                mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/platform/play-list?page=1&perPage=6&platform=Vivamax`, {}, 180000)
                  .then(r => {
                    const months = Array.isArray(r?.data?.monthList) ? r.data.monthList : [];
                    return indexList(months.flatMap(m => Array.isArray(m.subjects) ? m.subjects : []), { platform: "Vivamax" });
                  })
              ]
            : [])
        ]);
        const merged = results.flatMap(r => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
        const uniq = [...new Map(merged.filter(x => x && (x.subjectId || x.path)).map(x => [x.subjectId || x.path, x])).values()];
        const items = sortByReleaseNewest(uniq);
        return { ok: true, items, page, totalPages: items.length >= 12 ? page + 1 : page };
      }
      if (lower.includes("southindian") || lower.includes("south-indian")) {
        const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
          method: "POST",
          body: JSON.stringify({ page, perPage: 24, channelId: 1, country: "India", sort: "Latest" })
        }, 120000);
        return { ok: true, items: sortByReleaseNewest(indexList(j?.data?.items)), page, totalPages: j?.data?.pager?.hasMore ? page + 1 : page };
      }

      const body = categoryToFilterBody(cat, page);
      if (query.get("channelId")) body.channelId = Number(query.get("channelId"));
      if (query.get("genre")) body.genre = query.get("genre");
      if (query.get("country")) body.country = query.get("country");
      if (query.get("year")) body.year = query.get("year");
      if (query.get("sort")) body.sort = query.get("sort");
      if (query.get("classify")) body.classify = query.get("classify");

      const extra = {
        ...(body.classify === "Hindi dub" ? { _hindiCatalog: true } : {}),
        ...(lower.includes("anime") ? { isAnime: true, _animeCatalog: true } : {})
      };
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
        { method: "POST", body: JSON.stringify(body) },
        120000
      );
      let items = indexList(j?.data?.items, extra).filter(x => x.hasResource !== false);

      // Regional Indian language matching (Tamil, Telugu, Malayalam, Punjabi)
      const regionalMatch = /\/language\/(tamil|telugu|malayalam|punjabi)/i.exec(lower);
      if (regionalMatch) {
        const langWord = regionalMatch[1];
        const kwRegex = new RegExp(langWord, "i");
        const searchHits = await handleMovieBoxRoute("search", new URLSearchParams({ q: langWord, page: String(page) })).catch(() => null);
        const exactRegional = [
          ...(Array.isArray(searchHits?.items) ? searchHits.items : []),
          ...items.filter(x => kwRegex.test(`${x.title} ${x.description} ${x.language} ${x.genre}`))
        ];
        if (exactRegional.length >= 6) {
          items = [...new Map(exactRegional.map(x => [x.subjectId || x.path, x])).values()];
        } else if (exactRegional.length) {
          items = [...new Map([...exactRegional, ...items].map(x => [x.subjectId || x.path, x])).values()];
        }
      }

      if (lower.includes("anime") && page === 1) {
        const movieAnime = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 12, channelId: 1, genre: "Anime", sort: "Latest" }) },
          120000
        ).catch(() => null);
        const extraAnime = indexList(movieAnime?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraAnime].map(x => [x.subjectId || x.path, x])).values()];
      } else if (body.country === "Bangladesh" && page === 1) {
        const otherChannel = body.channelId === 2 ? 1 : 2;
        const bdExtra = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 18, channelId: otherChannel, country: "Bangladesh", sort: "Latest" }) },
          120000
        ).catch(() => null);
        const extraBd = indexList(bdExtra?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraBd].map(x => [x.subjectId || x.path, x])).values()];
      } else if (body.country === "Turkey" && items.length < 12 && page === 1) {
        const trMovies = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 16, channelId: 1, country: "Turkey", sort: "Latest" }) },
          120000
        ).catch(() => null);
        const extraTr = indexList(trMovies?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraTr].map(x => [x.subjectId || x.path, x])).values()];
      } else if (lower.includes("indian-series") && items.length < 12 && page === 1) {
        const inMore = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 18, channelId: 2, country: "India", sort: "Latest" }) },
          120000
        ).catch(() => null);
        const extraIn = indexList(inMore?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraIn].map(x => [x.subjectId || x.path, x])).values()];
      } else if (/\/genre\/(?:adult|erotic|hot)/i.test(lower)) {
        const ch2 = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ ...body, channelId: 2 }) },
          120000
        ).catch(() => null);
        const extraAdult = indexList(ch2?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraAdult].map(x => [x.subjectId || x.path, x])).values()];
      }

      // Fallback if Bangla Dubbed / Genre / Bangladesh returns empty on primary channel
      if (!items.length && lower.includes("bangla-dubbed")) {
        const bdSearch = await handleMovieBoxRoute("search", new URLSearchParams({ q: "Bangla", page: String(page) })).catch(() => null);
        if (Array.isArray(bdSearch?.items) && bdSearch.items.length) items = bdSearch.items;
      } else if (!items.length && body.genre) {
        const altCh = body.channelId === 2 ? 1 : 2;
        const altRes = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
          method: "POST",
          body: JSON.stringify({ ...body, channelId: altCh })
        }, 120000).catch(() => null);
        items = indexList(altRes?.data?.items, extra).filter(x => x.hasResource !== false);
        if (!items.length) {
          const gSearch = await handleMovieBoxRoute("search", new URLSearchParams({ q: body.genre, page: String(page) })).catch(() => null);
          if (Array.isArray(gSearch?.items) && gSearch.items.length) items = gSearch.items;
        }
      } else if (!items.length && body.country === "Bangladesh") {
        const home = await getHomeFeed();
        items = [...home.trending, ...home.sections.flatMap(s => s.items)].filter(i => /bengali|bangla/i.test(i.language + " " + i.title)).slice(0, 24);
      }
      items = sortByReleaseNewest(items);
      const totalCount = Number(j?.data?.pager?.totalCount || 0);
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / 24)) : (j?.data?.pager?.hasMore ? page + 1 : page);
      return { ok: true, items, page, totalPages, pager: j?.data?.pager || {} };
    }

    case "platform": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const platform = mapPlatformName(query.get("platform") || query.get("name") || "Netflix");
      // MovieBox requires perPage <= 6 (400 Error if > 6)
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/platform/play-list?page=${page}&perPage=6&platform=${encodeURIComponent(platform)}`,
        {},
        180000
      );
      const months = Array.isArray(j?.data?.monthList) ? j.data.monthList : [];
      const rawSubjects = months.flatMap(m => (Array.isArray(m.subjects) ? m.subjects : []));
      const items = sortByReleaseNewest(indexList(rawSubjects, { platform }));
      const totalCount = Number(j?.data?.pager?.totalCount || 0);
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / 6)) : (j?.data?.pager?.hasMore ? page + 1 : page);
      return { ok: true, platform, items, page, totalPages, pager: j?.data?.pager || {} };
    }

    case "upcoming": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/upcoming-subject-list?page=${page}&perPage=24`,
        {},
        300000
      );
      let items = indexList(j?.data?.items);
      if (!items.length && page === 1) {
        const home = await getHomeFeed();
        items = Array.isArray(home.upcoming) ? home.upcoming : [];
      }
      return { ok: true, items, page };
    }

    case "shorts":
    case "reels": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
        {
          method: "POST",
          body: JSON.stringify({ page, perPage: 24, channelId: 7, sort: "Latest" })
        },
        120000
      );
      return { ok: true, items: sortByReleaseNewest(indexList(j?.data?.items)), page };
    }

    case "details": {
      const pathStr = String(query.get("path") || "");
      const title = String(query.get("title") || "");
      const { subjectId, detailPath } = await resolveSubjectIdentity({
        pathStr,
        subjectId: query.get("subjectId") || "",
        detailPath: query.get("detailPath") || "",
        title
      });
      if (!subjectId && !detailPath) {
        return { ok: false, error: "Missing subjectId or detailPath for details lookup." };
      }
      const qs = new URLSearchParams();
      if (detailPath) qs.set("detailPath", detailPath);
      if (subjectId) qs.set("subjectId", subjectId);

      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/detail?${qs.toString()}`, {}, 300000);
      if (j?.code !== 0 || !j?.data?.subject) {
        return { ok: false, error: j?.message || "Title details unavailable." };
      }
      const subj = normalizeSubject(j.data.subject);
      const seasons = Array.isArray(j.data.resource?.seasons) ? j.data.resource.seasons : [];
      const episodes = [];
      const isMovie = subj.subjectType === 1 || (!seasons.length || (seasons.length === 1 && Number(seasons[0].se) === 0));

      if (isMovie) {
        episodes.push({
          label: `${subj.title} (${subj.quality})`,
          number: 1,
          seasonNumber: 0,
          episodeNumber: 1,
          se: 0,
          ep: 0,
          thumbnail: subj.poster,
          kind: "Feature Film",
          sources: []
        });
      } else {
        for (const season of seasons) {
          const se = Number(season.se || 1);
          const maxEp = Math.max(1, Math.min(200, Number(season.maxEp || 1)));
          for (let ep = 1; ep <= maxEp; ep++) {
            episodes.push({
              label: `S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")}`,
              number: ep,
              seasonNumber: se,
              episodeNumber: ep,
              se,
              ep,
              seasonName: `Season ${se}`,
              thumbnail: subj.poster,
              kind: `Season ${se} · Episode ${ep}`,
              sources: []
            });
          }
        }
      }

      const stars = (Array.isArray(j.data.stars) ? j.data.stars : []).map(st => ({
        staffId: String(st.staffId || ""),
        name: st.name || "",
        role: st.character || st.job || st.role || "Cast",
        avatarUrl: proxyImageUrl(st.avatarUrl || "", "avatar.jpg"),
        detailPath: st.detailPath || ""
      }));

      const rawDubs = Array.isArray(j.data.dubs)
        ? j.data.dubs
        : Array.isArray(j.data.subject?.dubs)
          ? j.data.subject.dubs
          : [];
      const dubs = rawDubs.map(d => ({
        subjectId: String(d.subjectId || ""),
        detailPath: String(d.detailPath || ""),
        path: d.subjectId ? `/mb/${d.subjectId}/${d.detailPath || d.subjectId}` : "",
        language: d.lanName || d.lanCode || "Audio",
        lanName: d.lanName || "",
        lanCode: d.lanCode || "",
        original: Boolean(d.original),
        type: Number(d.type ?? 0)
      }));

      return {
        ok: true,
        detail: {
          ...subj,
          dubs,
          staff: stars,
          episodes,
          totalEpisodes: episodes.length,
          postList: j.data.postList || [],
          metadata: j.data.metadata || {}
        }
      };
    }

    case "stream": {
      let { subjectId, detailPath } = await resolveSubjectIdentity({
        pathStr: query.get("path") || "",
        subjectId: query.get("subjectId") || "",
        detailPath: query.get("detailPath") || "",
        title: query.get("title") || ""
      });
      if (!subjectId) {
        return { ok: false, error: "subjectId is required to fetch stream sources." };
      }

      let detJson = null;
      const loadDetail = async () => {
        if (detJson) return detJson;
        try {
          detJson = await mbFetch(
            `${MOVIEBOX_API}/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(subjectId)}`,
            {},
            300000
          );
          if (detJson?.data?.subject?.detailPath && (!detailPath || detailPath === subjectId)) {
            detailPath = String(detJson.data.subject.detailPath).trim();
          }
          if (detJson?.data?.subject) {
            normalizeSubject(detJson.data.subject);
          }
        } catch {}
        return detJson;
      };

      if (!detailPath || detailPath === subjectId) {
        await loadDetail();
      }
      const se = Math.max(0, Number(query.get("se") ?? 0));
      let ep = Math.max(0, Number(query.get("ep") ?? 0));
      const referer = `${MOVIEBOX_PLAYER_REFERER}movies/${detailPath || subjectId}?id=${subjectId}`;
      let lastUpstreamCode = 0;

      const fetchPlay = async (targetSid, targetDp, sNum, eNum, targetRef, allowAltSign = true) => {
        const playCacheKey = `play:${targetSid}:${targetDp}:${sNum}:${eNum}`;
        const cachedPlay = cache.get(playCacheKey);
        if (cachedPlay && cachedPlay.expiresAt > Date.now()) return cachedPlay.data;

        const isPlayableDirect = s => {
          const u = String(s?.url || "").trim();
          if (!u || /\.mpd(?:$|[?#])/i.test(u)) return false;
          if (/\bdash\b/i.test(String(s?.format || s?.mimeType || ""))) return false;
          return true;
        };
        const parseStreamRes = res => {
          if (res?.code) lastUpstreamCode = Number(res.code);
          const d = res?.data || {};
          const direct = [
            ...(Array.isArray(d.streams) ? d.streams : []),
            ...(Array.isArray(d.hls) ? d.hls : [])
          ].filter(isPlayableDirect);
          return { d, direct };
        };

        const u1 = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(targetSid)}&se=${sNum}&ep=${eNum}&detailPath=${encodeURIComponent(targetDp)}&streamSignType=1`;
        const res1 = await mbFetch(u1, { headers: { Referer: targetRef } }, 0);
        const p1 = parseStreamRes(res1);
        if (p1.direct.length) {
          const out = { ...res1, data: { ...p1.d, streams: p1.direct } };
          setCacheEntry(playCacheKey, out, 180000);
          return out;
        }
        if (res1?.code === 429) return res1;

        if (allowAltSign) {
          const u2 = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(targetSid)}&se=${sNum}&ep=${eNum}&detailPath=${encodeURIComponent(targetDp)}`;
          const res2 = await mbFetch(u2, { headers: { Referer: targetRef } }, 0).catch(() => null);
          const p2 = parseStreamRes(res2);
          if (p2.direct.length) {
            const out = { ...res2, data: { ...p2.d, streams: p2.direct } };
            setCacheEntry(playCacheKey, out, 180000);
            return out;
          }
        }

        // Fallback to MovieBox download endpoint if play streams are empty
        const dlUrl = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/download?subjectId=${encodeURIComponent(targetSid)}&se=${sNum}&ep=${eNum}&detailPath=${encodeURIComponent(targetDp)}`;
        const dlRes = await mbFetch(dlUrl, { headers: { Referer: targetRef } }, 0).catch(() => null);
        const downloads = Array.isArray(dlRes?.data?.downloads)
          ? dlRes.data.downloads.filter(x => x?.url && !/\.mpd(?:$|[?#])/i.test(String(x.url)))
          : [];
        if (downloads.length) {
          const mapped = downloads.map(x => ({
            id: x.id || "",
            url: x.url,
            resolutions: String(x.resolution || x.resolutions || "720"),
            size: x.size || "",
            format: "MP4"
          }));
          const out = { ...res1, data: { ...p1.d, streams: mapped, hasResource: true } };
          setCacheEntry(playCacheKey, out, 180000);
          return out;
        }
        return res1;
      };

      const buildCoordCandidates = (sNum, eNum) => {
        const list = [{ se: sNum, ep: eNum }];
        if (sNum === 0 && eNum !== 0) list.push({ se: 0, ep: 0 }, { se: 1, ep: 1 }, { se: 1, ep: eNum });
        else if (sNum === 0 && eNum === 0) list.push({ se: 1, ep: 1 }, { se: 0, ep: 1 }, { se: 1, ep: 0 });
        else if (sNum > 0 && eNum === 0) list.push({ se: sNum, ep: 1 }, { se: 0, ep: 0 }, { se: 0, ep: 1 });
        else if (sNum === 1 && eNum === 1) list.push({ se: 0, ep: 0 }, { se: 0, ep: 1 });
        else if (sNum > 0 && eNum > 1) list.push({ se: 0, ep: eNum });
        return list.filter((c, i, arr) => arr.findIndex(x => x.se === c.se && x.ep === c.ep) === i);
      };

      let streamSubjectId = subjectId;
      let streamDetailPath = detailPath;
      let streamReferer = referer;
      let playJson = null;
      let rawStreams = [];
      let isTrailer = false;

      for (const coord of buildCoordCandidates(se, ep)) {
        playJson = await fetchPlay(subjectId, detailPath, coord.se, coord.ep, referer);
        rawStreams = Array.isArray(playJson?.data?.streams) ? playJson.data.streams : [];
        if (rawStreams.length || playJson?.code === 429) {
          ep = coord.ep;
          break;
        }
      }

      // If empty and detailPath may be stale/missing, resolve canonical detailPath from detail API and retry
      if (!rawStreams.length && lastUpstreamCode !== 429) {
        const prevDp = detailPath;
        const detail = await loadDetail();
        const canonicalDp = String(detail?.data?.subject?.detailPath || "").trim();
        if (canonicalDp && canonicalDp !== prevDp) {
          detailPath = canonicalDp;
          streamDetailPath = canonicalDp;
          streamReferer = `${MOVIEBOX_PLAYER_REFERER}movies/${canonicalDp}?id=${subjectId}`;
          for (const coord of buildCoordCandidates(se, ep)) {
            playJson = await fetchPlay(subjectId, canonicalDp, coord.se, coord.ep, streamReferer);
            rawStreams = Array.isArray(playJson?.data?.streams) ? playJson.data.streams : [];
            if (rawStreams.length || playJson?.code === 429) {
              ep = coord.ep;
              break;
            }
          }
        }
      }

      // If primary subject returned no stream, try alternate dubs (Original / English / Hindi)
      if (!rawStreams.length && lastUpstreamCode !== 429) {
        const detail = await loadDetail();
        const cachedItem = subjectIndex.get(subjectId);
        const rawDubs = Array.isArray(detail?.data?.dubs)
          ? detail.data.dubs
          : Array.isArray(detail?.data?.subject?.dubs)
            ? detail.data.subject.dubs
            : Array.isArray(cachedItem?.dubs)
              ? cachedItem.dubs
              : [];
        const altDubs = rawDubs
          .filter(d => d?.subjectId && String(d.subjectId) !== subjectId)
          .sort((a, b) => {
            const score = x =>
              (x.original || /original/i.test(x.lanName || "") ? 0 : /english|hindi/i.test(x.lanName || "") ? 1 : 2);
            return score(a) - score(b);
          })
          .slice(0, 3);

        for (const altDub of altDubs) {
          const altSid = String(altDub.subjectId);
          const altDp = String(altDub.detailPath || altSid);
          const altRef = `${MOVIEBOX_PLAYER_REFERER}movies/${altDp}?id=${altSid}`;
          for (const coord of buildCoordCandidates(se, ep).slice(0, 2)) {
            const altJson = await fetchPlay(altSid, altDp, coord.se, coord.ep, altRef, false);
            const altStreams = Array.isArray(altJson?.data?.streams) ? altJson.data.streams : [];
            if (altStreams.length) {
              playJson = altJson;
              rawStreams = altStreams;
              streamSubjectId = altSid;
              streamDetailPath = altDp;
              streamReferer = altRef;
              ep = coord.ep;
              break;
            }
            if (altJson?.code === 429) break;
          }
          if (rawStreams.length || lastUpstreamCode === 429) break;
        }
      }

      // If still empty and detail lookup itself failed for a stale/unindexed subjectId, recover via live title search
      const streamTitle = String(query.get("title") || "").trim();
      if (!rawStreams.length && lastUpstreamCode !== 429 && streamTitle && (!detJson || detJson.code !== 0 || !detJson.data?.subject)) {
        try {
          const sj = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
            method: "POST",
            body: JSON.stringify({ keyword: streamTitle, page: 1, perPage: 6, subjectType: 0 })
          });
          const hits = indexList(sj?.data?.items);
          for (const hit of hits.slice(0, 2)) {
            if (!hit?.subjectId || hit.subjectId === subjectId) continue;
            const hDp = hit.detailPath || hit.subjectId;
            const hRef = `${MOVIEBOX_PLAYER_REFERER}movies/${hDp}?id=${hit.subjectId}`;
            for (const coord of buildCoordCandidates(se, ep).slice(0, 2)) {
              const hJson = await fetchPlay(hit.subjectId, hDp, coord.se, coord.ep, hRef, false);
              const hStreams = Array.isArray(hJson?.data?.streams) ? hJson.data.streams : [];
              if (hStreams.length) {
                playJson = hJson;
                rawStreams = hStreams;
                streamSubjectId = hit.subjectId;
                streamDetailPath = hDp;
                streamReferer = hRef;
                ep = coord.ep;
                break;
              }
              if (hJson?.code === 429) break;
            }
            if (rawStreams.length || lastUpstreamCode === 429) break;
          }
        } catch {}
      }

      const sources = rawStreams
        .filter(s => {
          const u = String(s?.url || "").trim();
          return Boolean(u) && !/\.mpd(?:$|[?#])/i.test(u) && !/\bdash\b/i.test(String(s?.format || s?.mimeType || ""));
        })
        .map(s => {
          const res = String(s.resolutions || "720").match(/\d+/)?.[0] || "720";
          const token = signMediaToken(s.url);
          const isHls = /\.m3u8(?:$|[?#])/i.test(String(s.url)) || /hls|m3u8/i.test(String(s.format || ""));
          return {
            id: String(s.id || ""),
            url: isHls
              ? `/api/sports-hls/stream.m3u8?t=${encodeURIComponent(token)}`
              : `/api/cinepulse-media?mb=${encodeURIComponent(token)}&res=${res}`,
            quality: `${res}p`,
            resolution: `${res}p`,
            size: s.size || "",
            format: isHls ? "HLS" : (s.format || "MP4"),
            type: isHls ? "application/vnd.apple.mpegurl" : "video/mp4",
            provider: "MovieBox Direct",
            audioLanguage: ""
          };
        })
        .sort((a, b) => {
          const diff = Number.parseInt(b.quality, 10) - Number.parseInt(a.quality, 10);
          if (diff !== 0) return diff;
          return (a.format === "HLS" ? 1 : 0) - (b.format === "HLS" ? 1 : 0);
        });

      // Fallback to official trailer MP4 for upcoming/unreleased titles that lack full video streams
      if (!sources.length) {
        const detail = await loadDetail();
        const trailerRaw = String(detail?.data?.subject?.trailer?.videoAddress?.url || "").trim();
        if (trailerRaw) {
          isTrailer = true;
          sources.push({
            id: "trailer",
            url: `/api/cinepulse-media?mb=${encodeURIComponent(signMediaToken(trailerRaw))}&res=720`,
            quality: "720p Trailer",
            resolution: "720p",
            size: "",
            format: "MP4",
            type: "video/mp4",
            provider: "Official Trailer",
            audioLanguage: "",
            isTrailer: true
          });
        }
      }

      const fetchCaptionsForStreams = async (targetSubjectId, targetDetailPath, streamsList, targetReferer) => {
        for (const st of streamsList) {
          if (!st?.id) continue;
          try {
            const capUrl = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${encodeURIComponent(st.id)}&subjectId=${encodeURIComponent(targetSubjectId)}&detailPath=${encodeURIComponent(targetDetailPath)}`;
            const capJson = await mbFetch(capUrl, { headers: { Referer: targetReferer } }, 60000);
            const caps = Array.isArray(capJson?.data?.captions) ? capJson.data.captions : [];
            if (caps.length) {
              return caps
                .filter(c => c?.url)
                .map((c, idx) => ({
                  id: String(c.id || idx),
                  url: `/api/moviebox-subtitle/sub-${idx}.vtt?vtt=1&t=${encodeURIComponent(signMediaToken(c.url))}`,
                  label: c.lanName || c.lan || `Subtitle ${idx + 1}`,
                  language: c.lan || "und",
                  delay: Number(c.delay || 0)
                }));
            }
          } catch {}
        }
        return [];
      };

      let subtitles = await fetchCaptionsForStreams(streamSubjectId, streamDetailPath, rawStreams, streamReferer);

      // Many MovieBox dubbed versions omit subtitles on the dub entry while keeping them on Original Audio / sub entries
      if (!subtitles.length && rawStreams.length && lastUpstreamCode !== 429) {
        try {
          const detail = await loadDetail();
          const cachedItem = subjectIndex.get(subjectId);
          let dubs = Array.isArray(detail?.data?.dubs)
            ? detail.data.dubs
            : Array.isArray(detail?.data?.subject?.dubs)
              ? detail.data.subject.dubs
              : Array.isArray(cachedItem?.dubs)
                ? cachedItem.dubs
                : [];
          const fallbackDubs = dubs
            .filter(d => d?.subjectId && String(d.subjectId) !== streamSubjectId)
            .sort((a, b) => {
              const score = x =>
                (x.original || /original/i.test(x.lanName || "") ? 0 : /english sub/i.test(x.lanName || "") ? 1 : 2);
              return score(a) - score(b);
            })
            .slice(0, 2);

          for (const altDub of fallbackDubs) {
            const altSid = String(altDub.subjectId);
            const altDp = String(altDub.detailPath || altSid);
            const altRef = `${MOVIEBOX_PLAYER_REFERER}movies/${altDp}?id=${altSid}`;
            const altPlayJson = await fetchPlay(altSid, altDp, se, ep, altRef, false);
            const altStreams = Array.isArray(altPlayJson?.data?.streams) ? altPlayJson.data.streams : [];
            if (altStreams.length) {
              subtitles = await fetchCaptionsForStreams(altSid, altDp, altStreams, altRef);
              if (subtitles.length) break;
            }
          }
        } catch {}
      }

      const hasRes = playJson?.code === 0
        ? Boolean(playJson?.data?.hasResource ?? (!isTrailer && sources.length > 0))
        : (!isTrailer && sources.length > 0);
      const rateLimited = !sources.length && lastUpstreamCode === 429;
      return {
        ok: true,
        retryable: rateLimited || !sources.length,
        stream: {
          sources,
          subtitles,
          hasResource: hasRes,
          isTrailer,
          vipLocked: Boolean(playJson?.data?.vipLocked)
        },
        sources,
        subtitles,
        message: isTrailer
          ? "Full video not yet released — playing official trailer."
          : rateLimited
            ? "Video server is temporarily busy (rate limit). Please tap Retry in a moment."
            : !sources.length && !hasRes
              ? "This title is marked Upcoming / Unreleased and does not have a playable video yet."
              : !sources.length
                ? "No playable stream URL is available for this episode right now."
                : ""
      };
    }

    case "captions": {
      const subjectId = String(query.get("subjectId") || "");
      const detailPath = String(query.get("detailPath") || "");
      const streamId = String(query.get("id") || query.get("streamId") || "");
      if (!streamId || !subjectId) return { ok: true, captions: [] };
      const capUrl = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${encodeURIComponent(streamId)}&subjectId=${encodeURIComponent(subjectId)}&detailPath=${encodeURIComponent(detailPath)}`;
      const j = await mbFetch(capUrl, {}, 60000);
      const captions = (Array.isArray(j?.data?.captions) ? j.data.captions : []).map((c, idx) => ({
        id: String(c.id || idx),
        lan: c.lan || "und",
        lanName: c.lanName || c.lan || "Subtitle",
        url: `/api/moviebox-subtitle/sub-${idx}.vtt?vtt=1&t=${encodeURIComponent(signMediaToken(c.url))}`,
        delay: Number(c.delay || 0)
      }));
      return { ok: true, captions };
    }

    case "related": {
      const { subjectId } = await resolveSubjectIdentity({
        subjectId: query.get("subjectId") || "",
        title: query.get("title") || ""
      });
      const [recRes, hindiPoolRes] = await Promise.allSettled([
        subjectId
          ? mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/detail-rec?subjectId=${encodeURIComponent(subjectId)}&page=1&perPage=18`, {}, 300000)
          : Promise.resolve(null),
        getHindiDubbedPool()
      ]);
      const recItems = recRes.status === "fulfilled" && recRes.value?.data?.items
        ? indexList(recRes.value.data.items).filter(x => x.isHindiDubbed || /hindi/i.test(`${x.title} ${x.language}`))
        : [];
      const hindiPool = hindiPoolRes.status === "fulfilled" ? hindiPoolRes.value : [];
      const combined = [...recItems, ...hindiPool]
        .filter(x => x && String(x.subjectId || "") !== String(subjectId || ""));
      const deduped = [...new Map(combined.map(x => [x.subjectId || x.path, x])).values()];
      return { ok: true, items: sortByReleaseNewest(deduped).slice(0, 18) };
    }

    case "comments": {
      const subjectId = String(query.get("subjectId") || "");
      const page = Math.max(0, Number(query.get("page") || 1) - 1);
      if (!subjectId) return { ok: true, comments: [] };
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/post/list/subject?id=${encodeURIComponent(subjectId)}&page=${page}&perPage=20`,
        {},
        60000
      );
      const list = Array.isArray(j?.data?.postList) ? j.data.postList : [];
      const comments = list.map(p => ({
        userName: p.user?.nickname || p.user?.name || p.author?.nickname || "Viewer",
        content: p.content || p.title || "",
        createdAt: p.createdAt || p.createTime || ""
      })).filter(c => c.content);
      return { ok: true, comments, pager: j?.data?.pager || {} };
    }

    case "staff": {
      const staffId = String(query.get("staffId") || "");
      const page = Math.max(1, Number(query.get("page") || 1));
      if (!staffId) return { ok: true, staff: {} };
      const [infoRes, listRes] = await Promise.allSettled([
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/staff/staff-related?staffId=${encodeURIComponent(staffId)}`, {}, 300000),
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/staff/subject-list?perPage=24&page=${page}&staffId=${encodeURIComponent(staffId)}`, {}, 300000)
      ]);
      const relatedItems = infoRes.status === "fulfilled" ? infoRes.value?.data?.items || [] : [];
      const person = relatedItems.find(x => String(x.staffId) === staffId) || relatedItems[0] || {};
      const works = listRes.status === "fulfilled" ? indexList(listRes.value?.data?.subjectList || listRes.value?.data?.items) : [];
      return {
        ok: true,
        staff: {
          staffId,
          name: person.name || "Cast & Crew",
          biography: person.description || (works.length ? `Featured in: ${works.slice(0, 6).map(w => w.title).join(", ")}` : "No additional biography available."),
          avatarUrl: proxyImageUrl(person.avatarUrl || "", "avatar.jpg"),
          works
        }
      };
    }

    case "sports":
    case "sports/matches": {
      const j = await mbFetch(`${MOVIEBOX_SPORT_API}/wefeed-h5api-bff/live/match-list-v5`, {}, 30000);
      const list = Array.isArray(j?.data?.list) ? j.data.list : [];
      const rank = s => (s === "MatchIng" ? 0 : s === "MatchNotStart" ? 1 : 2);
      const sorted = [...list].sort((a, b) => rank(a.status) - rank(b.status));
      const channels = sorted.map(m => {
        const t1 = m.team1?.name || "Team A";
        const t2 = m.team2?.name || "Team B";
        const s1 = m.team1?.score ?? "";
        const s2 = m.team2?.score ?? "";
        const scoreText = s1 !== "" && s2 !== "" ? ` (${s1} - ${s2})` : "";
        const isLive = m.status === "MatchIng";
        const rawUrl = m.playPath || "";
        const proxiedUrl = rawUrl
          ? `/api/sports-hls/playlist.m3u8?t=${encodeURIComponent(signMediaToken(rawUrl))}`
          : "";
        return {
          id: String(m.id || ""),
          name: `${t1} vs ${t2}${scoreText}`,
          title: `${t1} vs ${t2}${scoreText}`,
          team1Name: t1,
          team2Name: t2,
          team1Score: s1 !== "" ? String(s1) : "",
          team2Score: s2 !== "" ? String(s2) : "",
          logo: proxyImageUrl(m.team1?.avatar || m.team2?.avatar || "", "team.png"),
          team1Logo: proxyImageUrl(m.team1?.avatar || "", "team1.png"),
          team2Logo: proxyImageUrl(m.team2?.avatar || "", "team2.png"),
          streamUrl: proxiedUrl,
          playUrl: proxiedUrl,
          url: proxiedUrl,
          category: m.team1?.type || m.type || "Football",
          sportType: m.type || m.team1?.type || "Sports",
          leagueName: m.league || m.matchRound || m.type || m.team1?.type || "Live Sports",
          startTime: Number(m.startTime || m.arrangedTime || 0),
          timeDesc: m.timeDesc || "",
          league: isLive
            ? `LIVE · ${m.timeDesc || m.league || "Match in progress"}`
            : m.status === "MatchNotStart"
              ? `Upcoming · ${m.timeDesc || "Scheduled"}`
              : `Ended · ${m.timeDesc || "Full Time"}`,
          quality: isLive ? "LIVE HD" : m.status === "MatchNotStart" ? "SOON" : "ENDED",
          status: m.status || "",
          live: isLive
        };
      });
      return { ok: true, channels, hasMore: Boolean(j?.data?.hasMore) };
    }

    case "sports/leagues": {
      const j = await mbFetch(`${MOVIEBOX_SPORT_API}/wefeed-h5api-bff/live/league-tab`, {}, 120000);
      return { ok: true, leagues: j?.data || [] };
    }

    case "bottom-tabs": {
      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/tab/get-bottom-tab-list`, {}, 600000);
      return { ok: true, bottomTabs: j?.data?.bottomTabs || [] };
    }

    case "app-info": {
      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/app/get-latest-app-pkgs?appName=moviebox`, {}, 600000);
      return { ok: true, packages: j?.data || [] };
    }

    case "me":
      return {
        ok: true,
        account: {
          name: "MovieBox Direct Upstream",
          plan: "Live Main API (h5-api.aoneroom.com)",
          status: "Connected",
          cachedTitles: subjectIndex.size
        }
      };

    case "status":
      return { ok: true, status: "connected", upstream: MOVIEBOX_API, cachedTitles: subjectIndex.size };

    case "updates-24h":
      return await handleMovieBoxRoute("trending", query);

    default:
      return { ok: false, error: `Unknown MovieBox API endpoint: ${legacy}` };
  }
}

export function convertSrtToVtt(rawText) {
  const clean = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return "WEBVTT\n\n";
  if (/^WEBVTT(?:\s|$)/i.test(clean)) return clean;

  const normalizeTs = ts => {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(ts.trim());
    if (!m) return ts.trim();
    const h = String(Number(m[1] || 0)).padStart(2, "0");
    const min = String(Number(m[2])).padStart(2, "0");
    const sec = String(Number(m[3])).padStart(2, "0");
    const ms = String(m[4]).padEnd(3, "0").slice(0, 3);
    return `${h}:${min}:${sec}.${ms}`;
  };

  const blocks = clean.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    const timeIdx = lines.findIndex(l => l.includes("-->"));
    if (timeIdx < 0) continue;
    const timingLine = lines[timeIdx];
    const parts = timingLine.split("-->");
    if (parts.length < 2) continue;
    const start = normalizeTs(parts[0]);
    const restParts = parts[1].trim().split(/\s+/);
    const end = normalizeTs(restParts[0] || "");
    const settings = restParts.slice(1).join(" ");
    const payloadLines = lines.slice(timeIdx + 1).map(l => l.replace(/\{\\an\d+\}/gi, "").trim());
    if (!payloadLines.length) continue;
    cues.push(`${start} --> ${end}${settings ? ` ${settings}` : ""}\n${payloadLines.join("\n")}`);
  }
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
