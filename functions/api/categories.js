import { configureMediaSecret } from "../../moviebox-api.js";
import { getMlbdCategories } from "../../movielinkbd-api.js";

function json(data, status = 200, cacheControl = "public, max-age=180") {
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
  try {
    const data = await getMlbdCategories();
    return json(data, 200, "public, max-age=180");
  } catch (err) {
    return json({ ok: false, error: err?.message || "Categories unavailable" }, 502, "no-store");
  }
}
