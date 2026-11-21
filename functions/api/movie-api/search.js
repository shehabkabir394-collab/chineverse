const API = "https://hd-hcfs.onrender.com/api/trial/search";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

export async function onRequestGet({ request, env }) {
  if (!(env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY)) return json({ error: "Movie API key is not configured." }, 503);
  const incoming = new URL(request.url);
  const cacheKey = new Request(incoming.toString(), { method: "GET" });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  } catch {}
  const q = (incoming.searchParams.get("q") || "").trim().slice(0, 150);
  const page = Math.max(1, Math.floor(Number(incoming.searchParams.get("page")) || 1));
  if (!q) return json({ error: "Search keyword is required." }, 400);
  const upstream = new URL(API);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("page", String(page));
  try {
    const response = await fetch(upstream, {
      headers: { "X-API-Key": (env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY), "Accept": "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.text();
    const headers = new Headers({
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=90",
      "X-Content-Type-Options": "nosniff"
    });
    const result = new Response(body, { status: response.status, headers });
    if (response.ok) {
      try { await caches.default.put(cacheKey, result.clone()); } catch {}
    }
    return result;
  } catch {
    return json({ error: "search is temporarily unavailable." }, 502);
  }
}
