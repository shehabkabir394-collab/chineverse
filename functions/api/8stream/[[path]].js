const API_BASE = "https://8-stream-api.vercel.app/api/v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function getByImdbId(endpoint, id) {
  if (!/^tt\d+$/i.test(id)) return json({ success: false, message: "A valid IMDb ID is required." }, 400);
  try {
    const response = await fetch(`${API_BASE}/${endpoint}?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) {
      return json({ success: false, message: "8Stream information is unavailable." }, 502);
    }
    return json(body);
  } catch (_) {
    return json({ success: false, message: "8Stream information is unavailable." }, 502);
  }
}

export async function onRequest({ request, params }) {
  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const url = new URL(request.url);

  if (request.method === "GET" && path === "media-info") {
    return getByImdbId("mediaInfo", url.searchParams.get("id") || "");
  }
  if (request.method === "GET" && path === "season-list") {
    return getByImdbId("getSeasonList", url.searchParams.get("id") || "");
  }
  if (request.method === "POST" && path === "get-stream") {
    let input;
    try {
      input = await request.json();
    } catch (_) {
      return json({ success: false, message: "A valid JSON body is required." }, 400);
    }
    if (typeof input.file !== "string" || !input.file || input.file.length > 12000 ||
        typeof input.key !== "string" || !input.key || input.key.length > 4096) {
      return json({ success: false, message: "Valid stream parameters are required." }, 400);
    }
    try {
      const response = await fetch(`${API_BASE}/getStream`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ file: input.file, key: input.key }),
        signal: AbortSignal.timeout(12000)
      });
      const body = await response.json();
      if (!response.ok || body.success !== true || typeof body.data?.link !== "string" || !/^https:\/\//i.test(body.data.link)) {
        return json({ success: false, message: "8Stream could not resolve the selected stream." }, 502);
      }
      return json({ success: true, data: { link: body.data.link } });
    } catch (_) {
      return json({ success: false, message: "8Stream could not resolve the selected stream." }, 502);
    }
  }
  return json({ success: false, message: "Unknown 8Stream route." }, 404);
}
