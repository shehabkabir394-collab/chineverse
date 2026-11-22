const UPSTREAM = "https://okay-891h.onrender.com";
const ROUTES = {
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  const apiKey = env.CINEPULSE_API_KEY;
  if (!apiKey) return json({ ok: false, error: "CinePulse API key is not configured on the server." }, 503);

  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/");
  const legacy = parts.filter(Boolean).join("/");
  let route = ROUTES[legacy];
  const incoming = new URL(request.url);
  const query = new URLSearchParams(incoming.search);

  // Backward-compatible aliases used by the existing CineVerse UI.
  if (legacy === "shorts") {
    route = ROUTES.reels;
    if (!query.has("type")) query.set("type", "all");
  } else if (legacy === "sports") {
    route = ROUTES["sports/matches"];
  }
  if (!route) return json({ ok: false, error: "This CinePulse endpoint is not available in the current API pack.", endpoint: legacy }, 404);

  if (legacy === "catalog") {
    const category = query.get("category") || query.get("path");
    query.delete("path");
    if (category && !query.has("category")) query.set("category", category);
  }
  if (legacy === "platform" && query.has("name") && !query.has("platform")) {
    query.set("platform", query.get("name"));
    query.delete("name");
  }

  if (!query.has("source") && ["home", "catalog", "search", "ranking", "filter", "platform"].includes(legacy)) {
    query.set("source", "all");
  }
  if (!query.has("lang") && legacy === "home") query.set("lang", "en");

  const target = new URL("/api/v1/" + route, UPSTREAM);
  target.search = query.toString();

  try {
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: {
        accept: request.headers.get("accept") || "application/json",
        "x-api-key": apiKey
      },
      signal: AbortSignal.timeout(25000)
    });
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(body, { status: upstream.status, headers });
  } catch (error) {
    return json({ ok: false, error: "CinePulse API request failed.", detail: error?.name === "TimeoutError" ? "Upstream timeout" : "Upstream unavailable" }, 502);
  }
}
