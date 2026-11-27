import dns from "node:dns";
import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { CHROME_SEC_HEADERS, combineAbortSignals, curlHttpRequest } from "./lib/http-transport.js";
import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  handleMovieBoxRoute,
  signMediaToken,
  sortByReleaseNewest,
  verifyMediaToken
} from "./moviebox-api.js";
import {
  findExactTitleMlbdBackup,
  getActiveMlbdReferer,
  getMlbdCatalog,
  getMlbdCategories,
  getMlbdDetails,
  getMlbdHomeFeed,
  getMlbdServerHealth,
  getMlbdStream,
  getMlbdSuggest,
  isMlbdDirectPlaybackAvailable,
  isMlbdPath,
  matchesMlbdCategoryItem,
  resolveSafeMlbdToken,
  rewriteMlbdHlsPlaylist,
  validateExternalHttpUrl
} from "./movielinkbd-api.js";
import { buildPosterSvg, handleMockMovieApi } from "./mock-catalog.js";
import {
  isNigerianContent,
  isMusicOrClipSubject,
  expandSearchQueryVariants,
  scoreSearchMatch,
  collectTitleSuggestions
} from "./lib/catalog-rules.js";
import {
  CINEPULSE_UPSTREAM,
  fetchCinePulseApi,
  isCinePulseConfigured,
  loadDotEnvIfPresent,
  normalizeCinePulsePayload,
  normalizeCinePulseRoute
} from "./lib/cinepulse-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadDotEnvIfPresent(path.join(__dirname, ".env"));
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

const app = express();
const gzipAsync = promisify(gzip);
const RAW_PORT = process.env.PORT;
const IS_PORT_NUMBER = !RAW_PORT || /^\d+$/.test(String(RAW_PORT).trim());
const PORT = IS_PORT_NUMBER ? Number(RAW_PORT || 3000) : String(RAW_PORT).trim();
const HOST = "0.0.0.0";
const SERVER_STARTED_AT = new Date().toISOString();
const BUILD_VERSION = "20261127-fast-5";
const recentStreamEvents = [];

function recordStreamEvent(evt) {
  recentStreamEvents.unshift({ ts: new Date().toISOString(), ...evt });
  if (recentStreamEvents.length > 30) recentStreamEvents.length = 30;
}

app.set("trust proxy", true);

// Fast gzip compression for API JSON & text assets (>= 1 KB)
app.use((req, res, next) => {
  const acceptEnc = String(req.headers["accept-encoding"] || "");
  if (!/\bgzip\b/i.test(acceptEnc) || req.path.includes("-stream") || req.path.includes("cinepulse-media")) {
    return next();
  }
  const origJson = res.json.bind(res);
  res.json = data => {
    const body = JSON.stringify(data);
    if (body.length < 1024 || res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(body);
    }
    gzipAsync(Buffer.from(body, "utf8"), { level: 4 })
      .then(gz => {
        if (res.headersSent) return;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
        res.setHeader("Content-Length", String(gz.length));
        res.end(gz);
      })
      .catch(() => {
        if (!res.headersSent) origJson(data);
      });
    return res;
  };
  next();
});

function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("host") || (IS_PORT_NUMBER ? `localhost:${PORT}` : "localhost");
  return `${proto.split(",")[0].trim()}://${host}`;
}

// Block access to server-side / config directories and files
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p.startsWith("/functions/") ||
    p === "/functions" ||
    p.startsWith("/supabase/") ||
    p === "/supabase" ||
    p.startsWith("/lib/") ||
    p === "/lib" ||
    p.startsWith("/data/") ||
    p === "/data" ||
    p === "/.cinepulse-catalog-archive.json" ||
    p.startsWith("/node_modules/") ||
    p.startsWith("/.git") ||
    p.startsWith("/.env") ||
    p === "/server.js" ||
    p === "/moviebox-api.js" ||
    p === "/movielinkbd-api.js" ||
    p === "/mock-catalog.js" ||
    p === "/package.json" ||
    p === "/package-lock.json" ||
    p === "/metadata.json"
  ) {
    return res.status(404).send("Not found");
  }
  next();
});

// Dynamic SVG poster fallback
app.get("/api/poster/:id.svg", (req, res) => {
  const svg = buildPosterSvg(req.params.id);
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(svg);
});

// Sitemap
app.get("/sitemap.xml", (req, res) => {
  const baseUrl = getBaseUrl(req);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc></url>
  <url><loc>${baseUrl}/catalog.html</loc></url>
  <url><loc>${baseUrl}/sports.html</loc></url>
  <url><loc>${baseUrl}/privacy.html</loc></url>
</urlset>`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(sitemap);
});

function convertSrtToVtt(rawText) {
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
    let timeIdx = lines.findIndex(l => l.includes("-->"));
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

const IMAGE_CACHE_MAX_ENTRIES = 250;
const IMAGE_CACHE_MAX_BYTES = 1.5 * 1024 * 1024;
const IMAGE_CACHE_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const IMAGE_CACHE_TTL_MS = 6 * 3600 * 1000;
const imageCache = new Map();
const imageInFlight = new Map();
let imageCacheTotalBytes = 0;

function deleteCachedImageEntry(key) {
  const existing = imageCache.get(key);
  if (!existing) return;
  imageCacheTotalBytes = Math.max(0, imageCacheTotalBytes - (existing.body?.length || 0));
  imageCache.delete(key);
}

function getCachedImageEntry(url) {
  const entry = imageCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    deleteCachedImageEntry(url);
    return null;
  }
  imageCache.delete(url);
  imageCache.set(url, entry);
  return entry;
}

function setCachedImageEntry(url, contentType, bodyBuffer) {
  if (!bodyBuffer || !bodyBuffer.length || bodyBuffer.length > IMAGE_CACHE_MAX_BYTES) return;
  deleteCachedImageEntry(url);
  while (
    imageCache.size >= IMAGE_CACHE_MAX_ENTRIES ||
    (imageCacheTotalBytes + bodyBuffer.length > IMAGE_CACHE_MAX_TOTAL_BYTES && imageCache.size > 0)
  ) {
    const oldestKey = imageCache.keys().next().value;
    if (!oldestKey) break;
    deleteCachedImageEntry(oldestKey);
  }
  imageCache.set(url, {
    contentType,
    body: bodyBuffer,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS
  });
  imageCacheTotalBytes += bodyBuffer.length;
}

function isPublicImageCdn(url) {
  return /\b(?:image\.tmdb\.org|media-amazon\.com|r2\.dev|ibb\.co(?:\.com)?|postimg\.cc|ytimg\.com|mzstatic\.com|tvmaze\.com|wikimedia\.org|wikipedia\.org|imageflix\.cam|img\.movielinkapp\.com)\b/i.test(String(url || ""));
}

// Image proxy for MovieBox/MLBD posters, avatars & sports logos (RAM cached, coalesced & hotlink-safe)
app.get("/api/moviebox-image/:file", async (req, res) => {
  const targetUrl = verifyMediaToken(req.query.t);
  if (!targetUrl) {
    return res.status(400).send("Invalid or missing image token");
  }

  const cached = getCachedImageEntry(targetUrl);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Image-Cache", "HIT");
    return res.end(cached.body);
  }

  const referer = /aisports/i.test(targetUrl)
    ? "https://aisports.mobi/"
    : /movielinkbd\.com/i.test(targetUrl)
      ? "https://movielinkbd.com/"
      : /movielink/i.test(targetUrl)
        ? getActiveMlbdReferer()
        : MOVIEBOX_REFERER;

  try {
    let job = imageInFlight.get(targetUrl);
    if (!job) {
      job = (async () => {
        const baseHeaders = {
          "User-Agent": MOVIEBOX_UA,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        };
        const useReferer = !isPublicImageCdn(targetUrl);
        let upstream = await fetchMediaWithRetry(
          targetUrl,
          "GET",
          useReferer ? { ...baseHeaders, Referer: referer } : baseHeaders,
          null,
          2,
          12000
        );
        if ((upstream.status === 403 || upstream.status === 401) && useReferer) {
          try { await upstream.body?.cancel(); } catch {}
          upstream = await fetchMediaWithRetry(targetUrl, "GET", baseHeaders, null, 1, 10000);
        }
        if (upstream.status === 403) {
          try { await upstream.body?.cancel(); } catch {}
          const secHeaders = {
            ...CHROME_SEC_HEADERS,
            ...baseHeaders,
            ...(useReferer ? { Referer: referer } : {}),
            "Sec-Fetch-Dest": "image",
            "Sec-Fetch-Mode": "no-cors"
          };
          upstream = await fetchMediaWithRetry(targetUrl, "GET", secHeaders, null, 1, 10000);
        }
        if (!upstream.ok) {
          try { await upstream.body?.cancel(); } catch {}
          return { ok: false, status: upstream.status };
        }
        const rawCt = String(upstream.headers.get("content-type") || "").toLowerCase();
        if (rawCt && !rawCt.startsWith("image/") && !rawCt.includes("octet-stream")) {
          try { await upstream.body?.cancel(); } catch {}
          return { ok: false, status: 415 };
        }
        const ct = rawCt.startsWith("image/") ? rawCt : "image/jpeg";
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (!buf.length) {
          return { ok: false, status: 502 };
        }
        setCachedImageEntry(targetUrl, ct, buf);
        return { ok: true, contentType: ct, body: buf };
      })().finally(() => {
        imageInFlight.delete(targetUrl);
      });
      imageInFlight.set(targetUrl, job);
    }

    const result = await job;
    if (!result?.ok) {
      return res.status(result?.status || 502).send("Image unavailable");
    }
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(result.body);
  } catch {
    return res.status(502).send("Image upstream unavailable");
  }
});

// Subtitle proxy for MovieBox captions (converts .srt cleanly to WebVTT + bypasses CORS)
app.get("/api/moviebox-subtitle/:file", async (req, res) => {
  const targetUrl = verifyMediaToken(req.query.t);
  if (!targetUrl) {
    return res.status(400).send("Invalid or missing subtitle token");
  }
  try {
    const subReferer = /movielink/i.test(targetUrl) ? getActiveMlbdReferer() : MOVIEBOX_PLAYER_REFERER;
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: subReferer
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Subtitle unavailable");
    }
    const rawText = await upstream.text();
    const wantVtt = req.query.vtt === "1" || /\.vtt$/i.test(req.params.file);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (wantVtt) {
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send(convertSrtToVtt(rawText));
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(rawText);
  } catch {
    return res.status(502).send("Subtitle upstream unavailable");
  }
});

// Live Sports HLS (.m3u8 + .ts) proxy with required aisports.mobi Referer
app.get("/api/sports-hls/:file", async (req, res) => {
  const targetUrl = verifyMediaToken(req.query.t);
  if (!targetUrl) {
    return res.status(400).send("Invalid or missing sports stream token");
  }
  try {
    const reqHeaders = {
      "User-Agent": MOVIEBOX_UA,
      Referer: "https://aisports.mobi/",
      Accept: "*/*"
    };
    const range = req.get("range");
    if (range) reqHeaders.Range = range;

    const upstream = await fetch(targetUrl, {
      headers: reqHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send("Live sports stream unavailable");
    }
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const cl = Number(upstream.headers.get("content-length") || 0);
    const maybePlaylist =
      ct.includes("mpegurl") ||
      ct.includes("text/plain") ||
      /\.m3u8(?:$|[?#])/i.test(targetUrl) ||
      req.params.file.endsWith(".m3u8") ||
      (cl > 0 && cl < 524288 && !ct.includes("mp2t") && !ct.includes("video/"));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (maybePlaylist) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const raw = buf.toString("utf8");
      if (raw.trimStart().startsWith("#EXTM3U")) {
        let nextIsVariant = false;
        const rewritten = raw
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
                  const abs = new URL(uri, upstream.url || targetUrl).href;
                  const isSubM3u8 = /\.m3u8(?:$|[?#])/i.test(abs) || /#EXT-X-MEDIA/i.test(trimmed);
                  const ext = isSubM3u8 ? "sub.m3u8" : "key.bin";
                  return `URI="/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}"`;
                } catch {
                  return `URI="${uri}"`;
                }
              });
            }
            try {
              const abs = new URL(trimmed, upstream.url || targetUrl).href;
              const isSubM3u8 = nextIsVariant || /\.m3u8(?:$|[?#])/i.test(abs);
              nextIsVariant = false;
              const ext = isSubM3u8 ? "sub.m3u8" : "seg.ts";
              return `/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}`;
            } catch {
              nextIsVariant = false;
              return line;
            }
          })
          .join("\n");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        return res.send(rewritten);
      }
      res.setHeader("Content-Type", ct || "video/mp2t");
      return res.status(upstream.status).send(buf);
    }

    res.setHeader("Content-Type", ct || "video/mp2t");
    if (upstream.headers.get("content-range")) {
      res.setHeader("Content-Range", upstream.headers.get("content-range"));
    }
    if (upstream.headers.get("content-length")) {
      res.setHeader("Content-Length", upstream.headers.get("content-length"));
    }
    res.status(upstream.status);
    if (!upstream.body) return res.end();
    const nodeStream = Readable.fromWeb(upstream.body);
    res.on("close", () => {
      if (!res.writableFinished) {
        try {
          nodeStream.destroy();
        } catch {}
      }
    });
    nodeStream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
  } catch (error) {
    return res.status(502).send(error?.message || "Sports stream proxy error");
  }
});

const MAX_STREAM_CHUNK = 12 * 1024 * 1024;
const INITIAL_STREAM_CHUNK = 3 * 1024 * 1024;
const MAX_STREAM_CHUNK_SAVER = 2 * 1024 * 1024;
const INITIAL_STREAM_CHUNK_SAVER = 768 * 1024;

function buildBoundedRangeHeader(rawRange, preserveUnbounded = false, dataSaver = false) {
  if (preserveUnbounded) {
    return rawRange ? String(rawRange).trim() : null;
  }
  const initialSpan = dataSaver ? INITIAL_STREAM_CHUNK_SAVER : INITIAL_STREAM_CHUNK;
  const maxChunkSpan = dataSaver ? MAX_STREAM_CHUNK_SAVER : MAX_STREAM_CHUNK;
  if (!rawRange) {
    return `bytes=0-${initialSpan - 1}`;
  }
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(rawRange).trim());
  if (!match) return rawRange;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const maxSpan = start === 0 ? initialSpan : maxChunkSpan;
  if (!Number.isFinite(start) || start < 0) return rawRange;
  if (requestedEnd == null || !Number.isFinite(requestedEnd)) {
    return `bytes=${start}-${start + maxSpan - 1}`;
  }
  if (requestedEnd - start + 1 > maxSpan) {
    return `bytes=${start}-${start + maxSpan - 1}`;
  }
  return `bytes=${start}-${requestedEnd}`;
}

function buildDownloadDisposition(rawName) {
  const cleaned = String(rawName || "MovieStreamBD-Video.mp4")
    .replace(/[\r\n"\\/;]+/g, " ")
    .replace(/[<>:?*|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "MovieStreamBD-Video.mp4";
  const withExt = /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
  const ascii = withExt.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "") || "MovieStreamBD-Video.mp4";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(withExt)}`;
}

