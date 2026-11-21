const BASE = "https://hd-hcfs.onrender.com/api/trial/staff";
const json = (data, status = 200, cache = "no-store") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff"
  }
});
export async function onRequestGet({ request, env }) {
  if (!env.MOVIE_API_KEY) return json({ error: "Movie API key is not configured." }, 503);
  const incoming = new URL(request.url);
  const upstream = new URL(BASE);
  const allowed = ["staffId","page"];
  for (const key of allowed) {
    const value = (incoming.searchParams.get(key) || "").trim();
    if (!value) continue;
    if (value.length > 300 || /[\r\n]/.test(value)) return json({ error: "Invalid " + key + " parameter." }, 400);
    upstream.searchParams.set(key, value);
  }
  
  
  
  
  if (!upstream.searchParams.get("staffId")) return json({ error: "Missing staffId parameter." }, 400);
  const cacheControl = "public, max-age=300";
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  try { const cached = await caches.default.match(cacheKey); if (cached) return cached; } catch {}
  try {
    const response = await fetch(upstream.toString(), {
      headers: { "X-API-Key": env.MOVIE_API_KEY, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { return json({ error: "Movie API returned invalid JSON." }, 502); }
    if (!response.ok) return json({ error: "Movie API returned HTTP " + response.status, details: data?.message || data?.error || null }, 502);
    if (!data || data.ok !== true) return json({ error: "Invalid Movie API response." }, 502);
    delete data.trial;
    delete data.apiKey;
    const result = json(data, 200, cacheControl);
    try { await caches.default.put(cacheKey, result.clone()); } catch {}
    return result;
  } catch {
    return json({ error: "Movie API is temporarily unavailable." }, 502);
  }
}
