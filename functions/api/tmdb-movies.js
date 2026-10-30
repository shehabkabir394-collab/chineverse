const SUPABASE_URL = "https://bqvlkprluentrsovfpcy.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_7Kna5pXHrSnKiO_s8Wr3bA_T5AAj4me";
const TMDB_API = "https://api.themoviedb.org/3";
const MAX_PAGES = 5;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function requireAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new Error("Sign in as an approved administrator to import movies.");
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(8000)
  });
  if (!userResponse.ok) throw new Error("Your admin session expired. Sign in again.");
  const user = await userResponse.json();
  if (!user?.id) throw new Error("Sign in as an approved administrator to import movies.");
  const membershipResponse = await fetch(SUPABASE_URL + "/rest/v1/admin_users?user_id=eq." + encodeURIComponent(user.id) + "&select=user_id&limit=1", {
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(8000)
  });
  if (!membershipResponse.ok) throw new Error("Could not verify admin permission.");
  const admins = await membershipResponse.json();
  if (!Array.isArray(admins) || admins.length !== 1) throw new Error("Only approved administrators can import movie metadata.");
}

function languageName(code) {
  const names = {
    bn: "Bangla", zh: "Chinese", en: "English", fr: "French", de: "German", gu: "Gujarati",
    hi: "Hindi", id: "Indonesian", it: "Italian", ja: "Japanese", kn: "Kannada", ko: "Korean",
    ml: "Malayalam", mr: "Marathi", pt: "Portuguese", pa: "Punjabi", ru: "Russian", es: "Spanish",
    ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish", vi: "Vietnamese"
  };
  return names[code] || String(code || "").toUpperCase();
}

function imageUrl(path, size) {
  return typeof path === "string" && /^\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)
    ? "https://image.tmdb.org/t/p/" + size + path
    : null;
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const category = body?.category;
    const pages = Number(body?.pages);
    const allowed = new Set(["popular", "now_playing", "upcoming", "top_rated"]);
    if (!allowed.has(category)) return json({ error: "Choose a supported TMDB movie list." }, 400);
    if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) return json({ error: "Choose between 1 and 5 pages." }, 400);
    const token = env.TMDB_API_READ_ACCESS_TOKEN;
    if (!token) return json({ error: "TMDB service is not configured in Cloudflare Pages." }, 503);

    const headers = { Authorization: "Bearer " + token, accept: "application/json" };
    const pageRequests = Array.from({ length: pages }, (_, index) =>
      fetch(TMDB_API + "/movie/" + category + "?include_adult=false&language=en-US&page=" + (index + 1), {
        headers,
        signal: AbortSignal.timeout(10000)
      })
    );
    const [pageResponses, genreResponse] = await Promise.all([
      Promise.all(pageRequests),
      fetch(TMDB_API + "/genre/movie/list?language=en-US", { headers, signal: AbortSignal.timeout(10000) })
    ]);
    const failedPage = pageResponses.find(response => !response.ok);
    if (failedPage) return json({ error: "TMDB movie list could not be loaded (HTTP " + failedPage.status + ")." }, 502);
    if (!genreResponse.ok) return json({ error: "TMDB genres could not be loaded." }, 502);
    const [pageBodies, genreBody] = await Promise.all([Promise.all(pageResponses.map(response => response.json())), genreResponse.json()]);
    const genres = new Map((genreBody.genres || []).map(genre => [genre.id, genre.name]));
    const movies = pageBodies.flatMap(page => page.results || []).filter(movie => movie && movie.adult !== true && movie.title).map(movie => {
      const match = String(movie.release_date || "").match(/^(\d{4})/);
      const releaseYear = match ? Number(match[1]) : null;
      const releaseDate = movie.release_date ? new Date(movie.release_date + "T00:00:00Z") : null;
      const isUpcoming = releaseDate && !Number.isNaN(releaseDate.valueOf()) && releaseDate > new Date();
      return {
        tmdb_id: Number(movie.id),
        title: String(movie.title).slice(0, 180),
        media_type: "movie",
        release_year: Number.isInteger(releaseYear) && releaseYear >= 1888 && releaseYear <= 2100 ? releaseYear : null,
        genre: Array.isArray(movie.genre_ids) ? movie.genre_ids.map(id => genres.get(id)).filter(Boolean).join(", ") : "",
        language: languageName(movie.original_language),
        quality: "Other",
        rating: Number.isFinite(Number(movie.vote_average)) ? Math.round(Number(movie.vote_average) * 10) / 10 : null,
        description: String(movie.overview || "").slice(0, 5000),
        poster_url: imageUrl(movie.poster_path, "w500"),
        backdrop_url: imageUrl(movie.backdrop_path, "w1280"),
        trailer_url: null,
        watch_url: null,
        video_url: null,
        download_url: null,
        cast_members: "",
        runtime_minutes: null,
        content_status: isUpcoming ? "Upcoming" : "Released",
        seasons: null,
        episodes: null,
        tags: "",
        published: false
      };
    });
    return json({ category, pages, count: movies.length, movies });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "TMDB or Supabase took too long to respond. Try again." : (error?.message || "Could not load TMDB movie metadata.");
    return json({ error: message }, 400);
  }
}