async function fetchMediaWithRetry(targetUrl, method, headers, clientAbortSignal, retries = 4, connectTimeoutMs = 15000) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (clientAbortSignal?.aborted) {
      throw new DOMException("Client aborted request", "AbortError");
    }
    const connectController = new AbortController();
    const timer = setTimeout(() => {
      connectController.abort(new DOMException("Connect timeout", "TimeoutError"));
    }, connectTimeoutMs);
    const signal = clientAbortSignal
      ? combineAbortSignals(clientAbortSignal, connectController.signal)
      : connectController.signal;
    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers,
        redirect: "follow",
        signal
      });
      clearTimeout(timer);
      if ((upstream.status >= 500 || upstream.status === 429) && attempt < retries) {
        try {
          await upstream.body?.cancel();
        } catch {}
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      return upstream;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (clientAbortSignal?.aborted || attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Media upstream unavailable");
}

async function fetchUpstreamMedia(targetUrl, method, headers, clientAbortSignal, retries = 4, connectTimeoutMs = 30000) {
  let upstream = await fetchMediaWithRetry(targetUrl, method, headers, clientAbortSignal, retries, connectTimeoutMs);
  if (upstream.status === 403 && headers.get("Referer") === MOVIEBOX_PLAYER_REFERER) {
    try {
      await upstream.body?.cancel();
    } catch {}
    for (const altRef of ["https://moviebox.ph/", MOVIEBOX_REFERER]) {
      const altHeaders = new Headers(headers);
      altHeaders.set("Referer", altRef);
      upstream = await fetchMediaWithRetry(targetUrl, method, altHeaders, clientAbortSignal, 1, connectTimeoutMs);
      if (upstream.ok || upstream.status === 206) {
        return { upstream, usedHeaders: altHeaders };
      }
      try {
        await upstream.body?.cancel();
      } catch {}
    }
  }
  return { upstream, usedHeaders: headers };
}

function parseContentRangeInfo(headerVal) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(headerVal || "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === "*" ? 0 : Number(m[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end, total, length: end - start + 1 };
}

function writeChunkWithBackpressure(res, chunk, abortSignal) {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted || res.destroyed || res.writableEnded) {
      return reject(new DOMException("Client aborted request", "AbortError"));
    }
    const ok = res.write(chunk);
    if (ok) return resolve();
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new DOMException("Client closed connection", "AbortError"));
    };
    const onError = err => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

async function readChunkWithTimeout(reader, timeoutMs, abortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException("Client aborted request", "AbortError");
  }
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new DOMException("Upstream stream stalled", "TimeoutError"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Direct MP4 media proxy with Range support, Referer header & mid-stream auto-resume
async function proxyMediaStream(req, res, targetUrl, extraHeaders = {}, forceDownload = false, customFilename = "", streamOpts = {}) {
  const isHlsSegment = Boolean(streamOpts?.isHlsSegment);
  const dataSaver = Boolean(streamOpts?.dataSaver);
  if (forceDownload) {
    try {
      req.setTimeout?.(0);
      res.setTimeout?.(0);
    } catch {}
  }

  const headers = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: req.get("accept") || "*/*",
    ...extraHeaders
  });
  const clientRange = req.get("range");
  if (req.method === "GET") {
    if (isHlsSegment) {
      if (clientRange) headers.set("range", clientRange);
    } else if (clientRange) {
      headers.set("range", buildBoundedRangeHeader(clientRange, false, dataSaver));
    } else if (!forceDownload) {
      headers.set("range", buildBoundedRangeHeader(null, false, dataSaver));
    }
  } else if (clientRange) {
    headers.set("range", clientRange);
  }
  if (req.get("if-range")) headers.set("if-range", req.get("if-range"));

  const abortController = new AbortController();
  const abortStream = () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
  };
  res.on("close", abortStream);
  req.on("aborted", abortStream);

  let upstream;
  let activeHeaders;
  try {
    ({ upstream, usedHeaders: activeHeaders } = await fetchUpstreamMedia(
      targetUrl,
      req.method,
      headers,
      abortController.signal,
      3,
      15000
    ));
  } catch (err) {
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.status(499).end();
      return;
    }
    throw err;
  }

  // Some CDNs block HEAD or omit Content-Length on HEAD; probe with GET Range: bytes=0-0
  if (
    req.method === "HEAD" &&
    (!upstream.ok || !Number(upstream.headers.get("content-length") || 0))
  ) {
    try {
      await upstream.body?.cancel();
    } catch {}
    const probeHeaders = new Headers(headers);
    probeHeaders.delete("if-range");
    probeHeaders.set("range", "bytes=0-0");
    try {
      const probed = await fetchUpstreamMedia(
        targetUrl,
        "GET",
        probeHeaders,
        abortController.signal,
        2,
        20000
      );
      const crInfo = parseContentRangeInfo(probed.upstream.headers.get("content-range"));
      const probeCt = probed.upstream.headers.get("content-type") || "video/mp4";
      try {
        await probed.upstream.body?.cancel();
      } catch {}
      if (probed.upstream.ok || probed.upstream.status === 206) {
        const totalBytes = crInfo?.total || Number(probed.upstream.headers.get("content-length") || 0);
        res.setHeader("content-type", probeCt.includes("octet-stream") ? "video/mp4" : probeCt);
        if (totalBytes > 0) res.setHeader("content-length", String(totalBytes));
        res.setHeader("accept-ranges", "bytes");
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");
        if (forceDownload) {
          res.setHeader("content-disposition", buildDownloadDisposition(customFilename));
          res.setHeader("cache-control", "private, no-store");
        }
        res.setHeader("x-content-type-options", "nosniff");
        return res.status(200).end();
      }
    } catch {}
  }

  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch {}
    const errContentRange = upstream.headers.get("content-range");
    if (errContentRange) res.setHeader("content-range", errContentRange);
    return res.status(upstream.status).type("text/plain").send("Media upstream unavailable");
  }

  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified"
  ]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!ct || ct.includes("octet-stream") || (ct.startsWith("image/") && (/movielink/i.test(targetUrl) || isHlsSegment))) {
    res.setHeader(
      "content-type",
      /\/v(?:sub|seg)\//i.test(targetUrl)
        ? "text/vtt; charset=utf-8"
        : isHlsSegment
          ? (clientRange ? "video/mp4" : "video/mp2t")
          : "video/mp4"
    );
  }
  if (!upstream.headers.get("accept-ranges")) {
    res.setHeader("accept-ranges", "bytes");
  }
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");
  if (forceDownload) {
    res.setHeader("content-disposition", buildDownloadDisposition(customFilename));
    res.setHeader("cache-control", "private, no-store");
  } else {
    res.setHeader("vary", "Range");
    res.setHeader("cache-control", "private, max-age=300, no-transform");
  }
  res.setHeader("x-content-type-options", "nosniff");
  res.status(upstream.status);

  if (req.method === "HEAD" || !upstream.body) {
    return res.end();
  }

  if (!forceDownload || clientRange) {
    const nodeStream = Readable.fromWeb(upstream.body);
    const cleanupStream = () => {
      if (!res.writableFinished) {
        abortController.abort();
        try {
          nodeStream.destroy();
        } catch {}
      }
    };
    res.on("close", cleanupStream);
    res.on("error", cleanupStream);
    nodeStream.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
    return;
  }

  // Full download mode: stream with transparent upstream Range auto-resume so CDN drops never truncate the file
  const rangeInfo = parseContentRangeInfo(upstream.headers.get("content-range"));
  const initialContentLength = Number(upstream.headers.get("content-length") || 0);
  const startOffset = rangeInfo ? rangeInfo.start : 0;
  const expectedLength = rangeInfo
    ? rangeInfo.length
    : (Number.isFinite(initialContentLength) && initialContentLength > 0 ? initialContentLength : 0);
  const targetEndByte = rangeInfo
    ? rangeInfo.end
    : (expectedLength > 0 ? expectedLength - 1 : null);

  let bytesSent = 0;
  let currentUpstream = upstream;
  let resumeAttempts = 0;
  const MAX_RESUME_ATTEMPTS = 12;

  while (!abortController.signal.aborted && !res.destroyed && !res.writableEnded) {
    let streamBroken = false;
    if (currentUpstream && currentUpstream.body) {
      let reader = null;
      try {
        reader = currentUpstream.body.getReader();
        while (!abortController.signal.aborted) {
          const { done, value } = await readChunkWithTimeout(reader, 45000, abortController.signal);
          if (done) break;
          if (value && value.byteLength > 0) {
            let slice = value;
            if (expectedLength > 0 && bytesSent + slice.byteLength > expectedLength) {
              slice = slice.subarray(0, expectedLength - bytesSent);
            }
            if (slice.byteLength > 0) {
              await writeChunkWithBackpressure(res, slice, abortController.signal);
              bytesSent += slice.byteLength;
            }
            if (expectedLength > 0 && bytesSent >= expectedLength) break;
          }
        }
      } catch (err) {
        streamBroken = true;
        try {
          await reader?.cancel();
        } catch {}
        if (abortController.signal.aborted || res.destroyed || res.writableEnded) {
          return;
        }
        console.warn(
          `[cinepulse-media stream interrupted at ${bytesSent}/${expectedLength || "?"}]`,
          err?.name || "",
          err?.message || ""
        );
      } finally {
        try {
          reader?.releaseLock();
        } catch {}
        currentUpstream = null;
      }
    } else {
      streamBroken = true;
    }

    if (abortController.signal.aborted || res.destroyed || res.writableEnded) {
      return;
    }

    const doneAll = expectedLength > 0 ? bytesSent >= expectedLength : !streamBroken;
    if (doneAll) {
      return res.end();
    }

    resumeAttempts++;
    if (resumeAttempts > MAX_RESUME_ATTEMPTS) {
      console.error(`[cinepulse-media gave up after ${MAX_RESUME_ATTEMPTS} resume attempts at ${bytesSent}/${expectedLength}]`);
      return res.destroy();
    }

    const nextByte = startOffset + bytesSent;
    const rangeEndStr = targetEndByte != null ? String(targetEndByte) : "";
    const resumeHeaders = new Headers(activeHeaders);
    resumeHeaders.delete("if-range");
    resumeHeaders.set("range", `bytes=${nextByte}-${rangeEndStr}`);

    const delayMs = Math.min(5000, 600 * resumeAttempts);
    await new Promise(r => setTimeout(r, delayMs));
    if (abortController.signal.aborted || res.destroyed || res.writableEnded) {
      return;
    }

    try {
      const resumed = await fetchUpstreamMedia(
        targetUrl,
        "GET",
        resumeHeaders,
        abortController.signal,
        2,
        30000
      );
      if (!resumed.upstream.ok && resumed.upstream.status !== 206) {
        try {
          await resumed.upstream.body?.cancel();
        } catch {}
        continue;
      }

      const resumedRange = parseContentRangeInfo(resumed.upstream.headers.get("content-range"));
      if (nextByte > 0 && (resumed.upstream.status !== 206 || !resumedRange || resumedRange.start !== nextByte)) {
        try {
          await resumed.upstream.body?.cancel();
        } catch {}
        return res.destroy();
      }

      currentUpstream = resumed.upstream;
      activeHeaders = resumed.usedHeaders;
    } catch (resumeErr) {
      if (abortController.signal.aborted) return;
      console.warn("[cinepulse-media resume fetch error]", resumeErr?.message || resumeErr);
    }
  }
}

