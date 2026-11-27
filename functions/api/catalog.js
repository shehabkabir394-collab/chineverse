import { configureMediaSecret, sortByReleaseNewest } from "../../moviebox-api.js";
import { getMlbdCatalog } from "../../movielinkbd-api.js";

function json(data, status = 200, cacheControl = "public, max-age=90") {
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
    const url = new URL(request.url);
    const pathParam = String(url.searchParams.get("path") || url.searchParams.get("category") || "/");
    const q = String(url.searchParams.get("q") || "");
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const data = await getMlbdCatalog({ path: pathParam, q, page });
    const normPath = pathParam.toLowerCase().replace(/\/page\/\d+\/?$/i, "").replace(/\/+$/, "") || "/";
    const preserveOrder = normPath === "/mostwatch/7d" || normPath === "/mostwatch" || normPath === "/popular" || normPath === "/top10" || normPath === "/top-rated";
    if (!q && !preserveOrder && Array.isArray(data?.items)) {
      data.items = sortByReleaseNewest(data.items);
    }
    return json(data, 200, "public, max-age=90");
  } catch (err) {
    return json({ ok: false, error: err?.message || "Catalog unavailable" }, 502, "no-store");
  }
}
