const PLAY4U_API = "https://play4u.org/api/search.php";
const PLAY4U_ORIGIN = "https://play4u.org";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, s-maxage=300"
  }
});

function safeText(value, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function httpsUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, PLAY4U_ORIGIN);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function titlePage(value) {
  const href = httpsUrl(value);
  if (!href) return null;
  const url = new URL(href);
  return url.origin === PLAY4U_ORIGIN ? url.href : null;
}

function itemFromApi(item) {
  if (!item || typeof item !== "object" || !safeText(item.title, 180)) return null;
  return {
    id: item.id ?? null,
    media_id: item.media_id ?? null,
    title: safeText(item.title, 180),
    imdb_id: safeText(item.imdb_id ?? item.imdb, 30) || null,
    tmdb_id: Number.isFinite(Number(item.tmdb_id)) ? Number(item.tmdb_id) : null,
    year: safeText(item.year, 8) || null,
    runtime: safeText(item.runtime, 30) || null,
    overview: safeText(item.overview, 3000),
    poster_url: httpsUrl(item.poster_url ?? item.poster),
    media_type: safeText(item.media_type, 30) || null,
    watch: titlePage(item.watch),
    has_imax: item.has_imax === true,
    quality: safeText(item.quality, 40) || null,
    age_rating: safeText(item.age_rating, 30) || null,
    languages: Array.isArray(item.languages) ? item.languages.map(x => safeText(x, 40)).filter(Boolean).slice(0, 30) : [],
    qualities: Array.isArray(item.qualities) ? item.qualities.map(x => safeText(x, 30)).filter(Boolean).slice(0, 20) : [],
    stream_count: Number.isFinite(Number(item.stream_count)) ? Number(item.stream_count) : 0,
    release_date: safeText(item.release_date, 20) || null
  };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = safeText(url.searchParams.get("q"), 120);
  const requestedCount = Number(url.searchParams.get("per_page") || 24);
  const perPage = Number.isFinite(requestedCount) ? Math.min(50, Math.max(1, Math.trunc(requestedCount))) : 24;
  if (!query) return json({ error: "A Play4U search query is required." }, 400);

  const upstreamUrl = new URL(PLAY4U_API);
  upstreamUrl.searchParams.set("q", query);
  upstreamUrl.searchParams.set("per_page", String(perPage));

  try {
    const response = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return json({ error: "Play4U search failed (HTTP " + response.status + ")." }, 502);
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.items)) return json({ error: "Play4U returned an unexpected search response." }, 502);
    return json({
      ok: true,
      engine: safeText(data.engine, 80),
      found: Number(data.found) || 0,
      page: Number(data.page) || 1,
      per_page: Number(data.per_page) || perPage,
      pages: Number(data.pages) || 1,
      items: data.items.map(itemFromApi).filter(Boolean)
    });
  } catch (error) {
    return json({ error: error?.name === "TimeoutError" ? "Play4U search timed out." : "Could not reach Play4U search." }, 502);
  }
}
