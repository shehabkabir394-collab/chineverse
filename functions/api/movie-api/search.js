const API = "https://hd-w0l1.onrender.com/api/trial/search";

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
  if (!env.MOVIE_API_KEY) {
    return json({ error: "Movie API key is not configured." }, 503);
  }

  const incoming = new URL(request.url);
  const q = (incoming.searchParams.get("q") || "").trim().slice(0, 150);
  const page = Math.max(1, Math.floor(Number(incoming.searchParams.get("page")) || 1));

  if (!q) return json({ error: "Search keyword is required." }, 400);

  const upstream = new URL(API);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("page", String(page));

  try {
    const response = await fetch(upstream, {
      headers: {
        "X-API-Key": env.MOVIE_API_KEY,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(20000)
    });

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return json({ error: "Movie Search API is temporarily unavailable." }, 502);
  }
}