app.all("/api/cinepulse-media", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).set("Allow", "GET, HEAD").send("Method not allowed");
  }

  const customFilename = String(req.query.filename || "");
  const forceDownload = req.query.download === "1";
  const dataSaver = req.query.saver === "1";
  const mbToken = String(req.query.mb || "");
  if (mbToken) {
    const targetUrl = verifyMediaToken(mbToken);
    if (!targetUrl) {
      return res.status(400).type("text/plain").send("Invalid or expired media token");
    }
    try {
      return await proxyMediaStream(
        req,
        res,
        targetUrl,
        { Referer: MOVIEBOX_PLAYER_REFERER },
        forceDownload,
        customFilename,
        { dataSaver }
      );
    } catch (error) {
      console.error("[cinepulse-media upstream error]", error?.name, error?.message, error?.cause?.code || "");
      return res.status(502).type("text/plain").send(
        error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable"
      );
    }
  }

  const apiKey = process.env.CINEPULSE_API_KEY;
  const token = String(req.query.t || "");
  if (!apiKey || !/^cp1[A-Za-z0-9._~-]{8,2048}$/.test(token)) {
    return res.status(400).type("text/plain").send("Invalid or missing media token");
  }
  try {
    return await proxyMediaStream(
      req,
      res,
      `${CINEPULSE_UPSTREAM}/api/mb-stream.mp4?t=${encodeURIComponent(token)}`,
      { "x-api-key": apiKey },
      forceDownload,
      customFilename,
      { dataSaver }
    );
  } catch (error) {
    console.error("[cinepulse-media fallback error]", error?.name, error?.message);
    return res.status(502).type("text/plain").send(
      error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable"
    );
  }
});

// === MovieLinkBD & Cineverse API Endpoints ===

app.get("/api/categories", async (_req, res) => {
  try {
    const data = await getMlbdCategories();
    res.setHeader("Cache-Control", "public, max-age=180");
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err?.message || "Categories unavailable" });
  }
});

app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    service: "MovieStream BD",
    provider: "CinePulse",
    buildVersion: BUILD_VERSION,
    startedAt: SERVER_STARTED_AT,
    runtimeMode: IS_PORT_NUMBER ? "port" : "cpanel-socket",
    apiKeyConfigured: isCinePulseConfigured(),
    activeMlbdMirror: getActiveMlbdReferer(),
    checkedAt: new Date().toISOString()
  });
});

app.all("/api/cinepulse/v1/*", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const rawRoute = String(req.params[0] || "").replace(/^\/+|\/+$/g, "");
  const route = normalizeCinePulseRoute(rawRoute);
  if (!route) {
    return res.status(404).json({ ok: false, error: `Unknown CinePulse endpoint: /api/v1/${rawRoute}` });
  }
  const incomingUrl = new URL(req.originalUrl, getBaseUrl(req));
  const cpRes = await fetchCinePulseApi(route, incomingUrl.searchParams, {
    accept: req.get("accept") || "application/json",
    timeoutMs: 18000
  });
  const isErrorResp = !cpRes.ok || !cpRes.data;
  res.setHeader("Cache-Control", (route === "stream" || isErrorResp) ? "no-store" : "public, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!cpRes.data) {
    return res.status(cpRes.status || 502).json({
      ok: false,
      errorCode: cpRes.errorCode || "UPSTREAM_ERROR",
      isCloudflareBlock: Boolean(cpRes.isCloudflareBlock),
      isAuthError: Boolean(cpRes.isAuthError),
      error: cpRes.error || "CinePulse upstream error"
    });
  }
  return res.status(cpRes.status || 200).json(normalizeCinePulsePayload(route, cpRes.data));
});

app.get("/api/server-health", async (_req, res) => {
  try {
    const data = await getMlbdServerHealth();
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err?.message || "Server health check failed" });
  }
});

function isAdultCatalogItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.isAdult === true) return true;
  const hay = `${item.title || ""} ${item.genre || ""} ${item.category || ""} ${item.platform || ""}`;
  return /\b(?:adult|erotic|18\+|xxx|porn|softcore|vivamax)\b/i.test(hay) || /^(?:hot|midnight)$/i.test(String(item.genre || "").trim());
}

function matchesSearchType(item, rawTypeParam) {
  const rawTypes = String(rawTypeParam || "0")
    .split(",")
    .map(n => Number(n.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!rawTypes.length) return true;
  const st = Number(item?.subjectType || (item?.isSeries ? 2 : 1));
  if (rawTypes.includes(st)) return true;
  if (rawTypes.includes(6) && (item?.isAnime === true || /\banime\b|animation/i.test(`${item?.genre || ""} ${item?.typeBadge || ""} ${item?.title || ""}`))) return true;
  if (rawTypes.includes(2) && (item?.isSeries || item?.type === "series" || /series|drama|show/i.test(String(item?.typeBadge || "")))) return true;
  if (rawTypes.includes(1) && !item?.isSeries && item?.type !== "series" && !item?.isAnime) return true;
  if (rawTypes.includes(7) && /short/i.test(`${item?.typeBadge || ""} ${item?.genre || ""}`)) return true;
  return false;
}

async function fetchImdbSuggestTitles(q) {
  const clean = String(q || "").trim();
  const firstMatch = clean.toLowerCase().match(/[a-z0-9]/);
  if (clean.length < 2 || !firstMatch) return [];
  try {
    const res = await fetch(
      `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(firstMatch[0])}/${encodeURIComponent(clean.toLowerCase())}.json`,
      {
        headers: { "User-Agent": MOVIEBOX_UA },
        signal: AbortSignal.timeout(2200)
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data?.d) ? data.d : [];
    const validQid = new Set(["movie", "tvSeries", "tvMiniSeries", "tvMovie", "video"]);
    return list
      .filter(e => e?.l && (!e.qid || validQid.has(e.qid)))
      .map(e => String(e.l).trim())
      .slice(0, 10);
  } catch {
    return [];
  }
}

function isCategorySearchQuery(q) {
  return /\b(hindi|dubbed|bollywood|bangla|bengali|natok|korean|k-?drama|chinese|c-?drama|turkish|japanese|pakistani|urdu|hollywood|english|south\s*indian|tamil|telugu|malayalam|punjabi|anime|action|comedy|horror|thriller|romance|fantasy|adventure|crime|mystery|sci-?fi|netflix|prime\s*video|disney|hoichoi|zee5|adult|erotic|18\+|vivamax)\b/i.test(String(q || ""));
}

function scoreMergedSearchItem(item, q) {
  if (!item || isNigerianContent(item)) return 0;
  const lower = String(q || "").trim().toLowerCase();
  if (!lower) return 10;
  const hay = `${item?.title || ""} ${item?.genre || ""} ${item?.language || ""} ${item?.country || ""} ${item?.typeBadge || ""} ${item?.platform || ""}`.toLowerCase();
  const qVariants = expandSearchQueryVariants(lower);
  const allowBroad = isCategorySearchQuery(lower);
  let score = Math.max(...qVariants.map(qv => scoreSearchMatch(item, qv, { allowBroadMatch: allowBroad })));
  if (score <= 0) return 0;

  // Regional & format relevance boosts
  if (/\bsouth\b/i.test(lower) && !/south\s*(africa|korea|park)/i.test(lower)) {
    if (/south\s*indian|tamil|telugu|malayalam|kannada|tollywood|kollywood/i.test(hay)) score += 75;
    if (/india/i.test(String(item?.country || ""))) score += 35;
    if (/\bvs\b/i.test(String(item?.title || ""))) score -= 60;
  }
  if (/\bmovie|movies|film\b/i.test(lower) && item?.isMovie) score += 12;
  if (/\bseries|drama\b/i.test(lower) && item?.isSeries) score += 12;

  if (item?.source !== "movielinkbd" || item?.mbSubjectId) score += 10;
  if (item?.poster || item?.previewImage) score += 6;
  const yr = Number(String(item?.year || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || 0);
  if (yr >= 2024) score += 38;
  else if (yr >= 2018) score += 28;
  else if (yr >= 2005) score += 15;
  return score;
}

app.get("/api/suggest", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const safeMode = req.query.safe === "1";
  const subjectType = String(req.query.subjectType || "0");
  if (!q) return res.json({ ok: true, query: "", items: [], suggestions: [] });
  try {
    const allowMusicSearch = /\b(?:song|songs|music|ost|pop|lyric|lyrical|remix|album|naat|bhajan|track|audio)\b/i.test(q);
    const mbParams = new URLSearchParams({ q, page: "1", subjectType });
    if (safeMode) mbParams.set("safe", "1");
    const [mlbdRes, mbRes, imdbRes] = await Promise.allSettled([
      getMlbdSuggest(q),
      handleMovieBoxRoute("search", mbParams),
      fetchImdbSuggestTitles(q)
    ]);
    const mlbdItems = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [];
    const mbItems = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.items) ? mbRes.value.items : [];
    const mlbdSugg = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.suggestions) ? mlbdRes.value.suggestions : [];
    const mbSugg = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.suggestions) ? mbRes.value.suggestions : [];
    const imdbSugg = imdbRes.status === "fulfilled" && Array.isArray(imdbRes.value) ? imdbRes.value : [];

    const seen = new Set();
    const candidates = [];
    for (const item of [...mbItems, ...mlbdItems]) {
      if (!item || isNigerianContent(item)) continue;
      if (!allowMusicSearch && isMusicOrClipSubject(item)) continue;
      if (safeMode && isAdultCatalogItem(item)) continue;
      if (!matchesSearchType(item, subjectType)) continue;
      if (scoreMergedSearchItem(item, q) <= 0) continue;
      const key = item?.path || String(item?.title || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
    }
    candidates.sort((a, b) => scoreMergedSearchItem(b, q) - scoreMergedSearchItem(a, q) || (Number(b.views) || 0) - (Number(a.views) || 0));
    const merged = candidates.slice(0, 40);
    const suggestions = collectTitleSuggestions(q, {
      suggestWords: mbSugg,
      items: merged,
      extraTitles: [...mlbdSugg, ...imdbSugg],
      limit: 15
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({
      ok: true,
      query: q,
      items: merged,
      suggestions
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err?.message || "Suggestions unavailable" });
  }
});

app.get("/api/home-feed", async (_req, res) => {
  try {
    const data = await getMlbdHomeFeed();
    res.setHeader("Cache-Control", "public, max-age=120");
    return res.json(data);
  } catch (err) {
    return res.status(503).json({ ok: false, error: err?.message || "Home feed unavailable" });
  }
});

app.get("/api/catalog", async (req, res) => {
  try {
    const pathParam = String(req.query.path || req.query.category || "/");
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    if (q) {
      const data = await getMlbdCatalog({ path: pathParam, q, page });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json(data);
    }
    const cacheKey = `mlbd-catalog:${pathParam.toLowerCase()}:${page}`;
    const out = await getSwrJsonCached(
      cacheKey,
      {
        freshMs: 60000,
        staleMs: 300000,
        isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0)
      },
      async () => {
        const data = await getMlbdCatalog({ path: pathParam, q: "", page });
        if (Array.isArray(data?.items)) {
          data.items = sortCatalogNewestFirst(data.items).map(compactCatalogCard);
        }
        return data;
      }
    );
    return sendPreGzipped(req, res, out, out?.payload?.items?.length ? "public, max-age=90, stale-while-revalidate=180" : "no-store");
  } catch (err) {
    return res.status(503).json({ ok: false, error: err?.message || "Catalog unavailable" });
  }
});

app.get("/api/details", async (req, res) => {
  const pathParam = String(req.query.path || "").trim();
  if (!pathParam) {
    return res.status(400).json({ ok: false, error: "Missing path parameter" });
  }
  try {
    if (pathParam.startsWith("/mb/")) {
      const mbPayload = await handleMovieBoxRoute("details", new URLSearchParams({
        path: pathParam,
        title: String(req.query.title || "")
      }));
      return res.json(mbPayload);
    }
    const data = await getMlbdDetails(pathParam, String(req.query.title || ""), {
      dubLock: req.query.dubLock === "1"
    });
    res.setHeader("Cache-Control", data?.detail?.hasResource ? "public, max-age=120" : "no-store");
    return res.json(data);
  } catch (err) {
    return res.status(503).json({ ok: false, error: err?.message || "Title details unavailable" });
  }
});

app.get("/api/go", async (req, res) => {
  const token = String(req.query.t || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return res.status(400).type("text/plain").send("Invalid or expired download redirect token");
  }
  let redirectTarget = targetUrl;
  if (/fifadekho\.com\/[a-z0-9]+/i.test(targetUrl) && !targetUrl.includes("view=links")) {
    const linksPageUrl = `${targetUrl.replace(/\/+$/, "")}?view=links`;
    try {
      let html = "";
      try {
        const r = await fetch(linksPageUrl, {
          headers: { ...CHROME_SEC_HEADERS, "User-Agent": MOVIEBOX_UA, Referer: "https://fifadekho.com/" },
          signal: AbortSignal.timeout(8000)
        });
        if (r.ok) html = await r.text();
      } catch {}
      if (!html) {
        const cRes = await curlHttpRequest(linksPageUrl, {
          headers: { ...CHROME_SEC_HEADERS, "User-Agent": MOVIEBOX_UA, Referer: "https://fifadekho.com/" },
          timeoutMs: 8000
        });
        if (cRes?.ok && cRes.text) html = cRes.text;
      }
      if (html) {
        const directMatch =
          html.match(/<a\s[^>]*href="(https?:\/\/(?:hubcloud|new\d*\.xcloud|gdflix)[^"]+)"[^>]*class="[^"]*nl-link-btn/i) ||
          html.match(/<a\s[^>]*class="[^"]*nl-link-btn[^"]*"[^>]*href="(https?:\/\/[^"]+)"/i);
        redirectTarget = directMatch?.[1] || linksPageUrl;
      } else {
        redirectTarget = linksPageUrl;
      }
    } catch {
      redirectTarget = linksPageUrl;
    }
  }
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, redirectTarget);
});

