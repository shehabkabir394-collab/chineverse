import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  handleMovieBoxRoute,
  signMediaToken,
  verifyMediaToken
} from "./moviebox-api.js";
import { buildPosterSvg, handleMockMovieApi } from "./mock-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const RAW_PORT = process.env.PORT;
const IS_PORT_NUMBER = !RAW_PORT || /^\d+$/.test(String(RAW_PORT).trim());
const PORT = IS_PORT_NUMBER ? Number(RAW_PORT || 3000) : String(RAW_PORT).trim();
const HOST = "0.0.0.0";
const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";
const recentStreamEvents = [];

function recordStreamEvent(evt) {
  recentStreamEvents.unshift({ ts: new Date().toISOString(), ...evt });
  if (recentStreamEvents.length > 30) recentStreamEvents.length = 30;
}

app.set("trust proxy", true);

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

// Image proxy for MovieBox posters, avatars & sports logos (bypasses ISP/hotlink blocks)
app.get("/api/moviebox-image/:file", async (req, res) => {
  const targetUrl = verifyMediaToken(req.query.t);
  if (!targetUrl) {
    return res.status(400).send("Invalid or missing image token");
  }
  const referer = /aisports/i.test(targetUrl) ? "https://aisports.mobi/" : MOVIEBOX_REFERER;
  try {
    const upstream = await fetchMediaWithRetry(
      targetUrl,
      "GET",
      {
        "User-Agent": MOVIEBOX_UA,
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      null,
      1
    );
    if (!upstream.ok) {
      return res.status(upstream.status).send("Image unavailable");
    }
    const ct = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
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
    if (upstream.status === 403 && extraHeaders.Referer === MOVIEBOX_PLAYER_REFERER) {
      try {
        await upstream.body?.cancel();
      } catch {}
      for (const altRef of ["https://moviebox.ph/", MOVIEBOX_REFERER]) {
        const altHeaders = new Headers(headers);
        altHeaders.set("Referer", altRef);
        upstream = await fetchMediaWithRetry(targetUrl, req.method, altHeaders, abortController.signal, 1);
        if (upstream.ok || upstream.status === 206) break;
        try {
          await upstream.body?.cancel();
        } catch {}
      }
    }
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
  const startedAt = Date.now();

  try {
    const payload = await handleMovieBoxRoute(legacy, query);
    if (payload && payload.ok === false && /^Unknown MovieBox API endpoint/i.test(payload.error || "")) {
      return res.status(404).json(payload);
    }
    if (legacy === "status" && payload && typeof payload === "object") {
      payload.recentStreamEvents = recentStreamEvents.slice(0, 15);
    }
    const statusCode = payload?.ok === false ? 502 : 200;
    if (legacy === "stream") {
      const sourceCount = Array.isArray(payload?.sources)
        ? payload.sources.length
        : Array.isArray(payload?.stream?.sources)
          ? payload.stream.sources.length
          : 0;
      const evt = {
        title: query.get("title") || "",
        subjectId: query.get("subjectId") || "",
        se: query.get("se") || "0",
        ep: query.get("ep") || "0",
        status: statusCode,
        sourceCount,
        message: payload?.message || payload?.error || "",
        durationMs: Date.now() - startedAt
      };
      recordStreamEvent(evt);
      if (sourceCount === 0 || statusCode >= 400) {
        console.warn("[MovieBox stream empty/error]", JSON.stringify(evt));
      }
    }
    res.setHeader("Cache-Control", legacy === "stream" ? "no-store" : "public, max-age=60");
    return res.status(statusCode).json(payload);
  } catch (error) {
    console.warn(`[MovieBox API fallback] ${legacy}:`, error?.message || error);
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

// Serve static HTML/CSS/JS/assets from repository root
app.use(
  express.static(__dirname, {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      if (/\.(?:html|js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
      }
    }
  })
);

if (IS_PORT_NUMBER) {
  app.listen(PORT, HOST, () => {
    console.log(`MovieStream BD server listening on http://${HOST}:${PORT}`);
    console.log("Primary upstream: MovieBox Direct API (https://h5-api.aoneroom.com)");
  });
} else {
  app.listen(PORT, () => {
    console.log(`MovieStream BD server listening on socket/pipe ${PORT}`);
    console.log("Primary upstream: MovieBox Direct API (https://h5-api.aoneroom.com)");
  });
}
