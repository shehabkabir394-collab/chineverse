import {
  isNigerianContent,
  isUpcomingUnreleased,
  isNoiseVideoClip,
  isMusicOrClipSubject,
  strictTitleMatchScore,
  splitSearchTitleVariants,
  expandSearchQueryVariants,
  scoreSearchMatch,
  collectTitleSuggestions
} from "./lib/catalog-rules.js";

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
const SUBJECT_INDEX_MAX_ENTRIES = 1500;
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

let mbGuestToken = "";
let mbGuestTokenExp = 0;
let mbGuestTokenPromise = null;

function captureGuestTokenFromResponse(response) {
  try {
    const rawUser = response?.headers?.get?.("x-user");
    if (!rawUser) return;
    const parsed = JSON.parse(rawUser);
    const tok = String(parsed?.token || "").trim();
    if (!tok) return;
    mbGuestToken = tok;
    let expMs = Date.now() + 45 * 60 * 1000;
    const parts = tok.split(".");
    if (parts.length === 3) {
      try {
        const claims = JSON.parse(textDecoder.decode(fromBase64Url(parts[1])));
        if (Number(claims?.exp) > 0) expMs = Number(claims.exp) * 1000 - 60 * 1000;
      } catch {}
    }
    mbGuestTokenExp = expMs;
  } catch {}
}

async function ensureMbGuestToken(forceRefresh = false) {
  if (!forceRefresh && mbGuestToken && Date.now() < mbGuestTokenExp) {
    return mbGuestToken;
  }
  if (!forceRefresh && mbGuestTokenPromise) {
    return await mbGuestTokenPromise;
  }
  mbGuestTokenPromise = (async () => {
    for (const host of MOVIEBOX_MIRRORS) {
      try {
        const res = await fetch(`${host}/wefeed-h5api-bff/subject/search-suggest`, {
          method: "POST",
          headers: buildMovieBoxHeaders({ Referer: `${host}/` }, { useBearer: false }),
          body: JSON.stringify({ keyword: "a", perPage: 1 }),
          signal: AbortSignal.timeout(8000)
        });
        captureGuestTokenFromResponse(res);
        await res.text().catch(() => "");
        if (mbGuestToken) return mbGuestToken;
      } catch {}
    }
    return mbGuestToken;
  })().finally(() => {
    mbGuestTokenPromise = null;
  });
  return await mbGuestTokenPromise;
}

export function buildMovieBoxHeaders(extra = {}, opts = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const reversed = String(ts).split("").reverse().join("");
  const hash = md5Hex(reversed);
  const headers = {
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
  if (opts.useBearer && mbGuestToken) {
    headers.Authorization = `Bearer ${mbGuestToken}`;
    delete headers["X-Client-Token"];
  }
  return headers;
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
    let useBearer = Boolean(options.useBearer || /\/wefeed-h5api-bff\/subject\/search(?:$|[?#])/.test(url));
    if (useBearer) {
      await ensureMbGuestToken();
    }
    let lastJson = null;
    let lastError = null;

    for (let round = 0; round < 2; round++) {
      if (round > 0) {
        await new Promise(r => setTimeout(r, 450 + Math.floor(Math.random() * 250)));
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
            headers: buildMovieBoxHeaders(customHeaders, { useBearer }),
            body: options.body,
            signal: AbortSignal.timeout(options.timeoutMs || 18000)
          });
          captureGuestTokenFromResponse(response);
          const text = await response.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            lastError = new Error(`MovieBox API returned non-JSON (${response.status})`);
            continue;
          }
          lastJson = json;
          if ((response.status === 400 || json?.code === 400) && /invalid token/i.test(`${json?.message || ""} ${json?.reason || ""}`)) {
            await ensureMbGuestToken(true);
            useBearer = true;
            continue;
          }
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

  const isAdult =
    /\b(?:adult|erotic|18\+|xxx|porn|softcore)\b/i.test(`${genreStr} ${title} ${String(extra.platform || "")}`) ||
    /^(?:hot|midnight)$/i.test(genreStr.trim()) ||
    /,\s*hot\b|\bhot\s*,/i.test(genreStr) ||
    /vivamax/i.test(`${genreStr} ${title} ${String(extra.platform || "")}`);

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
    isAdult,
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

  const setBoundedSubjectIndex = (k, val) => {
    if (!k) return;
    if (subjectIndex.has(k)) subjectIndex.delete(k);
    subjectIndex.set(k, val);
    while (subjectIndex.size > SUBJECT_INDEX_MAX_ENTRIES) {
      const oldestKey = subjectIndex.keys().next().value;
      if (!oldestKey) break;
      subjectIndex.delete(oldestKey);
    }
  };
  if (subjectId) {
    setBoundedSubjectIndex(subjectId, item);
  }
  if (detailPath) {
    setBoundedSubjectIndex(detailPath.toLowerCase(), item);
  }
  return item;
}

function indexList(list, extra = {}) {
  return (Array.isArray(list) ? list : [])
    .map(item => normalizeSubject(item, extra))
    .filter(item => item && !isNigerianContent(item));
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
      () => mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 1, country: "Bangladesh", sort: "Latest" }) }, 300000).then(j => indexList(j?.data?.items))
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

function parseReleaseTs(item) {
  const nowLimit = getEndOfTodayMs();
  let bestUpload = 0;
  for (const raw of [item?.uploadedAtMs, item?.uploadTimestamp]) {
    const t = parseFlexibleDateMs(raw);
    if (t > 0 && t <= nowLimit) {
      bestUpload = Math.max(bestUpload, t);
    }
  }
  if (bestUpload === 0 && !item?.fromArchive) {
    for (const raw of [item?.uploadTime, item?.updatedAt, item?.createdAt]) {
      const t = parseFlexibleDateMs(raw);
      if (t > 0 && t <= nowLimit) {
        bestUpload = Math.max(bestUpload, t);
      }
    }
  }

  let bestRelease = 0;
  const candidates = [
    item?.releaseDate,
    item?.appointmentDate,
    item?.year && /^\d{4}$/.test(String(item.year)) ? `${item.year}-01-01` : ""
  ];
  for (const raw of candidates) {
    const str = String(raw || "").trim();
    const normalized = /^(?:19|20)\d{2}$/.test(str) ? `${str}-01-01` : str;
    const t = parseFlexibleDateMs(normalized);
    if (t > 0) {
      bestRelease = t;
      break;
    }
  }

  if (bestUpload > 0 && bestRelease > nowLimit) {
    return bestUpload;
  }
  return Math.max(bestUpload, bestRelease);
}

