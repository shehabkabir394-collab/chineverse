const API = "https://hd-hcfs.onrender.com/api/trial/catalog";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      "X-Content-Type-Options": "nosniff"
    }
  });

export async function onRequestGet({ request, env }) {
  if (!(env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY || env.MOVIE_API_KOY)) return json({ error: "Movie API key is not configured." }, 503);
  const incoming = new URL(request.url);
const path = (incoming.searchParams.get("path") || "").trim().slice(0, 300);
  const page = Math.max(1, Math.floor(Number(incoming.searchParams.get("page")) || 1));
  if (!path) return json({ error: "Catalog category path is required." }, 400);
  if (/adult18plus|adult[-_/]?18/i.test(path)) return json({ error: "This category is not available on CineVerse." }, 403);
  if (/adult18plus|adult[-_/]?18/i.test(path)) return json({ error: "This category is not available on CineVerse." }, 403);
  const upstream = new URL(API);
  upstream.searchParams.set("path", path);
  upstream.searchParams.set("page", String(page));
  try {
    const response = await fetch(upstream, {
      headers: { "X-API-Key": (env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY || env.MOVIE_API_KOY), "Accept": "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.text();
    const headers = new Headers({
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      "X-Content-Type-Options": "nosniff"
    });
    const result = new Response(body, { status: response.status, headers });
return result;
  } catch {
    return json({ error: "catalog is temporarily unavailable." }, 502);
  }
}
