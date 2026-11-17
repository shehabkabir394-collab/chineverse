const TMDB_API = "https://api.themoviedb.org/3";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=86400" : "no-store"
    }
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const tmdbId = url.searchParams.get("tmdb_id") || "";
  const mediaType = url.searchParams.get("media_type") || "movie";
  if (!/^\d{1,12}$/.test(tmdbId) || !["movie", "tv"].includes(mediaType)) {
    return json({ error: "A valid TMDB ID and media type are required." }, 400);
  }
  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) return json({ error: "TMDB service is not configured in Cloudflare Pages." }, 503);

  try {
    const response = await fetch(`${TMDB_API}/${mediaType}/${tmdbId}/external_ids`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return json({ error: "External title IDs could not be loaded." }, 502);
    const body = await response.json();
    return json({ imdb_id: /^tt\d+$/i.test(body.imdb_id || "") ? body.imdb_id : null });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "TMDB took too long to respond." : "External title IDs could not be loaded.";
    return json({ error: message }, 502);
  }
}
