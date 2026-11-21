const API = "https://hd-hcfs.onrender.com/api/trial/home";

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
  if (!(env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY)) {
    return json({ error: "Movie API key is not configured." }, 503);
  }

try {
    const response = await fetch(API, {
      headers: {
        "X-API-Key": (env.MOVIEBOX_API_KEY || env.MOVIE_API_KEY),
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return json({ error: "Movie API returned HTTP " + response.status }, 502);
    }

    const data = await response.json();

    if (!data || data.ok !== true) {
      return json({ error: "Invalid Movie API response." }, 502);
    }

    // Never expose trial credentials or usage metadata.
    delete data.trial;

    const result = json(data);
return result;
  } catch {
    return json({ error: "Movie API is temporarily unavailable." }, 502);
  }
}
