const API_PATH = "/api/play4u/search";
const PLAY4U_ORIGIN = "https://play4u.org";
const resultsById = new Map();

function text(value, limit = 500) {
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
  const url = httpsUrl(value);
  if (!url) return null;
  return new URL(url).origin === PLAY4U_ORIGIN ? url : null;
}

function normalize(item) {
  if (!item || typeof item !== "object" || !text(item.title, 180)) return null;
  const id = String(item.id ?? item.media_id ?? "");
  const movie = {
    id,
    mediaId: String(item.media_id ?? ""),
    title: text(item.title, 180),
    year: text(item.year, 8) || null,
    mediaType: text(item.media_type, 30) || null,
    imdbId: text(item.imdb_id ?? item.imdb, 30) || null,
    tmdbId: Number.isFinite(Number(item.tmdb_id)) ? Number(item.tmdb_id) : null,
    overview: text(item.overview, 3000),
    posterUrl: httpsUrl(item.poster_url ?? item.poster),
    watchUrl: titlePage(item.watch),
    qualities: Array.isArray(item.qualities) ? item.qualities.map(x => text(x, 30)).filter(Boolean) : [],
    languages: Array.isArray(item.languages) ? item.languages.map(x => text(x, 40)).filter(Boolean) : [],
    streamCount: Number.isFinite(Number(item.stream_count)) ? Number(item.stream_count) : 0,
    provider: "Play4U"
  };
  if (movie.id) resultsById.set(movie.id, movie);
  if (movie.mediaId) resultsById.set(movie.mediaId, movie);
  if (movie.imdbId) resultsById.set(movie.imdbId, movie);
  if (movie.tmdbId) resultsById.set(String(movie.tmdbId), movie);
  return movie;
}

async function search(query, { perPage = 24, signal } = {}) {
  const q = text(query, 120);
  if (!q) throw new TypeError("Play4U search needs a title or ID.");
  const count = Math.max(1, Math.min(50, Number(perPage) || 24));
  const url = new URL(API_PATH, globalThis.location?.origin || "https://chineverse.pages.dev");
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", String(count));
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  let data;
  try { data = await response.json(); } catch { throw new Error("Play4U returned invalid JSON."); }
  if (!response.ok) throw new Error(data?.error || "Play4U search failed (HTTP " + response.status + ").");
  if (!data || !Array.isArray(data.items)) throw new Error("Play4U response did not include search results.");
  return {
    provider: "Play4U",
    query: q,
    found: Number(data.found) || 0,
    page: Number(data.page) || 1,
    pages: Number(data.pages) || 1,
    items: data.items.map(normalize).filter(Boolean)
  };
}

export const Play4U = Object.freeze({
  name: "Play4U",
  baseUrl: PLAY4U_ORIGIN,
  // The captured API supports search, not a browse-all catalog.
  getMovies(query, options) { return search(query, options); },
  search,
  // The captured API has no details endpoint; this only resolves a previously searched item.
  async getDetails(id) {
    const key = String(id ?? "").trim();
    if (!key) return null;
    if (resultsById.has(key)) return resultsById.get(key);
    const result = await search(key, { perPage: 24 });
    return result.items.find(item => [item.id, item.mediaId, item.imdbId, String(item.tmdbId ?? "")].includes(key)) || null;
  }
});

if (typeof globalThis !== "undefined") globalThis.Play4UProvider = Play4U;
export default Play4U;
