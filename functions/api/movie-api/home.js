const API = "https://hd-w0l1.onrender.com/api/trial/home";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }
  });

export async function onRequestGet({ request, env }) {
  if (!env.MOVIE_API_KEY) {
    return json({ error: "Movie API key is not configured." }, 503);
  }

  const cacheKey = new Request(new URL(request.url).toString(), {
    method: "GET"
  });

  // Serve cached API data when available.
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return cached;
    }
  } catch {
    // Continue with the origin request if cache lookup fails.
  }

  try {
    const response = await fetch(API, {
      headers: {
        "X-API-Key": env.MOVIE_API_KEY,
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

    // Store successful responses at this Cloudflare data center for 5 minutes.
    try {
      await caches.default.put(cacheKey, result.clone());
    } catch {
      // API still works even if cache storage fails.
    }

    return result;
  } catch {
    return json({ error: "Movie API is temporarily unavailable." }, 502);
  }
}