app.get("/api/mlbd-hls.m3u8", async (req, res) => {
  const token = String(req.query.t || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return res.status(400).type("text/plain").send("Invalid or expired MovieStreamBD HLS token");
  }
  try {
    const hlsHeaders = {
      ...CHROME_SEC_HEADERS,
      "User-Agent": MOVIEBOX_UA,
      Referer: getActiveMlbdReferer(),
      Accept: "*/*"
    };
    let rawText = "";
    let finalUrl = targetUrl;
    let lastStatus = 502;
    try {
      const upstream = await fetchMediaWithRetry(
        targetUrl,
        "GET",
        hlsHeaders,
        null,
        2,
        20000
      );
      lastStatus = upstream.status || 502;
      if (upstream.ok) {
        rawText = await upstream.text();
        finalUrl = upstream.url || targetUrl;
      } else {
        try { await upstream.body?.cancel(); } catch {}
      }
    } catch {}
    if (!rawText) {
      const curlRes = await curlHttpRequest(targetUrl, {
        headers: hlsHeaders,
        timeoutMs: 20000
      });
      if (curlRes?.ok && curlRes.text) {
        rawText = curlRes.text;
        finalUrl = curlRes.finalUrl || targetUrl;
      } else if (curlRes?.status) {
        lastStatus = curlRes.status;
      }
    }
    if (!rawText) {
      return res.status(lastStatus || 502).type("text/plain").send("HLS playlist unavailable");
    }
    const rewritten = rewriteMlbdHlsPlaylist(rawText, finalUrl);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(rewritten);
  } catch (err) {
    return res.status(502).type("text/plain").send(err?.message || "MovieStreamBD HLS proxy failed");
  }
});

app.all("/api/mlbd-stream.mp4", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).set("Allow", "GET, HEAD").send("Method not allowed");
  }
  const token = String(req.query.t || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return res.status(400).type("text/plain").send("Invalid or expired MovieStreamBD stream token");
  }
  const forceDownload = req.query.download === "1";
  const dataSaver = req.query.saver === "1";
  const customFilename = String(req.query.filename || "");
  const isHlsSegment = /\/(?:s|vseg)\//i.test(targetUrl);
  try {
    return await proxyMediaStream(
      req,
      res,
      targetUrl,
      { Referer: getActiveMlbdReferer() },
      forceDownload,
      customFilename,
      { isHlsSegment, dataSaver }
    );
  } catch (err) {
    return res.status(502).type("text/plain").send(
      err?.name === "TimeoutError" ? "MovieStreamBD stream timed out" : "MovieStreamBD stream unavailable"
    );
  }
});

// Download helper for season ZIP & one-click episode fetch
app.get("/api/movie-api/download-file", async (req, res) => {
  try {
    const incomingUrl = new URL(req.originalUrl, getBaseUrl(req));
    const query = new URLSearchParams(incomingUrl.search);
    const reqPath = String(query.get("path") || "");
    const streamPayload = isMlbdPath(reqPath)
      ? await getMlbdStream({ path: reqPath, se: query.get("se") || 0, ep: query.get("ep") || 1 })
      : await handleMovieBoxRoute("stream", query);
    const sources = Array.isArray(streamPayload?.sources) ? streamPayload.sources : [];
    const best = sources.find(s => s?.url && !/\.m3u8(?:$|[?#])/i.test(s.url)) || sources[0];
    if (!best?.url) {
      return res.status(404).json({ ok: false, error: "No downloadable MP4 source found" });
    }
    const parsed = new URL(best.url, getBaseUrl(req));
    const cpToken = parsed.pathname === "/api/cinepulse-media" ? parsed.searchParams.get("t") : "";
    if (cpToken && /^cp1[A-Za-z0-9._~-]{8,2048}$/.test(cpToken) && process.env.CINEPULSE_API_KEY) {
      return await proxyMediaStream(
        req,
        res,
        `${CINEPULSE_UPSTREAM}/api/mb-stream.mp4?t=${encodeURIComponent(cpToken)}`,
        { "x-api-key": process.env.CINEPULSE_API_KEY },
        true
      );
    }
    const token = parsed.searchParams.get("mb") || parsed.searchParams.get("t");
    const targetUrl = validateExternalHttpUrl(verifyMediaToken(token));
    if (!targetUrl) {
      return res.status(404).json({ ok: false, error: "Download token unavailable" });
    }
    const referer = isMlbdPath(reqPath) ? getActiveMlbdReferer() : MOVIEBOX_PLAYER_REFERER;
    return await proxyMediaStream(req, res, targetUrl, { Referer: referer }, true);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || "Download failed" });
  }
});

const cdnSpeedCache = new Map();
const CDN_SPEED_TTL_MS = 120000;

function resolveProbeTargetForSource(src) {
  const rawUrl = String(src?.url || "").trim();
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    if (parsed.pathname === "/api/mlbd-stream.mp4" || parsed.pathname === "/api/mlbd-hls.m3u8") {
      const targetUrl = resolveSafeMlbdToken(parsed.searchParams.get("t") || "");
      if (!targetUrl) return null;
      return {
        targetUrl,
        hostKey: new URL(targetUrl).hostname,
        headers: { "User-Agent": MOVIEBOX_UA, Referer: getActiveMlbdReferer(), Accept: "*/*" },
        isPlaylist: parsed.pathname === "/api/mlbd-hls.m3u8"
      };
    }
    if (parsed.pathname === "/api/cinepulse-media") {
      const mbToken = parsed.searchParams.get("mb") || "";
      if (mbToken) {
        const targetUrl = verifyMediaToken(mbToken);
        if (!targetUrl) return null;
        return {
          targetUrl,
          hostKey: new URL(targetUrl).hostname,
          headers: { "User-Agent": MOVIEBOX_UA, Referer: MOVIEBOX_PLAYER_REFERER, Accept: "*/*" },
          isPlaylist: false
        };
      }
      const cpToken = parsed.searchParams.get("t") || "";
      if (cpToken && process.env.CINEPULSE_API_KEY) {
        const targetUrl = `${CINEPULSE_UPSTREAM}/api/mb-stream.mp4?t=${encodeURIComponent(cpToken)}`;
        return {
          targetUrl,
          hostKey: new URL(targetUrl).hostname,
          headers: { "User-Agent": MOVIEBOX_UA, "x-api-key": process.env.CINEPULSE_API_KEY, Accept: "*/*" },
          isPlaylist: false
        };
      }
    }
    if (/^\/api\/sports-hls\//i.test(parsed.pathname)) {
      const targetUrl = verifyMediaToken(parsed.searchParams.get("t") || "");
      if (!targetUrl) return null;
      return {
        targetUrl,
        hostKey: new URL(targetUrl).hostname,
        headers: { "User-Agent": MOVIEBOX_UA, Referer: MOVIEBOX_PLAYER_REFERER, Accept: "*/*" },
        isPlaylist: true
      };
    }
  } catch {}
  return null;
}

async function probeSingleSourceSpeed(probe) {
  if (!probe?.targetUrl || !probe?.hostKey) return null;
  const cacheKey = `${probe.hostKey}:${probe.isPlaylist ? "hls" : "mp4"}`;
  const cached = cdnSpeedCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < CDN_SPEED_TTL_MS) {
    return cached;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1100);
  const t0 = performance.now();
  try {
    const reqHeaders = new Headers(probe.headers);
    if (!probe.isPlaylist) reqHeaders.set("Range", "bytes=0-32767");
    const up = await fetch(probe.targetUrl, {
      method: "GET",
      headers: reqHeaders,
      redirect: "follow",
      signal: ac.signal
    });
    const ttfbMs = Math.max(1, Math.round(performance.now() - t0));
    let bytes = 0;
    if (up.ok || up.status === 206) {
      const reader = up.body?.getReader?.();
      if (reader) {
        try {
          const first = await reader.read();
          if (first?.value?.byteLength) bytes += first.value.byteLength;
        } catch {}
        try { await reader.cancel(); } catch {}
      }
    } else {
      try { await up.body?.cancel(); } catch {}
    }
    const totalMs = Math.max(1, Math.round(performance.now() - t0));
    const bps = bytes > 0 ? Math.round((bytes * 1000) / totalMs) : 0;
    const result = {
      ok: up.ok || up.status === 206,
      status: up.status,
      latencyMs: ttfbMs,
      bps,
      checkedAt: Date.now()
    };
    if (cdnSpeedCache.size >= 200) {
      const firstKey = cdnSpeedCache.keys().next().value;
      if (firstKey) cdnSpeedCache.delete(firstKey);
    }
    cdnSpeedCache.set(cacheKey, result);
    return result;
  } catch {
    const failRes = { ok: false, status: 0, latencyMs: 1100, bps: 0, checkedAt: Date.now() };
    cdnSpeedCache.set(cacheKey, failRes);
    return failRes;
  } finally {
    clearTimeout(timer);
  }
}

