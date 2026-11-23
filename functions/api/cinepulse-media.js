import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  configureMediaSecret,
  verifyMediaToken
} from "../../moviebox-api.js";

const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";
const MAX_STREAM_CHUNK = 16 * 1024 * 1024;

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

async function fetchMediaWithRetry(targetUrl, method, headers, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const upstream = await fetch(targetUrl, {
        method,
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(45000)
      });
      if ((upstream.status >= 500 || upstream.status === 429) && attempt < retries) {
        try { await upstream.body?.cancel(); } catch {}
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      return upstream;
    } catch (err) {
      lastError = err;
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Media upstream unavailable");
}

async function proxyMediaStream(request, targetUrl, extraHeaders = {}, forceDownload = false) {
  const headers = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: request.headers.get("accept") || "*/*",
    ...extraHeaders
  });
  const clientRange = request.headers.get("range");
  if (request.method === "GET" && !forceDownload) {
    headers.set("range", buildBoundedRangeHeader(clientRange));
  } else if (clientRange) {
    headers.set("range", clientRange);
  }
  const ifRange = request.headers.get("if-range");
  if (ifRange) headers.set("if-range", ifRange);

  let upstream = await fetchMediaWithRetry(targetUrl, request.method, headers, 2);
  if (upstream.status === 403 && extraHeaders.Referer === MOVIEBOX_PLAYER_REFERER) {
    try { await upstream.body?.cancel(); } catch {}
    for (const altRef of ["https://moviebox.ph/", MOVIEBOX_REFERER]) {
      const altHeaders = new Headers(headers);
      altHeaders.set("Referer", altRef);
      upstream = await fetchMediaWithRetry(targetUrl, request.method, altHeaders, 1);
      if (upstream.ok || upstream.status === 206) break;
      try { await upstream.body?.cancel(); } catch {}
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    const errHeaders = new Headers({ "content-type": "text/plain; charset=utf-8" });
    const errContentRange = upstream.headers.get("content-range");
    if (errContentRange) errHeaders.set("content-range", errContentRange);
    return new Response("Media upstream unavailable", { status: upstream.status, headers: errHeaders });
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  if (!ct || ct.includes("octet-stream")) {
    responseHeaders.set("content-type", "video/mp4");
  }
  if (!upstream.headers.get("accept-ranges")) {
    responseHeaders.set("accept-ranges", "bytes");
  }
  if (forceDownload) {
    responseHeaders.set("content-disposition", "attachment; filename=MovieStreamBD-Video.mp4");
    responseHeaders.set("cache-control", "private, no-store");
  } else {
    responseHeaders.set("vary", "Range");
    responseHeaders.set("cache-control", "private, max-age=300, no-transform");
  }
  responseHeaders.set("x-content-type-options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const incoming = new URL(request.url);
  const forceDownload = incoming.searchParams.get("download") === "1";
  const mbToken = incoming.searchParams.get("mb") || "";

  if (mbToken) {
    const targetUrl = verifyMediaToken(mbToken);
    if (!targetUrl) {
      return new Response("Invalid or expired media token", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    try {
      return await proxyMediaStream(request, targetUrl, { Referer: MOVIEBOX_PLAYER_REFERER }, forceDownload);
    } catch (error) {
      return new Response(
        error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable",
        { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }
  }

  const apiKey = env?.CINEPULSE_API_KEY;
  const token = incoming.searchParams.get("t") || "";
  if (!apiKey || !/^cp1[A-Za-z0-9._~-]{8,2048}$/.test(token)) {
    return new Response("Invalid or missing media token", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  try {
    return await proxyMediaStream(
      request,
      `${CINEPULSE_UPSTREAM}/api/mb-stream.mp4?t=${encodeURIComponent(token)}`,
      { "x-api-key": apiKey },
      forceDownload
    );
  } catch (error) {
    return new Response(
      error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }
}
