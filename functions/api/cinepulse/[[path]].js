const UPSTREAM = "https://okay-891h.onrender.com/api/v1/";
const ALLOWED = new Set([
  "home", "reels", "categories", "catalog", "search", "suggest", "updates-24h",
  "details", "stream", "captions", "related", "comments", "staff", "trending",
  "ranking", "hot-search", "filter", "filter-options", "platform", "upcoming",
  "sports/matches", "sports/leagues", "bottom-tabs", "app-info", "status"
]);
const NO_CACHE = new Set(["stream", "captions"]);
const SHORT_CACHE = new Set(["home", "reels", "categories", "trending", "ranking", "hot-search", "updates-24h", "bottom-tabs", "app-info", "status"]);

function safeMediaUrl(value, origin) {
  try {
    const u = new URL(String(value || ""));
    if (u.hostname !== "okay-891h.onrender.com" || !["/api/mb-stream.mp4", "/api/mb-ep-stream.mp4"].includes(u.pathname)) return value;
    const q = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (k.toLowerCase() !== "api_key") q.append(k, v);
    q.set("route", u.pathname.split("/").pop());
    return origin + "/api/cinepulse-media?" + q.toString();
  } catch { return value; }
}
function sanitizeMedia(value, origin) {
  if (Array.isArray(value)) return value.map(x => sanitizeMedia(x, origin));
  if (!value || typeof value !== "object") return value;
  const out = { ...value };
  if (out.proxyUrl) {
    const safe = safeMediaUrl(out.proxyUrl, origin);
    out.proxyUrl = safe;
    if (safe !== out.proxyUrl || String(safe).includes("/api/cinepulse-media?")) {
      out.url = safe; out.downloadUrl = safe;
    }
  }
  if (out.url) {
    const safe = safeMediaUrl(out.url, origin);
    if (safe !== out.url) { out.url = safe; out.downloadUrl = safe; }
  }
  for (const [k, v] of Object.entries(out)) if (v && typeof v === "object") out[k] = sanitizeMedia(v, origin);
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "Method not allowed." }, 405);
  const key = env.CINEPULSE_API_KEY;
  if (!key) return json({ ok: false, error: "CinePulse API is not configured. Add CINEPULSE_API_KEY as a Cloudflare Pages secret." }, 503);
  const rawPath = Array.isArray(params?.path) ? params.path.join("/") : String(params?.path || "");
  const endpoint = rawPath.replace(/^\/+|\/+$/g, "");
  if (!ALLOWED.has(endpoint)) return json({ ok: false, error: "CinePulse endpoint is not allowed." }, 404);
  const incoming = new URL(request.url);
  const upstream = new URL(endpoint, UPSTREAM);
  for (const [name, value] of incoming.searchParams) {
    if (!["apikey", "api_key", "key", "token"].includes(name.toLowerCase())) upstream.searchParams.append(name, value);
  }
  try {
    const response = await fetch(upstream.toString(), {
      method: request.method,
      headers: { "accept": "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(14000),
      redirect: "follow"
    });
    if (endpoint === "stream" || endpoint === "details") {
      const payload = await response.json();
      return json(sanitizeMedia(payload, new URL(request.url).origin), response.status);
    }
    const headers = new Headers();
    headers.set("content-type", response.headers.get("content-type") || "application/json; charset=utf-8");
    headers.set("x-content-type-options", "nosniff");
    headers.set("cache-control", NO_CACHE.has(endpoint) ? "no-store" : (SHORT_CACHE.has(endpoint) ? "public, max-age=0, s-maxage=20" : "public, max-age=0, s-maxage=10"));
    headers.set("vary", "Accept-Encoding");
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError";
    return json({ ok: false, error: timeout ? "CinePulse upstream timed out." : "CinePulse upstream is temporarily unavailable." }, 502);
  }
}
