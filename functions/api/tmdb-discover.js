const TMDB_API = "https://api.themoviedb.org/3";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=900, s-maxage=900"
  }
});

function languageName(code) {
  const names = {
    bn: "Bangla", zh: "Chinese", en: "English", fr: "French", de: "German",
    hi: "Hindi", id: "Indonesian", ja: "Japanese", ko: "Korean",
    ml: "Malayalam", mr: "Marathi", pt: "Portuguese", ru: "Russian",
    es: "Spanish", ta: "Tamil", te: "Telugu"
  };
  return names[code] || String(code || "").toUpperCase();
}

function imageUrl(path, size) {
  return typeof path === "string" && /^\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)
    ? "https://image.tmdb.org/t/p/" + size + path
    : null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const allowed = new Set(["popular", "now_playing", "upcoming", "top_rated"]);
  const category = url.searchParams.get("category") || "popular";
  if (!allowed.has(category)) return json({ error: "Unsupported movie category." }, 400);

  const token = env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) {
    return json({
      error: "TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."
    }, 503);
  }

  try {
    const response = await fetch(
      TMDB_API + "/movie/" + category + "?include_adult=false&language=en-US&page=1",
      {
        headers: { Authorization: "Bearer " + token, accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok) return json({ error: "TMDB could not load the movie list (HTTP " + response.status + ")." }, 502);

    const body = await response.json();
    const movies = (body.results || [])
      .filter(movie => movie && movie.adult !== true && movie.title)
      .map(movie => {
        const yearMatch = String(movie.release_date || "").match(/^(\d{4})/);
        return {
          id: "tmdb-" + movie.id,
          tmdb_id: Number(movie.id),
          source: "tmdb",
          title: String(movie.title).slice(0, 180),
          media_type: "movie",
          release_year: yearMatch ? Number(yearMatch[1]) : null,
          genre: "",
          language: languageName(movie.original_language),
          quality: "HD",
          rating: Number.isFinite(Number(movie.vote_average))
            ? Math.round(Number(movie.vote_average) * 10) / 10
            : null,
          description: String(movie.overview || "").slice(0, 3000),
          poster_url: imageUrl(movie.poster_path, "w500"),
          backdrop_url: imageUrl(movie.backdrop_path, "w1280"),
          created_at: movie.release_date || "",
          tmdb_url: "https://www.themoviedb.org/movie/" + Number(movie.id)
        };
      });

    return json({ category, count: movies.length, movies });
  } catch (error) {
    const message = error?.name === "TimeoutError"
      ? "TMDB took too long to respond. Please try again."
      : "Could not load the TMDB movie list.";
    return json({ error: message }, 502);
  }
}