async function probeAndRankStreamPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const rawSources = Array.isArray(payload.sources)
    ? payload.sources
    : Array.isArray(payload.stream?.sources)
      ? payload.stream.sources
      : [];
  if (!rawSources.length) return payload;

  const probedTargets = rawSources.map(src => ({ src, probe: resolveProbeTargetForSource(src) }));
  const uniqueCacheKeys = new Map();
  for (const item of probedTargets) {
    if (!item.probe) continue;
    const ck = `${item.probe.hostKey}:${item.probe.isPlaylist ? "hls" : "mp4"}`;
    if (!uniqueCacheKeys.has(ck) && uniqueCacheKeys.size < 5) {
      uniqueCacheKeys.set(ck, item.probe);
    }
  }
  const probeResults = new Map();
  if (uniqueCacheKeys.size > 0) {
    await Promise.allSettled(
      [...uniqueCacheKeys.entries()].map(async ([ck, p]) => {
        const res = await probeSingleSourceSpeed(p);
        if (res) probeResults.set(ck, res);
      })
    );
  }

  const qualityRank = q => Number(String(q || "").match(/\d+/)?.[0] || 0);
  const scored = probedTargets.map(({ src, probe }, idx) => {
    const ck = probe ? `${probe.hostKey}:${probe.isPlaylist ? "hls" : "mp4"}` : "";
    const stats = ck ? probeResults.get(ck) : null;
    const serverOk = stats ? Boolean(stats.ok) : true;
    const latencyMs = stats ? stats.latencyMs : 500;
    const bps = stats ? stats.bps : 0;
    const isHls = /\.m3u8(?:$|[?#])/i.test(String(src?.url || "")) || /hls/i.test(String(src?.format || ""));
    const fastBonus = serverOk ? Math.max(0, 1000 - latencyMs) + Math.min(800, Math.round(bps / 15000)) : -5000;
    const qualScore = qualityRank(src?.quality) || (isHls ? 720 : 480);
    // Keep fast servers on top; among fast servers (<450ms), favor crisp quality & adaptive HLS
    const speedTier = !serverOk ? 0 : latencyMs <= 160 ? 3 : latencyMs <= 380 ? 2 : latencyMs <= 750 ? 1 : 0;
    const totalScore = speedTier * 10000 + fastBonus + (speedTier >= 1 ? qualScore * 2 : 0);
    return {
      idx,
      totalScore,
      source: {
        ...src,
        serverOk,
        serverLatencyMs: latencyMs,
        ...(bps > 0 ? { serverBps: bps } : {}),
        ...(serverOk && latencyMs <= 450 ? { autoFast: true } : {})
      }
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore || a.idx - b.idx);
  const ranked = scored.map(x => x.source);
  if (ranked[0]) ranked[0] = { ...ranked[0], autoSelected: true };

  if (Array.isArray(payload.sources)) payload.sources = ranked;
  if (payload.stream && Array.isArray(payload.stream.sources)) payload.stream.sources = ranked;
  return payload;
}

// Main Upstream API Proxy (MovieBox Direct + MovieLinkBD Unified)
app.all("/api/movie-api/*", async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const legacy = String(req.params[0] || "").replace(/^\/+|\/+$/g, "");
  const incomingUrl = new URL(req.originalUrl, getBaseUrl(req));
  const query = new URLSearchParams(incomingUrl.search);
  const startedAt = Date.now();
  const rawIdParam = String(query.get("id") || "").trim();
  const rawDetailParam = String(query.get("detailPath") || "").trim();
  let reqPath = String(query.get("path") || "").trim();
  if (!isMlbdPath(reqPath)) {
    if (isMlbdPath(rawDetailParam)) {
      reqPath = rawDetailParam;
    } else if (/^(?:_(?:movie|series|anime)_)?mKs_/i.test(rawIdParam)) {
      const mksId = rawIdParam.replace(/^_(?:movie|series|anime)_/i, "");
      reqPath = /^_series_/i.test(rawIdParam) ? `/series/${mksId}` : /^_anime_/i.test(rawIdParam) ? `/anime/${mksId}` : `/movie/${mksId}`;
    }
  }

  try {
    // Route MovieLinkBD item paths directly (/movie/*, /series/*, /anime/*, /mlbd/*)
    if (legacy === "details" && isMlbdPath(reqPath)) {
      const payload = await getMlbdDetails(reqPath, String(query.get("title") || ""), {
        dubLock: query.get("dubLock") === "1"
      });
      res.setHeader("Cache-Control", payload?.detail?.hasResource ? "public, max-age=120" : "no-store");
      return res.status(200).json(payload);
    }

    if (legacy === "stream" && isMlbdPath(reqPath)) {
      const payload = await probeAndRankStreamPayload(
        await getMlbdStream({
          path: reqPath,
          se: query.get("se") || 0,
          ep: query.get("ep") || 1,
          title: String(query.get("title") || ""),
          dubLock: query.get("dubLock") === "1"
        })
      );
      recordStreamEvent({
        title: query.get("title") || reqPath,
        subjectId: reqPath,
        se: query.get("se") || "0",
        ep: query.get("ep") || "0",
        status: 200,
        sourceCount: payload.sources?.length || 0,
        message: "MovieStreamBD",
        durationMs: Date.now() - startedAt
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    }

    if (legacy === "home") {
      const homeOut = await getMergedHomePayloadCached(query);
      return sendPreGzipped(req, res, homeOut, "public, max-age=60, stale-while-revalidate=120");
    }

    if (legacy === "categories") {
      const out = await getSwrJsonCached(
        "api:categories",
        {
          freshMs: 180000,
          staleMs: 900000,
          isCacheable: d => Boolean(d?.ok && Array.isArray(d?.categories) && d.categories.length > 0)
        },
        async () => {
          const [mbRes, mlbdRes] = await Promise.allSettled([
            handleMovieBoxRoute("categories", new URLSearchParams()),
            getMlbdCategories()
          ]);
          const mbCats = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.categories) ? mbRes.value.categories : [];
          const mlbdCats = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.categories) ? mlbdRes.value.categories : [];
          const seen = new Set(mbCats.map(c => c.path));
          const mergedCats = [...mbCats, ...mlbdCats.filter(c => c?.path && !seen.has(c.path))];
          return {
            ok: true,
            categories: mergedCats,
            servers: mlbdRes.status === "fulfilled" ? mlbdRes.value?.servers || [] : []
          };
        }
      );
      return sendPreGzipped(req, res, out, "public, max-age=180, stale-while-revalidate=600");
    }

    if (legacy === "filter-options" && !query.toString()) {
      const out = await getSwrJsonCached(
        "api:filter-options",
        { freshMs: 600000, staleMs: 1800000 },
        () => handleMovieBoxRoute("filter-options", new URLSearchParams())
      );
      return sendPreGzipped(req, res, out, "public, max-age=600, stale-while-revalidate=1200");
    }

    if (legacy === "trending") {
      const tPage = Math.max(1, Number(query.get("page")) || 1);
      const tPerPage = Math.max(10, Math.min(60, Number(query.get("perPage")) || 30));
      const out = await getSwrJsonCached(
        `api:trending:${tPage}:${tPerPage}`,
        {
          freshMs: 60000,
          staleMs: 300000,
          isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0)
        },
        async () => {
          const d = await handleMovieBoxRoute("trending", query);
          if (d && Array.isArray(d.items)) {
            d.items = sortCatalogNewestFirst(d.items.filter(x => x && !isNigerianContent(x))).map(compactCatalogCard);
          }
          return d;
        }
      );
      return sendPreGzipped(req, res, out, "public, max-age=60, stale-while-revalidate=180");
    }

    if (legacy === "hot-search") {
      const safeKey = query.get("safe") === "1" ? "1" : "0";
      const out = await getSwrJsonCached(
        `api:hot-search:${safeKey}`,
        { freshMs: 120000, staleMs: 600000 },
        () => handleMovieBoxRoute("hot-search", query)
      );
      return sendPreGzipped(req, res, out, "public, max-age=120, stale-while-revalidate=300");
    }

    if (legacy === "sports" && !query.toString()) {
      const out = await getSwrJsonCached(
        "api:sports",
        {
          freshMs: 20000,
          staleMs: 90000,
          isCacheable: d => Boolean(d?.ok && Array.isArray(d?.channels) && d.channels.length > 0)
        },
        () => handleMovieBoxRoute("sports", new URLSearchParams())
      );
      return sendPreGzipped(req, res, out, "public, max-age=20, stale-while-revalidate=60");
    }

    if (legacy === "platform") {
      const pName = String(query.get("name") || query.get("platform") || "Netflix").trim();
      const pPage = Math.max(1, Number(query.get("page")) || 1);
      const out = await getSwrJsonCached(
        `api:platform:${pName.toLowerCase()}:${pPage}`,
        {
          freshMs: 90000,
          staleMs: 360000,
          isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0)
        },
        async () => {
          const d = await handleMovieBoxRoute("platform", query);
          if (d && Array.isArray(d.items)) {
            d.items = sortCatalogNewestFirst(d.items.filter(x => x && !isNigerianContent(x))).map(compactCatalogCard);
          }
          return d;
        }
      );
      return sendPreGzipped(req, res, out, out?.payload?.items?.length ? "public, max-age=90, stale-while-revalidate=180" : "no-store");
    }

    if (legacy === "search") {
      const q = String(query.get("q") || "").trim();
      const page = Math.max(1, Number(query.get("page")) || 1);
      const safeMode = query.get("safe") === "1";
      const subjectType = String(query.get("subjectType") || "0");
      const allowMusicSearch = /\b(?:song|songs|music|ost|pop|lyric|lyrical|remix|album|naat|bhajan|track|audio)\b/i.test(q);
      const [mbRes, mlbdRes, imdbRes] = await Promise.allSettled([
        handleMovieBoxRoute("search", query),
        q ? getMlbdCatalog({ path: "/search", q, page }) : Promise.resolve({ items: [] }),
        q && page === 1 ? fetchImdbSuggestTitles(q) : Promise.resolve([])
      ]);
      const mbItems = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.items) ? mbRes.value.items : [];
      const mlbdItems = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [];
      const mbSugg = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.suggestions) ? mbRes.value.suggestions : [];
      const imdbSugg = imdbRes.status === "fulfilled" && Array.isArray(imdbRes.value) ? imdbRes.value : [];
      const mlbdDirectOk = isMlbdDirectPlaybackAvailable();
      const isPlayableCandidate = x => Boolean(x && x.hasResource !== false && (mlbdDirectOk || x.source !== "movielinkbd" || x.mbSubjectId));
      const candidates = [];
      const seen = new Set();
      for (const candidate of [...mbItems, ...mlbdItems]) {
        if (!candidate || isNigerianContent(candidate)) continue;
        if (!allowMusicSearch && isMusicOrClipSubject(candidate)) continue;
        if (safeMode && isAdultCatalogItem(candidate)) continue;
        if (!matchesSearchType(candidate, subjectType)) continue;
        if (q && scoreMergedSearchItem(candidate, q) <= 0) continue;
        const key = candidate.path || String(candidate.title || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
      const hasRes = candidates.filter(x => x && x.hasResource !== false);
      const finalPool = hasRes.length ? hasRes : candidates;
      finalPool.sort((a, b) =>
        scoreMergedSearchItem(b, q) - scoreMergedSearchItem(a, q) ||
        (isPlayableCandidate(b) ? 1 : 0) - (isPlayableCandidate(a) ? 1 : 0) ||
        (Number(b.views) || 0) - (Number(a.views) || 0)
      );
      const merged = finalPool.slice(0, 100);
      const suggestions = q
        ? collectTitleSuggestions(q, { suggestWords: mbSugg, items: merged, extraTitles: imdbSugg, limit: 15 })
        : [];
      const searchHasMore = Boolean(mbRes.value?.hasMore || mlbdRes.value?.hasMore || finalPool.length >= 30);
      const searchMaxPage = Math.max(
        page,
        Number(mbRes.value?.totalPages || page),
        Number(mlbdRes.value?.maxPage || page),
        searchHasMore ? page + 1 : page
      );
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json({
        ok: true,
        items: merged,
        suggestions,
        totalCount: merged.length,
        page,
        totalPages: searchMaxPage,
        maxPage: searchMaxPage,
        hasMore: searchHasMore
      });
    }

    if (legacy === "catalog") {
      const category = String(query.get("category") || "/");
      const page = Math.max(1, Number(query.get("page")) || 1);
      const extraQuery = ["channelId", "genre", "country", "year", "sort", "classify"].some(k => query.has(k));
      const normCat = category.toLowerCase().replace(/\/+$/, "") || "/";
      const cacheKey = `api:catalog:${normCat}:${page}`;
      const out = await getSwrJsonCached(
        cacheKey,
        {
          freshMs: 90000,
          staleMs: 600000,
          bypass: extraQuery,
          isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0)
        },
        () => buildUnifiedCatalogPayload(category, page, query)
      );
      const hasItems = Array.isArray(out?.payload?.items) && out.payload.items.length > 0;
      return sendPreGzipped(req, res, out, hasItems ? "public, max-age=60, stale-while-revalidate=300" : "no-store");
    }

    let payload = await handleMovieBoxRoute(legacy, query);
    if (payload && payload.ok === false && /^Unknown MovieBox API endpoint/i.test(payload.error || "")) {
      return res.status(404).json(payload);
    }
    if (legacy === "stream") {
      payload = await probeAndRankStreamPayload(payload);
      let curSources = Array.isArray(payload?.sources)
        ? payload.sources
        : Array.isArray(payload?.stream?.sources)
          ? payload.stream.sources
          : [];
      let sourceCount = curSources.length;
      const topSourceSlowOrBad = sourceCount > 0 && (!curSources[0]?.serverOk || Number(curSources[0]?.serverLatencyMs || 0) > 700);
      const reqTitle = String(query.get("title") || "").trim();
      if ((sourceCount === 0 || topSourceSlowOrBad) && reqTitle) {
        try {
          const wantMovie = (Number(query.get("se") || 0) || 0) === 0;
          const mlbdBackup = await Promise.race([
            findExactTitleMlbdBackup(reqTitle, wantMovie),
            new Promise(r => setTimeout(() => r(null), sourceCount > 0 ? 1500 : 8000))
          ]);
          if (mlbdBackup?.path) {
            const bStream = await Promise.race([
              getMlbdStream({
                path: mlbdBackup.path,
                se: query.get("se") || 0,
                ep: query.get("ep") || 1,
                title: reqTitle
              }),
              new Promise(r => setTimeout(() => r(null), sourceCount > 0 ? 1800 : 8000))
            ]);
            const bSources = Array.isArray(bStream?.sources) ? bStream.sources : [];
            if (bSources.length) {
              payload = await probeAndRankStreamPayload({
                ...(payload && typeof payload === "object" ? payload : { ok: true }),
                ok: true,
                sources: [...curSources, ...bSources],
                subtitles: Array.isArray(payload?.subtitles) && payload.subtitles.length ? payload.subtitles : (bStream.subtitles || []),
                backupFrom: "moviestreambd"
              });
              sourceCount = Array.isArray(payload?.sources) ? payload.sources.length : bSources.length;
            }
          }
        } catch {}
      }
      const evt = {
        title: reqTitle,
        subjectId: query.get("subjectId") || "",
        se: query.get("se") || "0",
        ep: query.get("ep") || "0",
        status: payload?.ok === false && sourceCount === 0 ? 502 : 200,
        sourceCount,
        message: payload?.message || payload?.error || "",
        durationMs: Date.now() - startedAt
      };
      recordStreamEvent(evt);
      if (sourceCount === 0 || evt.status >= 400) {
        console.warn("[MovieBox stream empty/error]", JSON.stringify(evt));
      }
    }
    const statusCode = payload?.ok === false && !(Array.isArray(payload?.sources) && payload.sources.length) ? 502 : 200;
    if (legacy === "status" && payload && typeof payload === "object") {
      payload.recentStreamEvents = recentStreamEvents.slice(0, 15);
      payload.cinepulseConfigured = isCinePulseConfigured();
      payload.activeMlbdMirror = getActiveMlbdReferer();
    }
    res.setHeader("Cache-Control", legacy === "stream" ? "no-store" : "public, max-age=60");
    return res.status(statusCode).json(payload);
  } catch (error) {
    console.warn(`[MovieBox API fallback] ${legacy}:`, error?.message || error);
    if (isCinePulseConfigured()) {
      const cpRoute = legacy === "shorts" ? "reels" : legacy === "sports" ? "sports/matches" : legacy;
      const cpQuery = new URLSearchParams(query);
      if (legacy === "shorts" && !cpQuery.has("type")) cpQuery.set("type", "all");
      if (legacy === "catalog" && cpQuery.has("path") && !cpQuery.has("category")) {
        cpQuery.set("category", cpQuery.get("path"));
        cpQuery.delete("path");
      }
      if (legacy === "platform" && cpQuery.has("name") && !cpQuery.has("platform")) {
        cpQuery.set("platform", cpQuery.get("name"));
        cpQuery.delete("name");
      }
      const cpRes = await fetchCinePulseApi(cpRoute, cpQuery, {
        accept: req.get("accept") || "application/json",
        timeoutMs: 15000
      });
      if (cpRes.ok && cpRes.data) {
        res.setHeader("Cache-Control", "no-store");
        return res.json(normalizeCinePulsePayload(cpRoute, cpRes.data));
      }
    }
    const fallback = handleMockMovieApi(legacy, query, getBaseUrl(req));
    if (legacy === "stream") {
      const sourceCount = Array.isArray(fallback?.stream?.sources) ? fallback.stream.sources.length : 0;
      recordStreamEvent({
        title: query.get("title") || "",
        subjectId: query.get("subjectId") || "",
        se: query.get("se") || "0",
        ep: query.get("ep") || "0",
        status: 200,
        sourceCount,
        fallback: true,
        error: error?.message || String(error),
        durationMs: Date.now() - startedAt
      });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json(fallback);
  }
});

