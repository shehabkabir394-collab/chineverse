import { configureMediaSecret } from "../../moviebox-api.js";
import { getMlbdServerHealth } from "../../movielinkbd-api.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  try {
    const data = await getMlbdServerHealth();
    return json(data, 200);
  } catch (err) {
    return json({ ok: false, error: err?.message || "Server health check failed" }, 502);
  }
}
