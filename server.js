import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_UA,
  handleMovieBoxRoute,
  signMediaToken,
  verifyMediaToken
} from "./moviebox-api.js";
import { buildPosterSvg, handleMockMovieApi } from "./mock-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";

app.set("trust proxy", true);

function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("host") || `localhost:${PORT}`;
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
    p.startsWith("/node_modules/") ||
    p.startsWith("/.git") ||
    p.startsWith("/.env") ||
    p === "/server.js" ||
    p === "/moviebox-api.js" ||
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

// Subtitle proxy for MovieBox .srt captions (avoids browser CORS issues)
app.get("/api/moviebox-subtitle/:file", async (req, res) => {
  const targetUrl = verifyMediaToken(req.query.t);
  if (!targetUrl) {
    return res.status(400).send("Invalid or missing subtitle token");
  }
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: MOVIEBOX_PLAYER_REFERER
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Subtitle unavailable");
    }
    const text = await upstream.text();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(text);
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
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: "https://aisports.mobi/",
        Accept: "*/*"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Live sports stream unavailable");
    }
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const isPlaylist =
      ct.includes("mpegurl") ||
      /\.m3u8(?:$|[?#])/i.test(targetUrl) ||
      req.params.file.endsWith(".m3u8");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (isPlaylist) {
      const raw = await upstream.text();
      if (!raw.trim().startsWith("#EXTM3U")) {
        res.setHeader("Content-Type", ct || "application/octet-stream");
        return res.send(raw);
      }
      const rewritten = raw
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
              try {
                const abs = new URL(uri, targetUrl).href;
                const ext = /\.m3u8(?:$|[?#])/i.test(abs) ? "sub.m3u8" : "key.bin";
                return `URI="/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}"`;
              } catch {
                return `URI="${uri}"`;
              }
            });
          }
          try {
            const abs = new URL(trimmed, targetUrl).href;
            const ext = /\.m3u8(?:$|[?#])/i.test(abs) ? "sub.m3u8" : "seg.ts";
            return `/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}`;
          } catch {
            return line;
          }
        })
        .join("\n");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.send(rewritten);
    }

    res.setHeader("Content-Type", ct || "video/mp2t");
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

const MAX_STREAM_CHUNK = 16 * 1024 * 1024; // 16 MiB keeps full MP4 moov atoms intact while staying under Cloud Run's 32 MiB response cap

function buildBoundedRangeHeader(rawRange) {
  if (!rawRange) {
    return `bytes=0-${MAX_STREAM_CHUNK - 1}`;
  }
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(rawRange).trim());
  if (!match) return rawRange;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (!Number.isFinite(start) || start < 0) return rawRange;
  if (requestedEnd == null || !Number.isFinite(requestedEnd)) {
    return `bytes=${start}-${start + MAX_STREAM_CHUNK - 1}`;
  }
  if (requestedEnd - start + 1 > MAX_STREAM_CHUNK) {
    return `bytes=${start}-${start + MAX_STREAM_CHUNK - 1}`;
  }
  return `bytes=${start}-${requestedEnd}`;
}

