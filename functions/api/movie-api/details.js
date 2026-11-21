const BASE = "https://hd-hcfs.onrender.com/api/trial/details";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
export async function onRequestGet({ request, env }) {
  if (!env.MOVIE_API_KEY) return json({ error: "Movie API key is not configured." }, 503);
  const incoming = new URL(request.url);
  const path = (incoming.searchParams.get("path") || "").trim();
  const title = (incoming.searchParams.get("title") || "").trim();
  if (!path && !title) return json({ error: "Provide title or path." }, 400);
  if (path && (!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path) || path.split("/").some(part => part === "." || part === ".."))) {
    return json({ error: "Invalid Movie API content path." }, 400);
  }
  if (title && (title.length > 180 || /[\r\n]/.test(title))) return json({ error: "Invalid title." }, 400);
  const upstream = new URL(BASE);
  if (title) upstream.searchParams.set("title", title);
  else upstream.searchParams.set("path", path);
  try {
    const response = await fetch(upstream.toString(), {
      headers: { "X-API-Key": env.MOVIE_API_KEY, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    let data; try { data = JSON.parse(body); } catch { return json({ error: "Movie details returned invalid JSON." }, 502); }
    if (!response.ok) return json({ error: "Movie details returned HTTP " + response.status, details: data?.message || data?.error || null }, 502);
    if (!data || data.ok !== true) return json({ error: "Invalid Movie API details response." }, 502);
    delete data.trial; delete data.apiKey;
    return json(data);
  } catch { return json({ error: "Could not load movie details." }, 502); }
}
