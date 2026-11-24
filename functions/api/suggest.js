import { handleMovieBoxRoute, configureMediaSecret } from "../../moviebox-api.js";
import { getMlbdSuggest } from "../../movielinkbd-api.js";

function json(data, status = 200, cacheControl = "public, max-age=60") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin"
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405, "no-store");
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim();
  if (!q) {
    return json({ ok: true, query: "", items: [], suggestions: [] });
  }

  const [mlbdRes, mbRes] = await Promise.allSettled([
    getMlbdSuggest(q),
    handleMovieBoxRoute("search", new URLSearchParams({ q, page: "1" }))
  ]);

  const mlbdItems = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [];
  const mbItems = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.items) ? mbRes.value.items : [];
  const seen = new Set();
  const merged = [];
  for (const item of [...mlbdItems, ...mbItems]) {
    const key = item?.path || item?.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= 16) break;
  }

  return json({
    ok: true,
    query: q,
    items: merged,
    suggestions: merged.map(it => it.title)
  });
}
