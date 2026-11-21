const BASE = "https://hd-hcfs.onrender.com/api/trial/me";
const json = (data, status = 200, cache = "no-store") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  }
});
export async function onRequestGet({ request, env }) {
  if (!(env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY || env.MOVIE_API_KOY)) return json({ error: "Movie API key is not configured." }, 503);
  const incoming = new URL(request.url);
  const upstream = new URL(BASE);
  const allowed = [];
  for (const key of allowed) {
    const value = (incoming.searchParams.get(key) || "").trim();
    if (!value) continue;
    if (value.length > 300 || /[\r\n]/.test(value)) return json({ error: "Invalid " + key + " parameter." }, 400);
    upstream.searchParams.set(key, value);
  }
  
  
  
  
  
  const cacheControl = "no-store";
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  
  try {
    const response = await fetch(upstream.toString(), {
      headers: { "X-API-Key": (env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY || env.MOVIE_API_KOY || env.MOVIE_API_KOY), "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { return json({ error: "Movie API returned invalid JSON." }, 502); }
    if (!response.ok) return json({ error: "Movie API returned HTTP " + response.status, details: data?.message || data?.error || null }, 502);
    if (!data || data.ok !== true) return json({ error: "Invalid Movie API response." }, 502);
    delete data.apiKey;
    const result = json(data, 200, cacheControl);
    
    return result;
  } catch {
    return json({ error: "Movie API is temporarily unavailable." }, 502);
  }
}