export function sortByReleaseNewest(items) {
  const futureCutoff = getEndOfTodayMs();
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const ta = parseReleaseTs(a);
    const tb = parseReleaseTs(b);
    const aFuture = ta > futureCutoff;
    const bFuture = tb > futureCutoff;
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
  const body = { page, perPage: 30, channelId: 1, sort: "Latest" };
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
    ).then(j => indexList(j?.data?.items, extra).filter(x => x.hasResource !== false && !isNigerianContent(x)));

  const searchCall = (keyword, perPage = 14) =>
    mbFetch(
      `${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`,
      { method: "POST", body: JSON.stringify({ keyword, page: 1, perPage, subjectType: 0 }) },
      300000
    ).then(j => indexList(j?.data?.items).filter(x => x.hasResource !== false && !isNigerianContent(x)));

  const [
    homeRes,
    trendingRes,
    upcomingRes,
    hindiMoviesRes,
    hindiHottestRes,
    top10Res,
    latestMoviesRes,
    hindiSeriesRes,
    kDramaRes,
    southIndianRes,
    indiaHottestMoviesRes,
    indiaHottestSeriesRes,
    southSeriesRes,
    animeRes,
    animeMoviesRes,
    hollywoodRes,
    bengaliRes,
    bengaliSeriesRes,
    bdSearchTrendingRes,
    recentlyUpdatedRes,
    comedyLatestRes,
    actionLatestRes,
    horrorLatestRes,
    romanceLatestRes,
    fantasyLatestRes,
    cDramaLatestRes
  ] = await Promise.allSettled([
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/home`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=1&perPage=36`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/upcoming-subject-list?page=1&perPage=24`, {}, 300000),
    filterCall({ page: 1, perPage: 36, channelId: 1, classify: "Hindi dub", sort: "Latest" }, { _hindiCatalog: true }),
    filterCall({ page: 1, perPage: 24, channelId: 1, classify: "Hindi dub", sort: "Hottest" }, { _hindiCatalog: true }),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/ranking-list/content?id=872031290915189720&page=1&perPage=15`, {}, 180000)
      .then(j => indexList(j?.data?.subjectList).filter(x => x.hasResource !== false && !isNigerianContent(x))),
    filterCall({ page: 1, perPage: 36, channelId: 1, sort: "Latest" }),
    filterCall({ page: 1, perPage: 36, channelId: 2, classify: "Hindi dub", sort: "Latest" }, { _hindiCatalog: true }),
    filterCall({ page: 1, perPage: 30, channelId: 2, country: "Korea", sort: "Latest" }),
    filterCall({ page: 1, perPage: 30, channelId: 1, country: "India", sort: "Latest" }),
    filterCall({ page: 1, perPage: 28, channelId: 1, country: "India", sort: "Hottest" }),
    filterCall({ page: 1, perPage: 20, channelId: 2, country: "India", sort: "Hottest" }),
    filterCall({ page: 1, perPage: 24, channelId: 2, country: "India", sort: "Latest" }),
    filterCall({ page: 1, perPage: 30, channelId: 2, genre: "Anime", sort: "Latest" }, { isAnime: true, _animeCatalog: true }),
    filterCall({ page: 1, perPage: 20, channelId: 1, genre: "Anime", sort: "Latest" }, { isAnime: true, _animeCatalog: true }),
    filterCall({ page: 1, perPage: 30, channelId: 1, country: "United States", sort: "Latest" }),
    filterCall({ page: 1, perPage: 24, channelId: 1, country: "Bangladesh", sort: "Latest" }),
    filterCall({ page: 1, perPage: 24, channelId: 2, country: "Bangladesh", sort: "Latest" }),
    Promise.allSettled([
      searchCall("Borbaad", 6),
      searchCall("Taandob", 6),
      searchCall("Toofan", 8),
      searchCall("Bangla Natok", 10)
    ]).then(rs =>
      rs
        .flatMap(r => (r.status === "fulfilled" ? r.value : []))
        .filter(x => {
          if (!x || isNoiseVideoClip(x)) return false;
          const regionMeta = `${x.country || ""} ${x.language || ""} ${x.title || ""}`;
          return /\b(?:bangladesh|india|bengali|bangla|hindi|tamil|telugu|malayalam|borbaad|taandob|toofan|natok)\b/i.test(regionMeta);
        })
    ),
    filterCall({ page: 1, perPage: 36, channelId: 2, sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 1, genre: "Comedy", sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 1, genre: "Action", sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 1, genre: "Horror", sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 1, genre: "Romance", sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 2, genre: "Fantasy", sort: "Latest" }),
    filterCall({ page: 1, perPage: 20, channelId: 2, country: "China", sort: "Latest" })
  ]);

  const homeData = homeRes.status === "fulfilled" ? homeRes.value?.data || {} : {};
  const opList = Array.isArray(homeData.operatingList) ? homeData.operatingList : [];

  const pick = (res, fallback = []) => (res.status === "fulfilled" && Array.isArray(res.value) && res.value.length ? res.value : fallback);
  const mergeLists = (...lists) => {
    const out = [];
    const seen = new Set();
    for (const l of lists) {
      for (const x of Array.isArray(l) ? l : []) {
        if (!x || isNigerianContent(x)) continue;
        const k = x?.subjectId || x?.path;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
    }
    return sortByReleaseNewest(out);
  };
  const mergeOrdered = (...lists) => {
    const out = [];
    const seen = new Set();
    for (const l of lists) {
      for (const x of Array.isArray(l) ? l : []) {
        if (!x || isNigerianContent(x)) continue;
        const k = x?.subjectId || x?.path;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  };

  const latestMoviesPool = pick(latestMoviesRes, lastGoodHomeFeed?.curated?.latestMovies || []).filter(x => !isNigerianContent(x));
  const latestSeriesPool = pick(recentlyUpdatedRes, lastGoodHomeFeed?.curated?.recentlyUpdated || []).filter(x => !isNigerianContent(x));
  const southMerged = mergeLists(pick(indiaHottestMoviesRes), pick(southIndianRes), pick(indiaHottestSeriesRes), pick(southSeriesRes));
  const animeMerged = mergeLists(pick(animeRes), pick(animeMoviesRes));
  const bengaliMerged = mergeLists(pick(bengaliRes), pick(bengaliSeriesRes), pick(bdSearchTrendingRes));
  const indiaBangladeshTrending = mergeOrdered(
    pick(bdSearchTrendingRes).slice(0, 8),
    pick(bengaliRes).slice(0, 6),
    pick(bengaliSeriesRes).slice(0, 6),
    pick(indiaHottestMoviesRes).slice(0, 10),
    pick(indiaHottestSeriesRes).slice(0, 8),
    pick(hindiHottestRes).slice(0, 8),
    pick(southIndianRes).slice(0, 8)
  );
  const kDramaPool = sortByReleaseNewest(pick(kDramaRes, lastGoodHomeFeed?.curated?.kDramas || [])).filter(x => !isNigerianContent(x));
  const cDramaPool = sortByReleaseNewest(pick(cDramaLatestRes)).filter(x => !isNigerianContent(x));
  const comedyPool = sortByReleaseNewest(pick(comedyLatestRes)).filter(x => !isNigerianContent(x));
  const actionPool = sortByReleaseNewest(pick(actionLatestRes)).filter(x => !isNigerianContent(x));
  const horrorPool = sortByReleaseNewest(pick(horrorLatestRes)).filter(x => !isNigerianContent(x));
  const romancePool = sortByReleaseNewest(pick(romanceLatestRes)).filter(x => !isNigerianContent(x));
  const fantasyPool = sortByReleaseNewest(pick(fantasyLatestRes)).filter(x => !isNigerianContent(x));
  const currentYear = new Date().getUTCFullYear();
  const minFreshTs = Date.UTC(currentYear - 1, 0, 1);

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
        if (item && item.subjectId && /^\d+$/.test(item.subjectId) && item.hasResource !== false && !isNigerianContent(item)) {
          banners.push(item);
        }
      }
    } else if (op.type === "SUBJECTS_MOVIE" && Array.isArray(op.subjects) && op.subjects.length) {
      const title = String(op.title || "Featured").trim();
      if (isNigerianContent(null, title)) continue;
      const rawItems = indexList(op.subjects).filter(x => x.hasResource !== false && !isNigerianContent(x, title));
      let enriched = rawItems;
      if (/popular\s*series|tv\s*shows/i.test(title)) enriched = mergeLists(latestSeriesPool, rawItems);
      else if (/popular\s*movie/i.test(title)) enriched = mergeLists(latestMoviesPool, rawItems);
      else if (/k-drama/i.test(title)) enriched = mergeLists(kDramaPool, rawItems);
      else if (/c-drama/i.test(title)) enriched = mergeLists(cDramaPool, rawItems);
      else if (/anime/i.test(title)) enriched = mergeLists(animeMerged, rawItems);
      else if (/comedy/i.test(title)) enriched = mergeLists(comedyPool, rawItems);
      else if (/horror/i.test(title)) enriched = mergeLists(horrorPool, rawItems);
      else if (/romance/i.test(title)) enriched = mergeLists(romancePool, rawItems);
      else if (/action/i.test(title)) enriched = mergeLists(actionPool, rawItems);
      else if (/fantasy/i.test(title)) enriched = mergeLists(fantasyPool, rawItems);

      const items = sortByReleaseNewest(enriched);
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
                : /series|shows/i.test(title)
                  ? "/type/series"
                  : /short/i.test(title)
                    ? "/shorts"
                    : /horror/i.test(title)
                      ? "/genre/horror"
                      : /comedy/i.test(title)
                        ? "/genre/comedy"
                        : /romance/i.test(title)
                          ? "/genre/romance"
                          : /action/i.test(title)
                            ? "/genre/action"
                            : /fantasy/i.test(title)
                              ? "/genre/fantasy"
                              : "/type/movies",
          items
        });
      }
    } else if (op.type === "APPOINTMENT_LIST" && Array.isArray(op.subjects)) {
      upcoming.push(...indexList(op.subjects));
    }
  }

  const hindiMoviesList = pick(hindiMoviesRes);
  const hindiSeriesList = pick(hindiSeriesRes);
  const hindiCombined = mergeLists(pick(hindiHottestRes), hindiMoviesList, hindiSeriesList);
  if (hindiCombined.length) {
    sections.unshift({
      title: "Hindi Dubbed — Movies & Series",
      badge: "HINDI AUDIO",
      categoryPath: "/language/hindi-dubbed",
      items: hindiCombined
    });
  }

  const trendingRaw =
    trendingRes.status === "fulfilled"
      ? indexList(trendingRes.value?.data?.subjectList).filter(x => x.hasResource !== false && !isNigerianContent(x))
      : [];
  const trendingTop10 = trendingRaw.length ? trendingRaw : (lastGoodHomeFeed?.trending || []).filter(x => !isNigerianContent(x));
  const trending = mergeOrdered(
    indiaBangladeshTrending.slice(0, 12),
    trendingTop10.slice(0, 12),
    latestMoviesPool.slice(0, 10),
    latestSeriesPool.slice(0, 8)
  );
  const rawUpcoming =
    upcomingRes.status === "fulfilled" ? indexList(upcomingRes.value?.data?.items) : [];
  const upcomingPool = rawUpcoming.length ? rawUpcoming : (upcoming.length ? upcoming : (lastGoodHomeFeed?.upcoming || []));
  const upcomingList = sortByReleaseNewest(
    upcomingPool.filter(x => x && !isNigerianContent(x) && isUpcomingUnreleased(x))
  );

  const platforms = Array.isArray(homeData.platformList) && homeData.platformList.length
    ? homeData.platformList.map(p => ({ name: p.name }))
    : (lastGoodHomeFeed?.platforms || []);

  const finalSections = sections.length ? sections : (lastGoodHomeFeed?.sections || []).filter(s => !isNigerianContent(null, s?.title));
  const allPool = [
    ...indiaBangladeshTrending,
    ...trending,
    ...pick(top10Res),
    ...hindiCombined,
    ...latestMoviesPool,
    ...pick(hollywoodRes),
    ...southMerged,
    ...kDramaPool,
    ...animeMerged,
    ...bengaliMerged,
    ...latestSeriesPool,
    ...finalSections.flatMap(s => s.items || [])
  ].filter(x => x && !isNigerianContent(x));
  const uniqPool = [...new Map(allPool.filter(x => x && (x.subjectId || x.path)).map(x => [x.subjectId || x.path, x])).values()];
  const recentTopRatedPool = uniqPool.filter(x => Number(x.rating) > 0 && parseReleaseTs(x) >= minFreshTs);
  const imdbTopRated = [...(recentTopRatedPool.length >= 10 ? recentTopRatedPool : uniqPool.filter(x => Number(x.rating) > 0))]
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || parseReleaseTs(b) - parseReleaseTs(a))
    .slice(0, 24);

  const curated = {
    indiaBangladeshTrending,
    trending,
    top10: sortByReleaseNewest(pick(top10Res, trendingTop10.slice(0, 10)).filter(x => !isNigerianContent(x)).slice(0, 10)),
    hindiMovies: sortByReleaseNewest(mergeOrdered(pick(hindiHottestRes), hindiMoviesList)),
    latestMovies: sortByReleaseNewest(latestMoviesPool),
    hindiSeries: sortByReleaseNewest(pick(hindiSeriesRes, lastGoodHomeFeed?.curated?.hindiSeries || [])),
    kDramas: kDramaPool,
    southIndian: southMerged,
    anime: animeMerged,
    hollywood: sortByReleaseNewest(pick(hollywoodRes, lastGoodHomeFeed?.curated?.hollywood || [])),
    bengali: bengaliMerged,
    recentlyAdded: mergeLists(latestMoviesPool, latestSeriesPool, trending).slice(0, 30),
    recentlyUpdated: sortByReleaseNewest(latestSeriesPool),
    imdbTopRated,
    upcoming: upcomingList
  };

  const mergedBanners = mergeOrdered(
    banners,
    indiaBangladeshTrending.slice(0, 4),
    trending.slice(0, 6)
  ).filter(x => x && x.poster && x.hasResource !== false && !isNigerianContent(x)).slice(0, 10);

  const result = {
    ok: true,
    categories: CATEGORIES,
    platforms,
    banners: mergedBanners.length ? mergedBanners : (lastGoodHomeFeed?.banners || []).filter(x => !isNigerianContent(x)),
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
      const safeMode = query.get("safe") === "1";
      const rawTypes = String(query.get("subjectType") || "0")
        .split(",")
        .map(n => Number(n.trim()))
        .filter(n => Number.isFinite(n) && n > 0);
      const subjectType = rawTypes.length === 1 ? rawTypes[0] : 0;
      if (!keyword) return { ok: true, items: [], page: 1, totalPages: 1 };

      const matchesType = item => {
        if (!item) return false;
        if (safeMode && item.isAdult) return false;
        if (!rawTypes.length) return true;
        const st = Number(item.subjectType || 1);
        if (rawTypes.includes(st)) return true;
        if (rawTypes.includes(6) && (item.isAnime === true || /\banime\b|animation/i.test(`${item.genre} ${item.typeBadge} ${item.title}`))) return true;
        if (rawTypes.includes(2) && (item.isSeries || item.type === "series")) return true;
        if (rawTypes.includes(7) && /short/i.test(`${item.typeBadge} ${item.genre}`)) return true;
        return false;
      };

      const lower = keyword.toLowerCase().replace(/\s+/g, " ").trim();
      const allowMusicSearch = /\b(?:song|songs|music|ost|pop|lyric|lyrical|remix|album|naat|bhajan|track|audio)\b/i.test(lower);
      const isAdultIntent = /\b(sex|sexual|sexy|porn|porno|pornography|xxx|18\+|adult|erotic|hot|nude|nudity|nsfw|bf|blue\s*film|vivamax|softcore|romance\s*18)\b/i.test(lower);
      const uniq = new Map();

      const dynamicFilters = [];
      const searchTerms = new Set([
        keyword,
        ...expandSearchQueryVariants(keyword),
        ...splitSearchTitleVariants(keyword).slice(0, 3)
      ]);
      if (isAdultIntent && !safeMode) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 1, genre: "Adult", sort: "Latest" }, extra: { isAdult: true } },
          { body: { page, perPage: 24, channelId: 1, genre: "Erotic", sort: "Latest" }, extra: { isAdult: true } },
          { body: { page, perPage: 24, channelId: 1, genre: "Hot", sort: "Latest" }, extra: { isAdult: true } },
          { body: { page, perPage: 20, channelId: 2, genre: "Adult", sort: "Latest" }, extra: { isAdult: true } },
          { body: { page: 1, perPage: 16, channelId: 1, genre: "18+", sort: "Hottest" }, extra: { isAdult: true } }
        );
        searchTerms.add("erotic");
        searchTerms.add("adult");
        searchTerms.add("vivamax");
      }
      if (/\bsouth\b|south\s*indian|tollywood|kollywood|mollywood|sandalwood/i.test(lower)) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 1, country: "India", sort: "Hottest" }, extra: { _southIntent: true } },
          { body: { page, perPage: 18, channelId: 1, country: "India", sort: "Latest" }, extra: { _southIntent: true } },
          { body: { page, perPage: 14, channelId: 2, country: "India", sort: "Hottest" }, extra: { _southIntent: true } }
        );
        searchTerms.add("tamil");
        searchTerms.add("telugu");
        searchTerms.add("malayalam");
      }
      if (/\bhindi\b|dubbed|bollywood/i.test(lower)) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 1, classify: "Hindi dub", sort: "Hottest" }, extra: { _hindiCatalog: true } },
          { body: { page, perPage: 20, channelId: 2, classify: "Hindi dub", sort: "Hottest" }, extra: { _hindiCatalog: true } }
        );
        if (/bollywood/i.test(lower)) {
          dynamicFilters.push({ body: { page, perPage: 24, channelId: 1, country: "India", sort: "Latest" }, extra: {} });
        }
      }
      if (/bengali|bangla|natok|dhallywood|kolkata/i.test(lower)) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 1, country: "Bangladesh", sort: "Latest" }, extra: {} },
          { body: { page, perPage: 24, channelId: 2, country: "Bangladesh", sort: "Latest" }, extra: {} }
        );
      }
      if (/korean|k-?drama|kdrama/i.test(lower)) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 2, country: "Korea", sort: "Hottest" }, extra: {} },
          { body: { page, perPage: 18, channelId: 1, country: "Korea", sort: "Hottest" }, extra: {} }
        );
      }
      if (/chinese|c-?drama|cdrama/i.test(lower)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 2, country: "China", sort: "Hottest" }, extra: {} });
      }
      if (/turkish|t-?drama/i.test(lower)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 2, country: "Turkey", sort: "Hottest" }, extra: {} });
      }
      if (/japanese|j-?drama/i.test(lower)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 2, country: "Japan", sort: "Hottest" }, extra: {} });
      }
      if (/pakistani|urdu/i.test(lower)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 2, country: "Pakistan", sort: "Hottest" }, extra: {} });
      }
      if (/hollywood|english|american/i.test(lower)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 1, country: "United States", sort: "Hottest" }, extra: {} });
      }
      if (/anime|cartoon|manga|animation/i.test(lower) || rawTypes.includes(6)) {
        dynamicFilters.push(
          { body: { page, perPage: 24, channelId: 2, genre: "Anime", sort: "Hottest" }, extra: { isAnime: true, _animeCatalog: true } },
          { body: { page, perPage: 20, channelId: 1, genre: "Animation", sort: "Hottest" }, extra: { isAnime: true, _animeCatalog: true } }
        );
      }
      if (/short|reel/i.test(lower) || rawTypes.includes(7)) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 7, sort: "Hottest" }, extra: { subjectType: 7 } });
      }
      for (const regLang of ["tamil", "telugu", "malayalam", "punjabi", "kannada", "marathi"]) {
        if (lower.includes(regLang)) {
          searchTerms.add(regLang);
          dynamicFilters.push({ body: { page, perPage: 24, channelId: 1, country: "India", sort: "Hottest" }, extra: {} });
        }
      }
      const genreMap = {
        action: "Action", adventure: "Adventure", comedy: "Comedy", crime: "Crime",
        documentary: "Documentary", drama: "Drama", family: "Family", fantasy: "Fantasy",
        history: "History", horror: "Horror", ghost: "Horror", thriller: "Thriller",
        romance: "Romance", love: "Romance", "sci-fi": "Sci-Fi", scifi: "Sci-Fi",
        mystery: "Mystery", war: "War", music: "Music", sport: "Sport"
      };
      for (const [kw, gName] of Object.entries(genreMap)) {
        if (lower.includes(kw)) {
          dynamicFilters.push({ body: { page, perPage: 24, channelId: 1, genre: gName, sort: "Hottest" }, extra: {} });
          dynamicFilters.push({ body: { page, perPage: 16, channelId: 2, genre: gName, sort: "Hottest" }, extra: {} });
        }
      }
      if (/\b(?:series|web\s*series|season)\b/i.test(lower) && !dynamicFilters.length) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 2, sort: "Hottest" }, extra: {} });
      }
      if (/^(?:new|latest|popular)?\s*(?:movie|movies|film|films)$/i.test(lower) && !dynamicFilters.length) {
        dynamicFilters.push({ body: { page, perPage: 24, channelId: 1, sort: "Hottest" }, extra: {} });
      }

      const isCategoryIntent = Boolean(isAdultIntent || dynamicFilters.length || rawTypes.includes(6) || rawTypes.includes(7));

      const hasYearInQuery = /\b(?:19|20)\d\d\b/.test(lower);

      const addCandidate = (item, bonus = 0, opts = {}) => {
        if (!item || (!item.subjectId && !item.path)) return;
        if (isNigerianContent(item)) return;
        if (!allowMusicSearch && isMusicOrClipSubject(item)) return;
        if (!matchesType(item)) return;

        let sc = scoreSearchMatch(item, keyword, { allowBroadMatch: Boolean(opts.fromDirectSearch || isCategoryIntent) });
        if (sc <= 0 && !opts.fromFilterIntent && !opts.fromDirectSearch) {
          return;
        }
        if (sc <= 0 && opts.fromDirectSearch) {
          // Trust direct MovieBox keyword search hit only mildly if multi-word title matches any token or came from exact term
          sc = Math.max(0, opts.isExactTerm ? 58 : 0);
          if (sc <= 0) return;
        }
        sc += bonus;
        if (!hasYearInQuery) {
          const yrNum = Number(item.year) || 0;
          if (yrNum >= 2000) sc += Math.min(18, Math.floor((yrNum - 1995) / 2));
          else if (yrNum > 0 && yrNum < 1990 && item.hasResource === false) sc -= 15;
        }
        if (isAdultIntent && item.isAdult) sc += 45;
        if (sc <= 0) return;
        const key = item.subjectId || item.path;
        const prev = uniq.get(key);
        if (!prev || sc > prev._sc) uniq.set(key, { ...item, _sc: sc });
      };

      const platformMatch = /(netflix|prime\s*video|amazon\s*prime|disney\+?|apple\s*tv|viu|hulu|zee5|vivamax|hoichoi)/i.exec(lower);
      const tasks = [
        ...[...searchTerms].slice(0, 4).map(term =>
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
            method: "POST",
            useBearer: true,
            body: JSON.stringify({ keyword: term, page, perPage: 36, subjectType })
          }, 45000).then(j => ({ kind: "search", term, items: indexList(j?.data?.items) }))
        ),
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search-suggest`, {
          method: "POST",
          body: JSON.stringify({ keyword, perPage: 15 })
        }, 45000).then(sg => ({ kind: "suggest", raw: sg?.data?.items || [] })),
        ...dynamicFilters.slice(0, 6).map(df =>
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
            method: "POST",
            body: JSON.stringify(df.body)
          }, 120000).then(j => ({ kind: "filter", items: indexList(j?.data?.items, df.extra) }))
        )
      ];

      if (platformMatch && !(safeMode && /vivamax/i.test(platformMatch[1]))) {
        const pName = mapPlatformName(platformMatch[1]);
        tasks.push(
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/platform/play-list?page=1&perPage=6&platform=${encodeURIComponent(pName)}`, {}, 180000)
            .then(r => {
              const months = Array.isArray(r?.data?.monthList) ? r.data.monthList : [];
              return { kind: "filter", items: indexList(months.flatMap(m => Array.isArray(m.subjects) ? m.subjects : []), { platform: pName }) };
            })
        );
      } else if (isAdultIntent && !safeMode) {
        tasks.push(
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/platform/play-list?page=1&perPage=6&platform=Vivamax`, {}, 180000)
            .then(r => {
              const months = Array.isArray(r?.data?.monthList) ? r.data.monthList : [];
              return { kind: "filter", items: indexList(months.flatMap(m => Array.isArray(m.subjects) ? m.subjects : []), { platform: "Vivamax", isAdult: true }) };
            })
        );
      }

      const settled = await Promise.allSettled(tasks);
      const suggestTerms = [];
      for (const r of settled) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const res = r.value;
        if (res.kind === "search") {
          const isExactTerm = res.term.toLowerCase() === keyword.toLowerCase();
          res.items.forEach((it, idx) => addCandidate(it, (isExactTerm ? 115 : 88) - Math.min(20, idx), { fromDirectSearch: true, isExactTerm }));
        } else if (res.kind === "suggest") {
          for (const s of res.raw) {
            if (s?.subject) {
              const norm = normalizeSubject(s.subject);
              if (norm) addCandidate(norm, 110, { fromDirectSearch: true, isExactTerm: true });
            } else if (typeof s?.word === "string" && s.word.trim()) {
              suggestTerms.push(s.word.trim());
            }
          }
        } else if (res.kind === "filter") {
          res.items.forEach((it, idx) => addCandidate(it, 75 - Math.min(18, idx * 0.5), { fromFilterIntent: isCategoryIntent }));
        }
      }

      // If user typed 2-3 chars/words and direct search has few results, resolve top autocomplete suggestion word via Bearer search
      if (suggestTerms.length && uniq.size < 6 && keyword.length >= 2) {
        const extraSuggestSearches = suggestTerms
          .filter(w => w.toLowerCase() !== lower && !searchTerms.has(w))
          .slice(0, 2);
        if (extraSuggestSearches.length) {
          const extraSettled = await Promise.allSettled(
            extraSuggestSearches.map(term =>
              mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
                method: "POST",
                useBearer: true,
                body: JSON.stringify({ keyword: term, page: 1, perPage: 16, subjectType })
              }, 45000).then(j => indexList(j?.data?.items))
            )
          );
          for (const er of extraSettled) {
            if (er.status === "fulfilled" && Array.isArray(er.value)) {
              er.value.forEach((it, idx) => addCandidate(it, 82 - Math.min(16, idx), { fromDirectSearch: true, isExactTerm: false }));
            }
          }
        }
      }

      // Warm local index only if results are still sparse (< 6)
      if (uniq.size < 6) {
        await warmSubjectIndexIfNeeded();
      }
      for (const item of subjectIndex.values()) {
        if (isNigerianContent(item)) continue;
        addCandidate(item, 0, { fromFilterIntent: false, fromDirectSearch: false });
      }

      const list = [...uniq.values()]
        .sort((a, b) => (b._sc || 0) - (a._sc || 0) || (b.views || 0) - (a.views || 0) || parseReleaseTs(b) - parseReleaseTs(a))
        .map(({ _sc, _southIntent, ...rest }) => rest)
        .slice(0, 100);

      const suggestions = collectTitleSuggestions(keyword, {
        suggestWords: suggestTerms,
        items: list,
        limit: 15
      });

      return {
        ok: true,
        items: list,
        suggestions,
        page,
        hasMore: list.length >= 30,
        totalPages: list.length >= 30 ? page + 1 : page
      };
    }

    case "suggest": {
      const keyword = String(query.get("q") || query.get("keyword") || "").trim();
      const safeMode = query.get("safe") === "1";
      if (!keyword) {
        const home = await getHomeFeed().catch(() => ({ trending: [] }));
        const base = (home?.trending || []).filter(x => (!safeMode || !x.isAdult) && !isNigerianContent(x)).slice(0, 12);
        return { ok: true, items: base, suggestions: base.map(x => x.title) };
      }
      return await handleMovieBoxRoute("search", new URLSearchParams({
        q: keyword,
        page: "1",
        ...(query.get("subjectType") ? { subjectType: query.get("subjectType") } : {}),
        ...(safeMode ? { safe: "1" } : {})
      }));
    }

    case "hot-search": {
      const safeMode = query.get("safe") === "1";
      const safeFilter = list => (Array.isArray(list) ? list : []).filter(x => x && (!safeMode || !x.isAdult));
      const filterCall = (body, extra = {}) =>
        mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify(body) },
          180000
        ).then(j => indexList(j?.data?.items, extra).filter(x => x.hasResource !== false));

      const [homeRes, movieRes, seriesRes, animeRes, dramaRes] = await Promise.allSettled([
        getHomeFeed(),
        filterCall({ page: 1, perPage: 16, channelId: 1, sort: "Hottest" }),
        filterCall({ page: 1, perPage: 16, channelId: 2, sort: "Hottest" }),
        filterCall({ page: 1, perPage: 16, channelId: 2, genre: "Anime", sort: "Hottest" }, { isAnime: true, _animeCatalog: true }),
        filterCall({ page: 1, perPage: 16, channelId: 2, country: "Korea", sort: "Hottest" })
      ]);

      const home = homeRes.status === "fulfilled" ? homeRes.value : {};
      const movies = safeFilter(movieRes.status === "fulfilled" ? movieRes.value : home?.curated?.latestMovies || []);
      const series = safeFilter(seriesRes.status === "fulfilled" ? seriesRes.value : home?.curated?.hindiSeries || []);
      const anime = safeFilter(animeRes.status === "fulfilled" ? animeRes.value : home?.curated?.anime || []);
      const drama = safeFilter(dramaRes.status === "fulfilled" ? dramaRes.value : home?.curated?.kDramas || []);
      const trending = safeFilter(home?.trending || []);

      const hotKeywords = [...new Set([
        ...trending.slice(0, 6).map(x => String(x.title || "").trim()),
        ...movies.slice(0, 3).map(x => String(x.title || "").trim()),
        ...anime.slice(0, 3).map(x => String(x.title || "").trim()),
        "South Indian Hindi",
        "Bangla Movies",
        "K-Drama",
        "Hindi Dubbed"
      ].filter(Boolean))].slice(0, 14);

      return {
        ok: true,
        items: hotKeywords,
        subjects: [...trending.slice(0, 8), ...movies.slice(0, 6)].slice(0, 12),
        rankings: {
          movie: movies.slice(0, 12),
          series: series.slice(0, 12),
          anime: anime.slice(0, 12),
          drama: drama.slice(0, 12)
        }
      };
    }

    case "filter-options": {
      await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/filter`, {}, 600000).catch(() => null);
      return {
        ok: true,
        languages: [
          "Bangla", "Bangla Dubbed", "Dual Audio", "Hindi", "Hindi Dubbed",
          "English", "Korean", "Chinese", "Japanese", "Tamil", "Telugu",
          "Malayalam", "Kannada", "Punjabi", "Marathi", "Gujrati",
          "Indonesian", "Turkish", "Urdu", "Spanish", "French", "German",
          "Italian", "Portuguese", "Vietnamese", "Malaysian"
        ],
        types: ["Movie", "Series", "Anime", "Short Drama"],
        genres: [
          "Action", "Adventure", "Animation", "Biographical", "Comedy", "Crime",
          "Documentary", "Drama", "Family", "Fantasy", "Historical", "Horror",
          "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Sports",
          "Superhero", "Survival", "Suspense", "Thriller", "War",
          "Adult", "Erotic", "Hot"
        ]
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
      if (lower === "/new" || lower === "/popular") {
        const [mRes, sRes, aRes] = await Promise.allSettled([
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 36, channelId: 1, sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 36, channelId: 2, sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 20, channelId: 2, genre: "Anime", sort: "Latest" }) }, 120000)
        ]);
        const merged = [
          ...(mRes.status === "fulfilled" ? indexList(mRes.value?.data?.items) : []),
          ...(sRes.status === "fulfilled" ? indexList(sRes.value?.data?.items) : []),
          ...(aRes.status === "fulfilled" ? indexList(aRes.value?.data?.items, { isAnime: true, _animeCatalog: true }) : [])
        ].filter(x => x.hasResource !== false);
        const uniq = [...new Map(merged.map(x => [x.subjectId || x.path, x])).values()];
        const items = sortByReleaseNewest(uniq);
        const hasMore = [mRes, sRes].some(r => r.status === "fulfilled" && r.value?.data?.pager?.hasMore);
        const totalPages = hasMore ? Math.max(page + 1, 20) : page;
        return { ok: true, items, page, totalPages, maxPage: totalPages, hasMore };
      }
      if (lower === "/mostwatch/7d") {
        const [tRes, mRes, sRes] = await Promise.allSettled([
          handleMovieBoxRoute("trending", query),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 30, channelId: 1, sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 30, channelId: 2, sort: "Latest" }) }, 120000)
        ]);
        const merged = [
          ...(mRes.status === "fulfilled" ? indexList(mRes.value?.data?.items) : []),
          ...(sRes.status === "fulfilled" ? indexList(sRes.value?.data?.items) : []),
          ...(tRes.status === "fulfilled" && Array.isArray(tRes.value?.items) ? tRes.value.items : [])
        ].filter(x => x.hasResource !== false);
        const uniq = [...new Map(merged.map(x => [x.subjectId || x.path, x])).values()];
        const totalPages = Math.max(page + 1, 5);
        return { ok: true, items: sortByReleaseNewest(uniq), page, totalPages, maxPage: totalPages, hasMore: true };
      }
      if (lower === "/top10") {
        const home = await getHomeFeed();
        const items = sortByReleaseNewest(
          Array.isArray(home?.curated?.top10) && home.curated.top10.length
            ? home.curated.top10
            : (home?.trending || []).slice(0, 10)
        );
        return { ok: true, items, page: 1, totalPages: 1 };
      }
      if (lower === "/top-rated") {
        const home = await getHomeFeed();
        const items = Array.isArray(home?.curated?.imdbTopRated) && home.curated.imdbTopRated.length
          ? home.curated.imdbTopRated
          : [...(home?.trending || [])].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || parseReleaseTs(b) - parseReleaseTs(a));
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
      if (lower === "" || lower === "/" || lower === "/all") {
        const [mRes, sRes, aRes, shRes] = await Promise.allSettled([
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 36, channelId: 1, sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 36, channelId: 2, sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 20, channelId: 2, genre: "Anime", sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 20, channelId: 7, sort: "Latest" }) }, 120000)
        ]);
        const merged = [
          ...(mRes.status === "fulfilled" ? indexList(mRes.value?.data?.items) : []),
          ...(sRes.status === "fulfilled" ? indexList(sRes.value?.data?.items) : []),
          ...(aRes.status === "fulfilled" ? indexList(aRes.value?.data?.items, { isAnime: true, _animeCatalog: true }) : []),
          ...(shRes.status === "fulfilled" ? indexList(shRes.value?.data?.items) : [])
        ].filter(x => x.hasResource !== false);
        const uniq = [...new Map(merged.map(x => [x.subjectId || x.path, x])).values()];
        const items = sortByReleaseNewest(uniq);
        const hasMore = [mRes, sRes].some(r => r.status === "fulfilled" && r.value?.data?.pager?.hasMore);
        const totalPages = hasMore ? Math.max(page + 1, 20) : page;
        return { ok: true, items, page, totalPages, maxPage: totalPages, hasMore };
      }
      if (lower.includes("southindian") || lower.includes("south-indian")) {
        const [mRes, sRes] = await Promise.allSettled([
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 30, channelId: 1, country: "India", sort: "Latest" }) }, 120000),
          mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify({ page, perPage: 24, channelId: 2, country: "India", sort: "Latest" }) }, 120000)
        ]);
        const merged = [
          ...(mRes.status === "fulfilled" ? indexList(mRes.value?.data?.items) : []),
          ...(sRes.status === "fulfilled" ? indexList(sRes.value?.data?.items) : [])
        ].filter(x => x.hasResource !== false);
        const uniq = [...new Map(merged.map(x => [x.subjectId || x.path, x])).values()];
        const hasMore = [mRes, sRes].some(r => r.status === "fulfilled" && r.value?.data?.pager?.hasMore);
        const totalPages = hasMore ? page + 1 : page;
        return { ok: true, items: sortByReleaseNewest(uniq), page, totalPages, maxPage: totalPages, hasMore };
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
      const isBothChannels =
        ((lower.startsWith("/language/") && !/(?:-series|drama)$/i.test(lower)) ||
          lower === "/bollywood" ||
          lower.startsWith("/genre/")) &&
        !query.get("channelId");

      const [j, jAlt] = await Promise.all([
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, { method: "POST", body: JSON.stringify(body) }, 120000),
        isBothChannels
          ? mbFetch(
              `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
              { method: "POST", body: JSON.stringify({ ...body, channelId: body.channelId === 2 ? 1 : 2, perPage: 30 }) },
              120000
            ).catch(() => null)
          : Promise.resolve(null)
      ]);
      let items = [
        ...indexList(j?.data?.items, extra),
        ...(jAlt ? indexList(jAlt?.data?.items, extra) : [])
      ].filter(x => x.hasResource !== false);
      items = [...new Map(items.map(x => [x.subjectId || x.path, x])).values()];

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
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 18, channelId: 1, genre: "Anime", sort: "Latest" }) },
          120000
        ).catch(() => null);
        const extraAnime = indexList(movieAnime?.data?.items, extra).filter(x => x.hasResource !== false);
        items = [...new Map([...items, ...extraAnime].map(x => [x.subjectId || x.path, x])).values()];
      } else if (body.country === "Bangladesh" && page === 1) {
        const otherChannel = body.channelId === 2 ? 1 : 2;
        const bdExtra = await mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: otherChannel, country: "Bangladesh", sort: "Latest" }) },
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
      }

      // Fallback if Bangla Dubbed / Genre / Bangladesh returns empty on primary channel
      if (!items.length && lower.includes("bangla-dubbed")) {
        const bdSearch = await handleMovieBoxRoute("search", new URLSearchParams({ q: "Bangla", page: String(page) })).catch(() => null);
        if (Array.isArray(bdSearch?.items) && bdSearch.items.length) items = bdSearch.items;
      } else if (!items.length && body.genre) {
        const gSearch = await handleMovieBoxRoute("search", new URLSearchParams({ q: body.genre, page: String(page) })).catch(() => null);
        if (Array.isArray(gSearch?.items) && gSearch.items.length) items = gSearch.items;
      } else if (!items.length && body.country === "Bangladesh") {
        const home = await getHomeFeed();
        items = [...home.trending, ...home.sections.flatMap(s => s.items)].filter(i => /bengali|bangla/i.test(i.language + " " + i.title)).slice(0, 24);
      }
      items = sortByReleaseNewest(items);
      const totalCount = Number(j?.data?.pager?.totalCount || 0);
      const hasMore = Boolean(j?.data?.pager?.hasMore || jAlt?.data?.pager?.hasMore);
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / 30)) : (hasMore ? page + 1 : page);
      return { ok: true, items, page, totalPages, maxPage: totalPages, hasMore: hasMore || page < totalPages, pager: j?.data?.pager || {} };
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
      let items = indexList(j?.data?.items).filter(x => !isNigerianContent(x) && isUpcomingUnreleased(x));
      if (!items.length && page === 1) {
        const home = await getHomeFeed();
        items = (Array.isArray(home.upcoming) ? home.upcoming : []).filter(x => !isNigerianContent(x) && isUpcomingUnreleased(x));
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
      const dubLock =
        query.get("dubLock") === "1" ||
        query.get("manualDub") === "1" ||
        query.get("preferHindi") === "0";
      const isHindiAudioDub = d =>
        Number(d?.type ?? 0) === 0 &&
        (/^(?:hi|hin)$/i.test(String(d?.lanCode || "").trim()) ||
          /hindi|हिन्दी|हिंदी/i.test(String(d?.lanName || d?.language || "")));

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

      let j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/detail?${qs.toString()}`, {}, 300000);
      if (j?.code !== 0 || !j?.data?.subject) {
        return { ok: false, error: j?.message || "Title details unavailable." };
      }

      // Default audio track: switch to Hindi audio dub automatically when available (unless user locked dub)
      const initialDubs = Array.isArray(j.data.dubs)
        ? j.data.dubs
        : Array.isArray(j.data.subject?.dubs)
          ? j.data.subject.dubs
          : [];
      const curSid = String(j.data.subject.subjectId || subjectId || "");
      const curDubEntry = initialDubs.find(d => String(d?.subjectId || "") === curSid);
      const hindiDubEntry = initialDubs.find(d => d?.subjectId && isHindiAudioDub(d));
      if (
        !dubLock &&
        hindiDubEntry &&
        String(hindiDubEntry.subjectId) !== curSid &&
        !(curDubEntry && isHindiAudioDub(curDubEntry))
      ) {
        try {
          const hQs = new URLSearchParams({ subjectId: String(hindiDubEntry.subjectId) });
          if (hindiDubEntry.detailPath) hQs.set("detailPath", String(hindiDubEntry.detailPath));
          const hj = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/detail?${hQs.toString()}`, {}, 300000);
          if (hj?.code === 0 && hj?.data?.subject) {
            j = hj;
          }
        } catch {}
      }

      const subj = normalizeSubject(j.data.subject);
      const rawDubs = Array.isArray(j.data.dubs)
        ? j.data.dubs
        : Array.isArray(j.data.subject?.dubs)
          ? j.data.subject.dubs
          : initialDubs;
      const activeDub = rawDubs.find(d => String(d?.subjectId || "") === String(subj.subjectId || ""));
      if (activeDub && isHindiAudioDub(activeDub)) {
        subj.isHindiDubbed = true;
        subj._hindiCatalog = true;
        subj.language = "Hindi Dubbed";
      } else if (activeDub && (activeDub.lanName || activeDub.language) && !activeDub.original) {
        subj.language = activeDub.lanName || activeDub.language;
      }

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
      const dubLock =
        query.get("dubLock") === "1" ||
        query.get("manualDub") === "1" ||
        query.get("preferHindi") === "0";
      const isHindiAudioDub = d =>
        Number(d?.type ?? 0) === 0 &&
        (/^(?:hi|hin)$/i.test(String(d?.lanCode || "").trim()) ||
          /hindi|हिन्दी|हिंदी/i.test(String(d?.lanName || d?.language || "")));

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
      const loadDetail = async (sid = subjectId) => {
        if (detJson && sid === subjectId) return detJson;
        try {
          const res = await mbFetch(
            `${MOVIEBOX_API}/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(sid)}`,
            {},
            300000
          );
          if (sid === subjectId) detJson = res;
          if (res?.data?.subject?.detailPath && (!detailPath || detailPath === sid)) {
            detailPath = String(res.data.subject.detailPath).trim();
          }
          if (res?.data?.subject) {
            normalizeSubject(res.data.subject);
          }
          return res;
        } catch {}
        return detJson;
      };

      if (!detailPath || detailPath === subjectId || !dubLock) {
        await loadDetail();
      }
      if (!dubLock && detJson) {
        const dList = Array.isArray(detJson?.data?.dubs)
          ? detJson.data.dubs
          : Array.isArray(detJson?.data?.subject?.dubs)
            ? detJson.data.subject.dubs
            : [];
        const curEntry = dList.find(d => String(d?.subjectId || "") === String(subjectId));
        const hiEntry = dList.find(d => d?.subjectId && isHindiAudioDub(d));
        if (hiEntry && String(hiEntry.subjectId) !== String(subjectId) && !(curEntry && isHindiAudioDub(curEntry))) {
          subjectId = String(hiEntry.subjectId);
          detailPath = String(hiEntry.detailPath || subjectId);
        }
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

      // If primary subject returned no stream, try alternate dubs (Hindi first, then Original / English)
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
              isHindiAudioDub(x)
                ? 0
                : x.original || /original/i.test(x.lanName || "")
                  ? 1
                  : /english/i.test(x.lanName || "")
                    ? 2
                    : 3;
            return score(a) - score(b);
          })
          .slice(0, 4);

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

      // If still empty (stale subjectId, mirror entry with no streams, or combined/localized title), recover via live Bearer search across title variants
      const rawRecoveryTitle = String(query.get("title") || detJson?.data?.subject?.title || "").trim();
      const recoveryQueries = splitSearchTitleVariants(rawRecoveryTitle).slice(0, 3);
      if (!rawStreams.length && lastUpstreamCode !== 429 && recoveryQueries.length) {
        const triedIds = new Set([String(subjectId)]);
        for (const rQuery of recoveryQueries) {
          try {
            const sj = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
              method: "POST",
              useBearer: true,
              body: JSON.stringify({ keyword: rQuery, page: 1, perPage: 8, subjectType: 0 })
            });
            const allowMusicHit = /\b(?:song|music|ost|pop|lyric|remix|album)\b/i.test(rQuery);
            const hits = indexList(sj?.data?.items)
              .filter(h => {
                if (!h || isNigerianContent(h)) return false;
                if (!allowMusicHit && isMusicOrClipSubject(h)) return false;
                return strictTitleMatchScore(rQuery, h.title || "") >= 0.68;
              })
              .sort((a, b) => strictTitleMatchScore(rQuery, b.title || "") - strictTitleMatchScore(rQuery, a.title || ""));
            for (const hit of hits.slice(0, 3)) {
              if (!hit?.subjectId || triedIds.has(String(hit.subjectId))) continue;
              triedIds.add(String(hit.subjectId));
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
          if (rawStreams.length || lastUpstreamCode === 429) break;
        }
      }

      const resolvedMeta = subjectIndex.get(streamSubjectId);
      const resolvedAudioLang = resolvedMeta?.isHindiDubbed
        ? "Hindi"
        : String(resolvedMeta?.language || "").split("·")[0].trim();

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
            audioLanguage: resolvedAudioLang
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

      const loadSubtitlesSafe = async () => {
        if (isTrailer || !rawStreams.length) return [];
        let found = await fetchCaptionsForStreams(streamSubjectId, streamDetailPath, rawStreams, streamReferer);

        // Many MovieBox dubbed versions omit subtitles on the dub entry while keeping them on Original Audio / sub entries
        if (!found.length && lastUpstreamCode !== 429) {
          try {
            const detail = await loadDetail();
            const cachedItem = subjectIndex.get(subjectId);
            const dubs = Array.isArray(detail?.data?.dubs)
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
                found = await fetchCaptionsForStreams(altSid, altDp, altStreams, altRef);
                if (found.length) break;
              }
            }
          } catch {}
        }
        return found;
      };

      const subtitles = sources.length
        ? await Promise.race([
            loadSubtitlesSafe(),
            new Promise(resolve => setTimeout(() => resolve([]), 1800))
          ])
        : [];

      const hasRes = playJson?.code === 0
        ? Boolean(playJson?.data?.hasResource ?? (!isTrailer && sources.length > 0))
        : (!isTrailer && sources.length > 0);
      const isTrulyUpcoming = isUpcomingUnreleased(resolvedMeta || detJson?.data?.subject || { title: rawRecoveryTitle });
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
          ? (isTrulyUpcoming
            ? "Full video not yet released — playing official trailer."
            : "Full video unavailable on server right now — playing official trailer.")
          : rateLimited
            ? "Video server is temporarily busy (rate limit). Please tap Retry in a moment."
            : !sources.length && !hasRes
              ? (isTrulyUpcoming
                ? "This title is marked Upcoming / Unreleased and does not have a playable video yet."
                : "No playable video stream is available for this title right now.")
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