// Fast SWR cache for merged /api/movie-api/home payload + pre-gzipped buffer + generic API SWR LRU
const HOME_FRESH_MS = 60 * 1000;
const HOME_STALE_MS = 5 * 60 * 1000;
let mergedHomeCache = null;
let mergedHomeInFlight = null;

const SWR_MAX_ENTRIES = 90;
const swrApiCache = new Map();
const swrInFlight = new Map();

function setSwrEntry(key, entry) {
  if (swrApiCache.has(key)) swrApiCache.delete(key);
  swrApiCache.set(key, entry);
  while (swrApiCache.size > SWR_MAX_ENTRIES) {
    const oldestKey = swrApiCache.keys().next().value;
    if (oldestKey === undefined) break;
    swrApiCache.delete(oldestKey);
  }
}

async function encodePreGzipped(payload) {
  const jsonStr = JSON.stringify(payload);
  const gzipBuf = jsonStr.length >= 768
    ? await gzipAsync(Buffer.from(jsonStr, "utf8"), { level: 4 }).catch(() => null)
    : null;
  return { payload, jsonStr, gzipBuf, builtAt: Date.now() };
}

function sendPreGzipped(req, res, out, cacheHeader) {
  if (cacheHeader) res.setHeader("Cache-Control", cacheHeader);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const acceptEnc = String(req.headers["accept-encoding"] || "");
  if (/\bgzip\b/i.test(acceptEnc) && out?.gzipBuf) {
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Length", String(out.gzipBuf.length));
    return res.status(200).end(out.gzipBuf);
  }
  return res.status(200).send(out.jsonStr);
}

function isSwrAuthOrForbiddenError(err) {
  const st = Number(err?.status || 0);
  return st === 401 || st === 403 || Boolean(err?.isAuthError) || Boolean(err?.isCloudflareBlock);
}

async function getSwrJsonCached(key, opts = {}, builderFn) {
  const { freshMs = 60000, staleMs = 300000, bypass = false, isCacheable = null } = opts;
  if (bypass) {
    const raw = await builderFn();
    return await encodePreGzipped(raw);
  }
  const now = Date.now();
  const hit = swrApiCache.get(key);
  if (hit && now - hit.builtAt < freshMs) {
    return hit;
  }
  const refresh = () => {
    if (swrInFlight.has(key)) return swrInFlight.get(key);
    const p = Promise.resolve()
      .then(() => builderFn())
      .then(async payload => {
        const out = await encodePreGzipped(payload);
        if (!isCacheable || isCacheable(payload)) {
          setSwrEntry(key, out);
        }
        return out;
      })
      .catch(err => {
        if (isSwrAuthOrForbiddenError(err)) {
          swrApiCache.delete(key);
        }
        throw err;
      })
      .finally(() => {
        swrInFlight.delete(key);
      });
    swrInFlight.set(key, p);
    return p;
  };
  if (hit && now - hit.builtAt < staleMs) {
    refresh().catch(() => {});
    return hit;
  }
  try {
    return await refresh();
  } catch (err) {
    if (hit && !isSwrAuthOrForbiddenError(err)) return hit;
    throw err;
  }
}

function parseUploadCandidateMs(raw, nowLimit) {
  if (!raw) return 0;
  let ms = 0;
  if (typeof raw === "number") {
    ms = raw < 1e12 ? raw * 1000 : raw;
  } else {
    const s = String(raw).trim();
    if (!s || /^(?:19|20)\d{2}$/.test(s)) return 0;
    const lower = s.toLowerCase();
    if (/^\d{9,16}$/.test(s)) {
      const n = Number(s);
      ms = n < 1e12 ? n * 1000 : n;
    } else if (/\b(?:just now|now|today)\b/.test(lower)) {
      ms = Date.now();
    } else if (/\byesterday\b/.test(lower)) {
      ms = Date.now() - 86400 * 1000;
    } else {
      const ago = /(\d+)\s*(sec(?:ond)?s?|min(?:ute)?s?|hrs?|hours?|days?|weeks?|months?|years?)\s*ago/i.exec(lower);
      if (ago) {
        const n = Number(ago[1]) || 1;
        const u = ago[2].toLowerCase();
        const mult = u.startsWith("sec") ? 1000 : u.startsWith("min") ? 60000 : u.startsWith("h") ? 3600000 : u.startsWith("d") ? 86400000 : u.startsWith("w") ? 604800000 : u.startsWith("mo") ? 2592000000 : 31536000000;
        ms = Math.max(1, Date.now() - n * mult);
      } else {
        const parsed = Date.parse(s);
        if (Number.isFinite(parsed) && parsed > 0) ms = parsed;
      }
    }
  }
  return ms > 0 && ms <= nowLimit ? ms : 0;
}

function parseExactUploadMs(item) {
  if (!item || typeof item !== "object") return 0;
  const nowLimit = Date.now() + 12 * 3600 * 1000;
  let best = 0;
  for (const raw of [item.uploadedAtMs, item.uploadTimestamp]) {
    const ms = parseUploadCandidateMs(raw, nowLimit);
    if (ms > best) best = ms;
  }
  if (best === 0 && !item.fromArchive) {
    for (const raw of [item.uploadTime, item.updatedAt, item.createdAt]) {
      const ms = parseUploadCandidateMs(raw, nowLimit);
      if (ms > best) best = ms;
    }
  }
  return best;
}

function parseHomeRecencyMs(item) {
  if (!item || typeof item !== "object") return 0;
  const up = parseExactUploadMs(item);
  if (up > 0) return up;
  const nowLimit = Date.now() + 12 * 3600 * 1000;
  const rel = item.releaseDate || item.appointmentDate || (item.year && /^\d{4}$/.test(String(item.year)) ? `${item.year}-01-01` : "");
  const relMs = rel ? Date.parse(String(rel)) : 0;
  return Number.isFinite(relMs) && relMs > 0 && relMs <= nowLimit ? relMs : 0;
}

