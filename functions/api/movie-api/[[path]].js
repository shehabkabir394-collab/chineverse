import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  configureMediaSecret,
  handleMovieBoxRoute,
  verifyMediaToken
} from "../../../moviebox-api.js";
import { handleMockMovieApi } from "../../../mock-catalog.js";

const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";
const CINEPULSE_ROUTES = {
  home: "home",
  reels: "reels",
  categories: "categories",
  catalog: "catalog",
  search: "search",
  suggest: "suggest",
  "updates-24h": "updates-24h",
  details: "details",
  stream: "stream",
  captions: "captions",
  related: "related",
  comments: "comments",
  staff: "staff",
  trending: "trending",
  ranking: "ranking",
  "hot-search": "hot-search",
  filter: "filter",
  "filter-options": "filter-options",
  platform: "platform",
  upcoming: "upcoming",
  "sports/matches": "sports/matches",
  "sports/leagues": "sports/leagues",
  "bottom-tabs": "bottom-tabs",
  "app-info": "app-info",
  status: "status"
};

function json(data, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin"
    }
  });
}

async function fetchMediaRange(targetUrl, method, reqHeaders) {
  const headers = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: reqHeaders.get("accept") || "*/*",
    Referer: MOVIEBOX_PLAYER_REFERER
  });
  const range = reqHeaders.get("range");
  if (range) headers.set("range", range);
  const ifRange = reqHeaders.get("if-range");
  if (ifRange) headers.set("if-range", ifRange);

  let upstream = await fetch(targetUrl, {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(45000)
  });
  if (upstream.status === 403) {
    try { await upstream.body?.cancel(); } catch {}
    for (const altRef of ["https://moviebox.ph/", MOVIEBOX_REFERER]) {
      const altHeaders = new Headers(headers);
      altHeaders.set("Referer", altRef);
      upstream = await fetch(targetUrl, {
        method,
        headers: altHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(45000)
      });
      if (upstream.ok || upstream.status === 206) break;
      try { await upstream.body?.cancel(); } catch {}
    }
  }
  return upstream;
}

async function handleDownloadFile(request, incoming) {
  try {
    const query = new URLSearchParams(incoming.search);
    const streamPayload = await handleMovieBoxRoute("stream", query);
    const sources = Array.isArray(streamPayload?.sources) ? streamPayload.sources : [];
    const best = sources[0];
    if (!best?.url) {
      return json({ ok: false, error: "No downloadable MP4 source found" }, 404);
    }
    const parsed = new URL(best.url, incoming.origin);
    const targetUrl = verifyMediaToken(parsed.searchParams.get("mb"));
    if (!targetUrl) {
      return json({ ok: false, error: "Download token unavailable" }, 404);
    }
    const upstream = await fetchMediaRange(targetUrl, request.method, request.headers);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Media upstream unavailable", { status: upstream.status });
    }
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!ct || ct.includes("octet-stream")) responseHeaders.set("content-type", "video/mp4");
    if (!upstream.headers.get("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");
    responseHeaders.set("content-disposition", "attachment; filename=MovieStreamBD-Video.mp4");
    responseHeaders.set("cache-control", "private, no-store");
    responseHeaders.set("x-content-type-options", "nosniff");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Download failed" }, 502);
  }
}

async function tryCinePulseFallback(legacy, query, apiKey, acceptHeader) {
  if (!apiKey) return null;
  let route = CINEPULSE_ROUTES[legacy];
  const cpQuery = new URLSearchParams(query);
  if (legacy === "shorts") {
    route = CINEPULSE_ROUTES.reels;
    if (!cpQuery.has("type")) cpQuery.set("type", "all");
  } else if (legacy === "sports") {
    route = CINEPULSE_ROUTES["sports/matches"];
  }
  if (!route) return null;
  if (legacy === "catalog") {
    const category = cpQuery.get("category") || cpQuery.get("path");
    cpQuery.delete("path");
    if (category && !cpQuery.has("category")) cpQuery.set("category", category);
  }
  if (legacy === "platform" && cpQuery.has("name") && !cpQuery.has("platform")) {
    cpQuery.set("platform", cpQuery.get("name"));
    cpQuery.delete("name");
  }
  if (!cpQuery.has("source") && ["home", "catalog", "search", "ranking", "filter", "platform"].includes(legacy)) {
    cpQuery.set("source", "all");
  }
  if (!cpQuery.has("lang") && legacy === "home") cpQuery.set("lang", "en");

  const target = new URL("/api/v1/" + route, CINEPULSE_UPSTREAM);
  target.search = cpQuery.toString();
  const res = await fetch(target.toString(), {
    headers: { accept: acceptHeader || "application/json", "x-api-key": apiKey },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/");
  const legacy = parts.filter(Boolean).join("/");
  const incoming = new URL(request.url);
  const query = new URLSearchParams(incoming.search);

  if (legacy === "download-file") {
    return await handleDownloadFile(request, incoming);
  }

  try {
    const payload = await handleMovieBoxRoute(legacy, query);
    if (payload && payload.ok === false && /^Unknown MovieBox API endpoint/i.test(payload.error || "")) {
      return json(payload, 404);
    }
    const statusCode = payload?.ok === false ? 502 : 200;
    const cacheControl = legacy === "stream" ? "no-store" : "public, max-age=60";
    return json(payload, statusCode, cacheControl);
  } catch (error) {
    try {
      const cpPayload = await tryCinePulseFallback(legacy, query, env?.CINEPULSE_API_KEY, request.headers.get("accept"));
      if (cpPayload) {
        return json(cpPayload, 200, "no-store");
      }
    } catch {}

    const fallback = handleMockMovieApi(legacy, query, incoming.origin);
    return json(fallback, 200, "no-store");
  }
}