async function fetchMediaWithRetry(targetUrl, method, headers, clientAbortSignal, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (clientAbortSignal?.aborted) {
      throw new DOMException("Client aborted request", "AbortError");
    }
    const timeoutSignal = AbortSignal.timeout(45000);
    const signal = clientAbortSignal
      ? AbortSignal.any([clientAbortSignal, timeoutSignal])
      : timeoutSignal;
    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers,
        redirect: "follow",
        signal
      });
      if ((upstream.status >= 500 || upstream.status === 429) && attempt < retries) {
        try {
          await upstream.body?.cancel();
        } catch {}
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      return upstream;
    } catch (err) {
      lastError = err;
      if (clientAbortSignal?.aborted || attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Media upstream unavailable");
}

// Direct MP4 media proxy with Range support & MovieBox Referer header
async function proxyMediaStream(req, res, targetUrl, extraHeaders = {}, forceDownload = false) {
  const headers = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: req.get("accept") || "*/*",
    ...extraHeaders
  });
  const clientRange = req.get("range");
  if (req.method === "GET" && !forceDownload) {
    headers.set("range", buildBoundedRangeHeader(clientRange));
  } else if (clientRange) {
    headers.set("range", clientRange);
  }
  if (req.get("if-range")) headers.set("if-range", req.get("if-range"));

  const abortController = new AbortController();
  const onReqClose = () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
  };
  req.on("close", onReqClose);

  let upstream;
  try {
    upstream = await fetchMediaWithRetry(targetUrl, req.method, headers, abortController.signal, 2);
  } catch (err) {
    req.off("close", onReqClose);
    if (abortController.signal.aborted) {
      if (!res.headersSent) res.status(499).end();
      return;
    }
    throw err;
  }

  if (!upstream.ok && upstream.status !== 206) {
    req.off("close", onReqClose);
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
  if (!ct || ct.includes("octet-stream")) {
    res.setHeader("content-type", "video/mp4");
  }
  if (!upstream.headers.get("accept-ranges")) {
    res.setHeader("accept-ranges", "bytes");
  }
  if (forceDownload) {
    res.setHeader("content-disposition", "attachment; filename=MovieStreamBD-Video.mp4");
    res.setHeader("cache-control", "private, no-store");
  } else {
    res.setHeader("vary", "Range");
    res.setHeader("cache-control", "private, max-age=300, no-transform");
  }
  res.setHeader("x-content-type-options", "nosniff");
  res.status(upstream.status);

  if (req.method === "HEAD" || !upstream.body) {
    req.off("close", onReqClose);
    return res.end();
  }
  const nodeStream = Readable.fromWeb(upstream.body);
  res.on("close", () => {
    req.off("close", onReqClose);
    if (!res.writableFinished) {
      abortController.abort();
      try {
        nodeStream.destroy();
      } catch {}
    }
  });
  res.on("finish", () => {
    req.off("close", onReqClose);
  });
  nodeStream.on("error", () => {
    req.off("close", onReqClose);
    if (!res.headersSent) res.status(502).end();
    else res.end();
  });
  nodeStream.pipe(res);
}

app.all("/api/cinepulse-media", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).set("Allow", "GET, HEAD").send("Method not allowed");
  }

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
        req.query.download === "1"
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
      req.query.download === "1"
    );
  } catch (error) {
    console.error("[cinepulse-media fallback error]", error?.name, error?.message);
    return res.status(502).type("text/plain").send(
      error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable"
    );
  }
});

// Download helper for season ZIP & one-click episode fetch
app.get("/api/movie-api/download-file", async (req, res) => {
  try {
    const incomingUrl = new URL(req.originalUrl, getBaseUrl(req));
    const query = new URLSearchParams(incomingUrl.search);
    const streamPayload = await handleMovieBoxRoute("stream", query);
    const sources = Array.isArray(streamPayload?.sources) ? streamPayload.sources : [];
    const best = sources[0];
    if (!best?.url) {
      return res.status(404).json({ ok: false, error: "No downloadable MP4 source found" });
    }
    const parsed = new URL(best.url, getBaseUrl(req));
    const targetUrl = verifyMediaToken(parsed.searchParams.get("mb"));
    if (!targetUrl) {
      return res.status(404).json({ ok: false, error: "Download token unavailable" });
    }
    return await proxyMediaStream(req, res, targetUrl, { Referer: MOVIEBOX_PLAYER_REFERER }, true);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || "Download failed" });
  }
});

// Main MovieBox Upstream API Proxy
app.all("/api/movie-api/*", async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const legacy = String(req.params[0] || "").replace(/^\/+|\/+$/g, "");
  const incomingUrl = new URL(req.originalUrl, getBaseUrl(req));
  const query = new URLSearchParams(incomingUrl.search);

  try {
    const payload = await handleMovieBoxRoute(legacy, query);
    if (payload && payload.ok === false && /^Unknown MovieBox API endpoint/i.test(payload.error || "")) {
      return res.status(404).json(payload);
    }
    res.setHeader("Cache-Control", legacy === "stream" ? "no-store" : "public, max-age=60");
    return res.status(payload?.ok === false ? 502 : 200).json(payload);
  } catch (error) {
    console.warn(`[MovieBox API fallback] ${legacy}:`, error?.message || error);
    const fallback = handleMockMovieApi(legacy, query, getBaseUrl(req));
    res.setHeader("Cache-Control", "no-store");
    return res.json(fallback);
  }
});

// Serve static HTML/CSS/JS/assets from repository root
app.use(express.static(__dirname, { extensions: ["html"] }));

app.listen(PORT, HOST, () => {
  console.log(`MovieStream BD server listening on http://${HOST}:${PORT}`);
  console.log("Primary upstream: MovieBox Direct API (https://h5-api.aoneroom.com)");
});
