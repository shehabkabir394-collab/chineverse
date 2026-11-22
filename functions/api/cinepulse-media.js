const UPSTREAM = "https://okay-891h.onrender.com";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const apiKey = env.CINEPULSE_API_KEY;
  if (!apiKey) return new Response("Media proxy is not configured", { status: 503 });
  const incoming = new URL(request.url);
  const token = incoming.searchParams.get("t") || "";
  if (!/^cp1[A-Za-z0-9._~-]{8,2048}$/.test(token)) {
    return new Response("Invalid or missing media token", { status: 400 });
  }

  const headers = new Headers({
    accept: request.headers.get("accept") || "*/*",
    "x-api-key": apiKey
  });
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  const ifRange = request.headers.get("if-range");
  if (ifRange) headers.set("if-range", ifRange);

  try {
    const upstream = await fetch(UPSTREAM + "/api/mb-stream.mp4?t=" + encodeURIComponent(token), {
      method: request.method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(120000)
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (incoming.searchParams.get("download") === "1") {
      responseHeaders.set("content-disposition", "attachment; filename=CineVerse-Download.mp4");
    }
    responseHeaders.set("cache-control", "private, no-store");
    responseHeaders.set("x-content-type-options", "nosniff");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error?.name === "TimeoutError" ? "Media upstream timed out" : "Media upstream unavailable"
    }), { status: 502, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