function getCatalogReleaseTimestamp(item) {
  const nowLimit = Date.now() + 12 * 3600 * 1000;
  const relRaw = item?.releaseDate || item?.appointmentDate || "";
  if (relRaw) {
    const t = Date.parse(String(relRaw));
    if (Number.isFinite(t) && t > 0) return t;
  }
  const yr = Number(String(item?.year || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || 0);
  if (yr >= 1900) {
    const yt = Date.parse(`${yr}-01-01`);
    if (Number.isFinite(yt) && yt > 0 && yt <= nowLimit) return yt;
  }
  return 0;
}

function sortCatalogNewestFirst(items = []) {
  const nowLimit = Date.now() + 12 * 3600 * 1000;
  const mlbdDirectOk = isMlbdDirectPlaybackAvailable();
  return [...(Array.isArray(items) ? items : [])]
    .map((item, idx) => {
      const up = parseExactUploadMs(item);
      const rel = getCatalogReleaseTimestamp(item);
      const isFuture = rel > nowLimit && up === 0;
      const isLiveUpdate = !item?.fromArchive ? 1 : 0;
      const recency = up > 0 ? up : rel;
      const hasPoster = item?.poster || item?.previewImage ? 1 : 0;
      const isDirect = (mlbdDirectOk || item?.source !== "movielinkbd" || item?.mbSubjectId) ? 1 : 0;
      return { item, idx, up, recency, isFuture, isLiveUpdate, hasPoster, isDirect };
    })
    .sort((a, b) => {
      if (a.isFuture !== b.isFuture) return a.isFuture ? 1 : -1;
      if (a.isFuture && b.isFuture) return a.recency - b.recency;
      if (!mlbdDirectOk && b.isDirect !== a.isDirect) return b.isDirect - a.isDirect;
      if (b.recency !== a.recency) return b.recency - a.recency;
      if (b.isLiveUpdate !== a.isLiveUpdate) return b.isLiveUpdate - a.isLiveUpdate;
      if (Boolean(b.up > 0) !== Boolean(a.up > 0)) return b.up > 0 ? 1 : -1;
      if (b.up !== a.up) return b.up - a.up;
      if (b.hasPoster !== a.hasPoster) return b.hasPoster - a.hasPoster;
      if (b.isDirect !== a.isDirect) return b.isDirect - a.isDirect;
      return (Number(b.item?.views) || 0) - (Number(a.item?.views) || 0) || a.idx - b.idx;
    })
    .map(x => x.item);
}

function decodeCardHtmlEntities(str = "") {
  const s = String(str || "");
  if (!s || !s.includes("&")) return s;
  return s
    .replace(/&rsquo;|&lsquo;|&#8217;|&#8216;|&#39;|&#039;/gi, "'")
    .replace(/&rdquo;|&ldquo;|&#8220;|&#8221;|&quot;/gi, "\"")
    .replace(/&ndash;|&#8211;/gi, "-")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : "";
    });
}

function normalizeCatalogDedupeKey(item) {
  if (!item || typeof item !== "object") return "";
  const rawTitle = decodeCardHtmlEntities(String(item.title || "")).trim();
  if (!rawTitle) return String(item.path || item.subjectId || item.id || "").trim().toLowerCase();
  const normTitle = rawTitle
    .toLowerCase()
    .replace(/\b(?:hdrip|web-dl|webrip|hdtc|camrip|bluray|dvdrip|1080p|720p|480p|x264|x265|hevc|the best quality|full movie|dual audio|hindi org|uncut)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, "");
  const kind = item.isSeries ? "s" : (item.isAnime ? "a" : "m");
  if (normTitle.length >= 3) return `${kind}:${normTitle}`;
  return String(item.path || item.subjectId || item.id || normTitle).trim().toLowerCase();
}

function pickBetterCatalogItem(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  const mergeMeta = (winner, loser) => {
    const winUp = parseExactUploadMs(winner);
    const loseUp = parseExactUploadMs(loser);
    const eitherLive = !winner?.fromArchive || !loser?.fromArchive;
    const bestUp = Math.max(winUp, loseUp);
    if ((bestUp > winUp) || (eitherLive && winner?.fromArchive)) {
      return {
        ...winner,
        ...(bestUp > 0 ? { uploadedAtMs: bestUp } : {}),
        uploadTime: winner.uploadTime || loser.uploadTime,
        ...(eitherLive ? { fromArchive: false } : {})
      };
    }
    return winner;
  };
  const mlbdDirectOk = isMlbdDirectPlaybackAvailable();
  const prevPoster = prev?.poster || prev?.previewImage ? 1 : 0;
  const nextPoster = next?.poster || next?.previewImage ? 1 : 0;
  if (nextPoster !== prevPoster) {
    return nextPoster > prevPoster ? mergeMeta(next, prev) : mergeMeta(prev, next);
  }
  const prevMb = prev?.mbSubjectId || prev?.source !== "movielinkbd" ? 1 : 0;
  const nextMb = next?.mbSubjectId || next?.source !== "movielinkbd" ? 1 : 0;
  if (!mlbdDirectOk && nextMb !== prevMb) {
    return nextMb > prevMb ? mergeMeta(next, prev) : mergeMeta(prev, next);
  }
  const prevUp = parseExactUploadMs(prev);
  const nextUp = parseExactUploadMs(next);
  if (nextUp !== prevUp) return nextUp > prevUp ? mergeMeta(next, prev) : mergeMeta(prev, next);
  if (Boolean(!next?.fromArchive) !== Boolean(!prev?.fromArchive)) {
    return !next?.fromArchive ? mergeMeta(next, prev) : mergeMeta(prev, next);
  }
  if (nextMb !== prevMb) return nextMb > prevMb ? mergeMeta(next, prev) : mergeMeta(prev, next);
  return mergeMeta(prev, next);
}

function dedupeCatalogItems(items = []) {
  const byKey = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = normalizeCatalogDedupeKey(item);
    if (!key) continue;
    byKey.set(key, pickBetterCatalogItem(byKey.get(key), item));
  }
  return [...byKey.values()];
}

function compactHomeCard(item) {
  if (!item || typeof item !== "object") return item;
  const out = {
    id: item.id,
    subjectId: item.subjectId,
    path: item.path,
    detailPath: item.detailPath,
    title: decodeCardHtmlEntities(item.title || ""),
    searchTitle: decodeCardHtmlEntities(item.searchTitle || ""),
    poster: item.poster || item.previewImage || "",
    rawPoster: item.rawPoster || "",
    quality: item.quality,
    language: item.language,
    country: item.country,
    genre: item.genre,
    type: item.type,
    typeBadge: item.typeBadge,
    isSeries: item.isSeries,
    isMovie: item.isMovie,
    isAnime: item.isAnime,
    isUpcoming: item.isUpcoming,
    year: item.year,
    rating: item.rating,
    releaseDate: item.releaseDate,
    uploadTime: item.uploadTime,
    uploadedAtMs: item.uploadedAtMs,
    duration: item.duration,
    hasResource: item.hasResource,
    source: item.source,
    mbSubjectId: item.mbSubjectId,
    mbDetailPath: item.mbDetailPath,
    _hindiCatalog: item._hindiCatalog
  };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || out[k] === "") delete out[k];
  }
  if (item.hasResource === false) out.hasResource = false;
  return out;
}

function compactCatalogCard(item) {
  const out = compactHomeCard(item);
  if (!out || typeof out !== "object") return out;
  if (item.isAdult === true) out.isAdult = true;
  if (item.isHindiDubbed === true) out.isHindiDubbed = true;
  if (item._animeCatalog === true) out._animeCatalog = true;
  if (item.views != null && Number(item.views) > 0) out.views = Number(item.views);
  if (Array.isArray(item.categories) && item.categories.length) out.categories = item.categories;
  return out;
}

