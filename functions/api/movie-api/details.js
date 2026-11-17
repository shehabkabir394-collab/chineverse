const BASE = "https://hd-w0l1.onrender.com/api/trial/details";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

export async function onRequestGet({ request, env }) {
  if (!env.MOVIE_API_KEY) {
    return json({ error: "Movie API key is not configured." }, 503);
  }

  const path = new URL(request.url).searchParams.get("path") || "";

  // Accept only Movie API catalogue paths, never arbitrary URLs.
  if (!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path) ||
      path.split("/").some(part => part === "." || part === "..")) {
    return json({ error: "Invalid Movie API content path." }, 400);
  }

  const upstream = new URL(BASE);
  upstream.searchParams.set("path", path);

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        "X-API-Key": env.MOVIE_API_KEY,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return json({ error: "Movie details returned HTTP " + response.status }, 502);
    }

    const data = await response.json();

    if (!data || data.ok !== true) {
      return json({ error: "Invalid Movie API details response." }, 502);
    }

    delete data.trial;
    return json(data);
  } catch {
    return json({ error: "Could not load movie details." }, 502);
  }
}
