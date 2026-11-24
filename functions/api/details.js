import { configureMediaSecret, handleMovieBoxRoute } from "../../moviebox-api.js";
import { getMlbdDetails } from "../../movielinkbd-api.js";

function json(data, status = 200, cacheControl = "public, max-age=120") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff"
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405, "no-store");
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  const url = new URL(request.url);
  const pathParam = String(url.searchParams.get("path") || "").trim();
  if (!pathParam) {
    return json({ ok: false, error: "Missing path parameter" }, 400, "no-store");
  }
  try {
    if (pathParam.startsWith("/mb/")) {
      const mbPayload = await handleMovieBoxRoute("details", new URLSearchParams({
        path: pathParam,
        title: String(url.searchParams.get("title") || "")
      }));
      return json(mbPayload, 200, "public, max-age=120");
    }
    const data = await getMlbdDetails(pathParam);
    return json(data, 200, "public, max-age=120");
  } catch (err) {
    return json({ ok: false, error: err?.message || "Title details unavailable" }, 502, "no-store");
  }
}