function matchesCatalogRecentCategory(item, categoryPath = "/") {
  if (!item || typeof item !== "object") return false;
  if (isNigerianContent(item) || isMusicOrClipSubject(item) || item.hasResource === false) return false;
  const norm = String(categoryPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (norm === "/" || norm === "/all" || norm === "/new" || norm === "/recently-updated" || norm === "/popular" || norm === "/mostwatch/7d") {
    return !isAdultCatalogItem(item);
  }
  return matchesMlbdCategoryItem(item, norm);
}

function getRecentUploadsPoolForCategory(categoryPath = "/") {
  const norm = String(categoryPath || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (/^\/(?:top-rated|upcoming|adult18plus|midnight|genre\/(?:adult|erotic|hot))$/.test(norm)) {
    return [];
  }
  const home = mergedHomeCache?.payload;
  if (!home) return [];
  const mlbdLatestSec = (Array.isArray(home.mlbdSections) ? home.mlbdSections : []).find(s =>
    /latest\s*release|\b\/new\b/i.test(`${s?.title || ""} ${s?.categoryPath || ""}`)
  );
  const candidates = [
    ...(Array.isArray(home.recentlyUploaded) ? home.recentlyUploaded : []),
    ...(Array.isArray(mlbdLatestSec?.items) ? mlbdLatestSec.items : []),
    ...(Array.isArray(home.curated?.recentlyAdded) ? home.curated.recentlyAdded : []),
    ...(Array.isArray(home.curated?.latestMovies) ? home.curated.latestMovies : []),
    ...(Array.isArray(home.curated?.recentlyUpdated) ? home.curated.recentlyUpdated : []),
    ...(Array.isArray(home.mlbdBangla) ? home.mlbdBangla : []),
    ...(Array.isArray(home.mlbdSections) ? home.mlbdSections.flatMap(s => s?.items || []) : [])
  ];
  return candidates.filter(x => matchesCatalogRecentCategory(x, norm));
}

async function buildUnifiedCatalogPayload(category, page, query) {
  const norm = String(category || "/").toLowerCase().replace(/\/+$/, "") || "/";
  const isMlbdOnlyCategory = /^\/(?:language\/(?:dual-audio|gujrati|kannada|marathi|malaysian|vietnamese|german|italian|portuguese|others)|genre\/(?:biographical|historical|musical|sports|superhero|survival|suspense)|category\/|collection\/|collections)/i.test(category);
  const catKeywordFallback = c => {
    const low = String(c || "").toLowerCase();
    if (low.includes("mcu") || low.includes("marvel")) return "Marvel";
    if (low.includes("dc-universe") || low.includes("dceu")) return "Batman Superman";
    if (low.includes("wwe")) return "WWE";
    if (low.includes("dual-audio")) return "Hindi";
    if (low.includes("bangla-dubbed") || low.includes("bangla")) return "Bangla";
    const slug = low.replace(/^\/(?:language|genre|category|collection)\//, "").replace(/[-_]+/g, " ").trim();
    return slug || "Movie";
  };

  if (page === 1 && !mergedHomeCache?.payload && mergedHomeInFlight) {
    await Promise.race([mergedHomeInFlight.catch(() => null), new Promise(r => setTimeout(r, 2500))]);
  }
  const recentInjected = page === 1 ? getRecentUploadsPoolForCategory(norm) : [];

  if (isMlbdOnlyCategory) {
    let mlbdPlayable = [];
    let mlbdMeta = {};
    try {
      const mlbdCat = await getMlbdCatalog({ path: category, page });
      mlbdMeta = mlbdCat || {};
      if (Array.isArray(mlbdCat?.items)) {
        mlbdPlayable = mlbdCat.items.filter(x => x && !isNigerianContent(x) && x.hasResource !== false);
      }
    } catch (err) {
      console.warn(`[MLBD catalog error] ${category}:`, err?.message || err);
    }
    if (mlbdPlayable.length < 6) {
      try {
        let mbItems = [];
        if (!/^(?:\/collection\/|\/category\/)/i.test(category)) {
          const mbFallback = await handleMovieBoxRoute("catalog", query).catch(() => null);
          if (mbFallback?.ok && Array.isArray(mbFallback.items)) mbItems = mbFallback.items;
        }
        if (mbItems.length < 6) {
          const kw = catKeywordFallback(category);
          const mbSearch = await handleMovieBoxRoute("search", new URLSearchParams({ q: kw, page: String(page) })).catch(() => null);
          if (Array.isArray(mbSearch?.items)) mbItems = [...mbItems, ...mbSearch.items];
        }
        mlbdPlayable.push(...mbItems.filter(item => item && !isNigerianContent(item) && !isMusicOrClipSubject(item) && item.hasResource !== false));
      } catch {}
    }
    const sorted = sortCatalogNewestFirst(dedupeCatalogItems([...recentInjected, ...mlbdPlayable])).map(compactCatalogCard);
    if (sorted.length > 0) {
      return { ...mlbdMeta, ok: true, items: sorted, page, maxPage: Math.max(page, Number(mlbdMeta?.maxPage || 1)) };
    }
    return { ok: true, items: [], maxPage: 1, page };
  }

  const [mbRes, mlbdRes] = await Promise.allSettled([
    handleMovieBoxRoute("catalog", query),
    getMlbdCatalog({ path: category, page })
  ]);
  const mbPayload = mbRes.status === "fulfilled" && mbRes.value?.ok ? mbRes.value : { ok: true, items: [] };
  const mbRaw = (Array.isArray(mbPayload?.items) ? mbPayload.items : []).filter(x => x && !isNigerianContent(x) && x.hasResource !== false);
  const mlbdRaw = (mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [])
    .filter(x => x && !isNigerianContent(x) && x.hasResource !== false);

  const merged = dedupeCatalogItems([...recentInjected, ...mlbdRaw, ...mbRaw]);
  const ordered = (norm === "/top-rated" || norm === "/upcoming")
    ? merged
    : sortCatalogNewestFirst(merged);
  const compactItems = ordered.map(compactCatalogCard);
  const maxPage = Math.max(
    Number(mbPayload?.maxPage || mbPayload?.totalPages || 1),
    Number(mlbdRes.status === "fulfilled" ? (mlbdRes.value?.maxPage || mlbdRes.value?.totalPages || 1) : 1)
  );
  return {
    ...mbPayload,
    ok: true,
    items: compactItems,
    totalPages: maxPage,
    maxPage,
    hasMore: page < maxPage
  };
}

async function buildMergedHomePayload(query = new URLSearchParams()) {
  const hasCardPoster = x => Boolean(x?.poster || x?.previewImage);
  const [mbRes, mlbdRes, mlbdBanglaRes] = await Promise.allSettled([
    handleMovieBoxRoute("home", query),
    getMlbdHomeFeed(),
    getMlbdCatalog({ path: "/language/bangla", page: 1 })
  ]);
  const mlbdDirectOk = isMlbdDirectPlaybackAvailable();
  const isDirectlyStreamable = x => Boolean(x && x.hasResource !== false && (mlbdDirectOk || x.source !== "movielinkbd" || x.mbSubjectId));
  const hasPlayableStream = x => Boolean(x && x.hasResource !== false);
  const sortByPlayableThenRecency = (a, b) => {
    if (!mlbdDirectOk) {
      const da = isDirectlyStreamable(a) ? 1 : 0;
      const db = isDirectlyStreamable(b) ? 1 : 0;
      if (db !== da) return db - da;
    }
    const recA = parseHomeRecencyMs(a);
    const recB = parseHomeRecencyMs(b);
    if (recB !== recA) return recB - recA;
    const liveA = a?.fromArchive ? 0 : 1;
    const liveB = b?.fromArchive ? 0 : 1;
    if (liveB !== liveA) return liveB - liveA;
    const upA = parseExactUploadMs(a);
    const upB = parseExactUploadMs(b);
    if (Boolean(upB > 0) !== Boolean(upA > 0)) return upB > 0 ? 1 : -1;
    return upB - upA;
  };
  const rankHomeItems = list =>
    [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const score = x => (isDirectlyStreamable(x) ? 4 : 0) + (hasCardPoster(x) ? 2 : 0);
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return parseHomeRecencyMs(b) - parseHomeRecencyMs(a);
    });

  const rawMb = mbRes.status === "fulfilled"
    ? mbRes.value
    : { ok: true, sections: [], trending: [], banners: [], categories: [], curated: {} };
  const payload = {
    ok: true,
    mlbdDirectAvailable: mlbdDirectOk,
    categories: rawMb.categories || [],
    banners: [],
    trending: [],
    upcoming: Array.isArray(rawMb.upcoming) ? rawMb.upcoming.slice(0, 24).map(compactHomeCard) : [],
    sections: [],
    curated: rawMb.curated ? { ...rawMb.curated } : {},
    mlbdSections: [],
    mlbdTrending: [],
    mlbdCategories: [],
    mlbdBangla: [],
    recentlyUploaded: []
  };

  let mlbdFreshNewItems = [];
  if (mlbdRes.status === "fulfilled" && mlbdRes.value?.ok) {
    const mlbd = mlbdRes.value;
    const cleanMlbdSecs = (mlbd.sections || [])
      .filter(s => !isNigerianContent(null, s?.title))
      .map(s => {
        const validItems = (s.items || []).filter(x => !isNigerianContent(x, s?.title) && hasPlayableStream(x));
        const postered = validItems.filter(hasCardPoster);
        const curatedItems = (postered.length >= 4 ? rankHomeItems(postered) : rankHomeItems(validItems)).slice(0, 28).map(compactHomeCard);
        return { ...s, items: curatedItems };
      })
      .filter(s => s.items.length > 0);

    const newSec = cleanMlbdSecs.find(s => /latest\s*release|new|\b\/new\b/i.test(`${s.title || ""} ${s.categoryPath || ""}`));
    mlbdFreshNewItems = newSec ? newSec.items : (cleanMlbdSecs[0]?.items || []);
    payload.mlbdSections = cleanMlbdSecs;
    payload.mlbdTrending = rankHomeItems((mlbd.trending || []).filter(x => !isNigerianContent(x) && hasPlayableStream(x))).slice(0, 28).map(compactHomeCard);
    payload.mlbdCategories = mlbd.categories || [];
    const existingCats = new Set((payload.categories || []).map(c => c?.path));
    payload.categories = [
      ...(payload.categories || []),
      ...(mlbd.categories || []).filter(c => c?.path && !existingCats.has(c.path))
    ];
    payload.activeMlbdMirror = mlbd.activeMirror;
  }

  const mlbdBanglaSecItems = (payload.mlbdSections || [])
    .find(s => s?.id === "mlbd-bangla" || /^\/language\/bangla$/i.test(s?.categoryPath || ""))?.items || [];
  const mlbdBanglaFeedItems = mlbdBanglaRes.status === "fulfilled" && Array.isArray(mlbdBanglaRes.value?.items)
    ? mlbdBanglaRes.value.items
    : [];
  const mergedBanglaPool = dedupeCatalogItems([...mlbdBanglaFeedItems, ...mlbdBanglaSecItems])
    .filter(x => !isNigerianContent(x) && hasPlayableStream(x));
  if (mergedBanglaPool.length) {
    payload.mlbdBangla = rankHomeItems(mergedBanglaPool).slice(0, 28).map(compactHomeCard);
  }

  const mbSections = (rawMb.sections || [])
    .filter(s => !isNigerianContent(null, s?.title))
    .map(s => ({
      ...s,
      items: (s.items || []).filter(x => !isNigerianContent(x, s?.title)).slice(0, 28).map(compactHomeCard)
    }))
    .filter(s => s.items.length > 0);
  payload.sections = mbSections;

  if (Array.isArray(rawMb.trending)) {
    payload.trending = rawMb.trending.filter(x => !isNigerianContent(x) && !isMusicOrClipSubject(x)).slice(0, 30).map(compactHomeCard);
  }

  if (payload.curated) {
    for (const key of Object.keys(payload.curated)) {
      const arr = payload.curated[key];
      if (!Array.isArray(arr)) continue;
      payload.curated[key] = arr
        .filter(x => !isNigerianContent(x) && !isMusicOrClipSubject(x))
        .slice(0, 30)
        .map(compactHomeCard);
    }
    const existingIb = Array.isArray(payload.curated.indiaBangladeshTrending) ? payload.curated.indiaBangladeshTrending : [];
    const banglaPool = Array.isArray(payload.mlbdBangla) ? payload.mlbdBangla : [];
    const playablePosteredBangla = banglaPool.filter(x => isDirectlyStreamable(x) && hasCardPoster(x));
    const posteredBangla = banglaPool.filter(hasCardPoster);
    const seen = new Set();
    const prioritized = [
      ...playablePosteredBangla.slice(0, 8),
      ...existingIb.filter(x => hasCardPoster(x) && !isMusicOrClipSubject(x)),
      ...posteredBangla.slice(0, 10),
      ...existingIb.filter(x => !isMusicOrClipSubject(x))
    ];
    payload.curated.indiaBangladeshTrending = prioritized.filter(x => {
      if (!x || isNigerianContent(x) || isMusicOrClipSubject(x)) return false;
      const k = x.path || x.subjectId || x.title;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 28);
  }

  // Build unified Recently Uploaded pool (newest movies & dramas at the very top & front)
  const recentPoolRaw = [
    ...mlbdFreshNewItems,
    ...(payload.mlbdBangla || []).slice(0, 12),
    ...(payload.curated?.recentlyAdded || []),
    ...(payload.curated?.latestMovies || []),
    ...(payload.curated?.recentlyUpdated || []),
    ...(payload.mlbdTrending || []).slice(0, 12)
  ];
  payload.recentlyUploaded = dedupeCatalogItems(
    recentPoolRaw.filter(x => x && !isNigerianContent(x) && !isMusicOrClipSubject(x) && hasPlayableStream(x) && hasCardPoster(x))
  )
    .sort(sortByPlayableThenRecency)
    .slice(0, 30)
    .map(compactHomeCard);

  // Prioritize freshest recent uploads right at the front of Spotlight Banners
  const mbBanners = (rawMb.banners || []).filter(x => !isNigerianContent(x) && x?.hasResource !== false).map(compactHomeCard);
  const mlbdBanners = (mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.banners) ? mlbdRes.value.banners : [])
    .filter(x => !isNigerianContent(x) && hasPlayableStream(x) && hasCardPoster(x))
    .map(compactHomeCard);
  payload.banners = dedupeCatalogItems([...payload.recentlyUploaded.slice(0, 8), ...mbBanners, ...mlbdBanners])
    .sort(sortByPlayableThenRecency)
    .slice(0, 10);

  const jsonStr = JSON.stringify(payload);
  const gzipBuf = await gzipAsync(Buffer.from(jsonStr, "utf8"), { level: 4 }).catch(() => null);
  return { payload, jsonStr, gzipBuf, builtAt: Date.now() };
}

async function getMergedHomePayloadCached(query = new URLSearchParams()) {
  const qs = query.toString();
  if (qs) {
    return await buildMergedHomePayload(query);
  }
  const now = Date.now();
  const hasMlbdData = Array.isArray(mergedHomeCache?.payload?.mlbdSections) && mergedHomeCache.payload.mlbdSections.length > 0;
  const effectiveFreshMs = hasMlbdData ? HOME_FRESH_MS : 10000;
  if (mergedHomeCache && now - mergedHomeCache.builtAt < effectiveFreshMs) {
    return mergedHomeCache;
  }
  if (mergedHomeCache && now - mergedHomeCache.builtAt < HOME_STALE_MS) {
    if (!mergedHomeInFlight) {
      mergedHomeInFlight = buildMergedHomePayload(new URLSearchParams())
        .then(res => {
          mergedHomeCache = res;
          return res;
        })
        .catch(() => mergedHomeCache)
        .finally(() => {
          mergedHomeInFlight = null;
        });
    }
    return mergedHomeCache;
  }
  if (!mergedHomeInFlight) {
    mergedHomeInFlight = buildMergedHomePayload(new URLSearchParams())
      .then(res => {
        mergedHomeCache = res;
        return res;
      })
      .finally(() => {
        mergedHomeInFlight = null;
      });
  }
  return await mergedHomeInFlight;
}

// Serve static HTML/CSS/JS/assets from repository root
app.use(
  express.static(__dirname, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else if (/\.(?:js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
      }
    }
  })
);

const configureServer = srv => {
  srv.requestTimeout = 0;
  srv.headersTimeout = 60000;
  srv.keepAliveTimeout = 65000;
  return srv;
};

const warmCatalogRoute = cat => {
  const norm = cat.toLowerCase().replace(/\/+$/, "") || "/";
  return getSwrJsonCached(
    `api:catalog:${norm}:1`,
    {
      freshMs: 90000,
      staleMs: 600000,
      isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0)
    },
    () => buildUnifiedCatalogPayload(cat, 1, new URLSearchParams({ category: cat, page: "1" }))
  ).catch(() => {});
};

const warmStartupCaches = () => {
  setTimeout(() => {
    const homeWarmPromise = getMergedHomePayloadCached().catch(() => {});
    getSwrJsonCached(
      "api:categories",
      {
        freshMs: 180000,
        staleMs: 900000,
        isCacheable: d => Boolean(d?.ok && Array.isArray(d?.categories) && d.categories.length > 0)
      },
      async () => {
        const [mbRes, mlbdRes] = await Promise.allSettled([
          handleMovieBoxRoute("categories", new URLSearchParams()),
          getMlbdCategories()
        ]);
        const mbCats = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.categories) ? mbRes.value.categories : [];
        const mlbdCats = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.categories) ? mlbdRes.value.categories : [];
        const seen = new Set(mbCats.map(c => c.path));
        return {
          ok: true,
          categories: [...mbCats, ...mlbdCats.filter(c => c?.path && !seen.has(c.path))],
          servers: mlbdRes.status === "fulfilled" ? mlbdRes.value?.servers || [] : []
        };
      }
    ).catch(() => {});
    getSwrJsonCached("api:filter-options", { freshMs: 600000, staleMs: 1800000 }, () => handleMovieBoxRoute("filter-options", new URLSearchParams())).catch(() => {});
    getSwrJsonCached(
      "api:sports",
      { freshMs: 20000, staleMs: 90000, isCacheable: d => Boolean(d?.ok && Array.isArray(d?.channels) && d.channels.length > 0) },
      () => handleMovieBoxRoute("sports", new URLSearchParams())
    ).catch(() => {});

    homeWarmPromise.then(() => {
      ["/all", "/", "/type/movies", "/type/series"].forEach(warmCatalogRoute);
      setTimeout(() => {
        ["/language/hindi-dubbed", "/language/korean", "/southIndian", "/anime", "/language/bangla"].forEach(warmCatalogRoute);
      }, 900);
      setTimeout(() => {
        ["/drama", "/new"].forEach(warmCatalogRoute);
        getSwrJsonCached("api:hot-search:0", { freshMs: 120000, staleMs: 600000 }, () => handleMovieBoxRoute("hot-search", new URLSearchParams())).catch(() => {});
        getSwrJsonCached(
          "api:platform:netflix:1",
          { freshMs: 180000, staleMs: 600000, isCacheable: d => Boolean(d?.ok && Array.isArray(d?.items) && d.items.length > 0) },
          () => handleMovieBoxRoute("platform", new URLSearchParams({ name: "Netflix", page: "1" }))
        ).catch(() => {});
      }, 2000);
    });
  }, 150);
};

if (IS_PORT_NUMBER) {
  configureServer(
    app.listen(PORT, HOST, () => {
      console.log(`MovieStream BD server listening on http://${HOST}:${PORT}`);
      console.log("Primary upstream: MovieBox Direct API (https://h5-api.aoneroom.com)");
      warmStartupCaches();
    })
  );
} else {
  configureServer(
    app.listen(PORT, () => {
      console.log(`MovieStream BD server listening on socket/pipe ${PORT}`);
      console.log("Primary upstream: MovieBox Direct API (https://h5-api.aoneroom.com)");
      warmStartupCaches();
    })
  );
}
