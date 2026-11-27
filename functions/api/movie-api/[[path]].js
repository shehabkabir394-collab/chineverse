import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  configureMediaSecret,
  handleMovieBoxRoute,
  sortByReleaseNewest,
  verifyMediaToken
} from "../../../moviebox-api.js";
import {
  getActiveMlbdReferer,
  getMlbdCatalog,
  getMlbdCategories,
  getMlbdDetails,
  getMlbdHomeFeed,
  getMlbdStream,
  isMlbdDirectPlaybackAvailable,
  isMlbdPath,
  validateExternalHttpUrl
} from "../../../movielinkbd-api.js";
import { handleMockMovieApi } from "../../../mock-catalog.js";

const CINEPULSE_UPSTREAM = "https://okay-891h.onrender.com";
const CINEPULSE_ROUTES = {
  home: "home",
  reels: "reels",
  categories: "categories",
  catalog: "catalog",
  search: "search",
  suggest: "suggest",
  "updates-24h": "updates-24h",
  details: "details",
  stream: "stream",
  captions: "captions",
  related: "related",
  comments: "comments",
  staff: "staff",
  trending: "trending",
  ranking: "ranking",
  "hot-search": "hot-search",
  filter: "filter",
  "filter-options": "filter-options",
  platform: "platform",
  upcoming: "upcoming",
  "sports/matches": "sports/matches",
  "sports/leagues": "sports/leagues",
  "bottom-tabs": "bottom-tabs",
  "app-info": "app-info",
  status: "status"
};

function json(data, status = 200, cacheControl = "no-store") {
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

async function fetchMediaRange(targetUrl, method, reqHeaders) {
  const headers = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: reqHeaders.get("accept") || "*/*",
    Referer: MOVIEBOX_PLAYER_REFERER
  });
  const range = reqHeaders.get("range");
  if (range) headers.set("range", range);
  const ifRange = reqHeaders.get("if-range");
  if (ifRange) headers.set("if-range", ifRange);

  let upstream = await fetch(targetUrl, {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(45000)
  });
  if (upstream.status === 403) {
    try { await upstream.body?.cancel(); } catch {}
    for (const altRef of ["https://moviebox.ph/", MOVIEBOX_REFERER]) {
      const altHeaders = new Headers(headers);
      altHeaders.set("Referer", altRef);
      upstream = await fetch(targetUrl, {
        method,
        headers: altHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(45000)
      });
      if (upstream.ok || upstream.status === 206) break;
      try { await upstream.body?.cancel(); } catch {}
    }
  }
  return upstream;
}

async function handleDownloadFile(request, incoming) {
  try {
    const query = new URLSearchParams(incoming.search);
    const reqPath = String(query.get("path") || "");
    const mlbdMode = isMlbdPath(reqPath);
    const streamPayload = mlbdMode
      ? await getMlbdStream({ path: reqPath, se: query.get("se") || 0, ep: query.get("ep") || 1 })
      : await handleMovieBoxRoute("stream", query);
    const sources = Array.isArray(streamPayload?.sources) ? streamPayload.sources : [];
    const best = sources.find(s => s?.url && !/\.m3u8(?:$|[?#])/i.test(s.url)) || sources[0];
    if (!best?.url) {
      return json({ ok: false, error: "No downloadable MP4 source found" }, 404);
    }
    const parsed = new URL(best.url, incoming.origin);
    const token = parsed.searchParams.get("mb") || parsed.searchParams.get("t");
    const targetUrl = validateExternalHttpUrl(verifyMediaToken(token));
    if (!targetUrl) {
      return json({ ok: false, error: "Download token unavailable" }, 404);
    }
    const reqHeaders = new Headers({
      "User-Agent": MOVIEBOX_UA,
      Accept: request.headers.get("accept") || "*/*",
      Referer: mlbdMode ? getActiveMlbdReferer() : MOVIEBOX_PLAYER_REFERER
    });
    const range = request.headers.get("range");
    if (range) reqHeaders.set("range", range);
    const ifRange = request.headers.get("if-range");
    if (ifRange) reqHeaders.set("if-range", ifRange);
    const upstream = mlbdMode
      ? await fetch(targetUrl, { method: request.method, headers: reqHeaders, redirect: "follow", signal: AbortSignal.timeout(45000) })
      : await fetchMediaRange(targetUrl, request.method, request.headers);
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Media upstream unavailable", { status: upstream.status });
    }
    const responseHeaders = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!ct || ct.includes("octet-stream")) responseHeaders.set("content-type", "video/mp4");
    if (!upstream.headers.get("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");
    responseHeaders.set("content-disposition", "attachment; filename=MovieStreamBD-Video.mp4");
    responseHeaders.set("cache-control", "private, no-store");
    responseHeaders.set("x-content-type-options", "nosniff");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Download failed" }, 502);
  }
}

async function tryCinePulseFallback(legacy, query, apiKey, acceptHeader) {
  if (!apiKey) return null;
  let route = CINEPULSE_ROUTES[legacy];
  const cpQuery = new URLSearchParams(query);
  if (legacy === "shorts") {
    route = CINEPULSE_ROUTES.reels;
    if (!cpQuery.has("type")) cpQuery.set("type", "all");
  } else if (legacy === "sports") {
    route = CINEPULSE_ROUTES["sports/matches"];
  }
  if (!route) return null;
  if (legacy === "catalog") {
    const category = cpQuery.get("category") || cpQuery.get("path");
    cpQuery.delete("path");
    if (category && !cpQuery.has("category")) cpQuery.set("category", category);
  }
  if (legacy === "platform" && cpQuery.has("name") && !cpQuery.has("platform")) {
    cpQuery.set("platform", cpQuery.get("name"));
    cpQuery.delete("name");
  }
  if (!cpQuery.has("source") && ["home", "catalog", "search", "ranking", "filter", "platform"].includes(legacy)) {
    cpQuery.set("source", "all");
  }
  if (!cpQuery.has("lang") && legacy === "home") cpQuery.set("lang", "en");

  const target = new URL("/api/v1/" + route, CINEPULSE_UPSTREAM);
  target.search = cpQuery.toString();
  const res = await fetch(target.toString(), {
    headers: { accept: acceptHeader || "application/json", "x-api-key": apiKey },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/");
  const legacy = parts.filter(Boolean).join("/");
  const incoming = new URL(request.url);
  const query = new URLSearchParams(incoming.search);

  if (legacy === "download-file") {
    return await handleDownloadFile(request, incoming);
  }

  const reqPath = String(query.get("path") || "");

  try {
    if (legacy === "details" && isMlbdPath(reqPath)) {
      const payload = await getMlbdDetails(reqPath, String(query.get("title") || ""), {
        dubLock: query.get("dubLock") === "1"
      });
      return json(payload, 200, "public, max-age=120");
    }

    if (legacy === "stream" && isMlbdPath(reqPath)) {
      const payload = await getMlbdStream({
        path: reqPath,
        se: query.get("se") || 0,
        ep: query.get("ep") || 1,
        title: String(query.get("title") || ""),
        dubLock: query.get("dubLock") === "1"
      });
      return json(payload, 200, "no-store");
    }

    if (legacy === "home") {
      const [mbRes, mlbdRes, mlbdBanglaRes] = await Promise.allSettled([
        handleMovieBoxRoute("home", query),
        getMlbdHomeFeed(),
        getMlbdCatalog({ path: "/language/bangla", page: 1 })
      ]);
      const payload = mbRes.status === "fulfilled"
        ? mbRes.value
        : { ok: true, sections: [], trending: [], banners: [], categories: [], curated: {} };
      let mlbdFreshItems = [];
      let mlbdBanners = [];
      if (mlbdRes.status === "fulfilled" && mlbdRes.value?.ok) {
        const mlbd = mlbdRes.value;
        payload.mlbdSections = mlbd.sections || [];
        payload.mlbdTrending = mlbd.trending || [];
        payload.mlbdCategories = mlbd.categories || [];
        const existingCats = new Set((payload.categories || []).map(c => c?.path));
        payload.categories = [
          ...(payload.categories || []),
          ...(mlbd.categories || []).filter(c => c?.path && !existingCats.has(c.path))
        ];
        payload.sections = [...(mlbd.sections || []), ...(payload.sections || [])];
        payload.activeMlbdMirror = mlbd.activeMirror;
        const freshSec = (mlbd.sections || []).find(s => /latest\s*release|new|\b\/new\b/i.test(`${s?.title || ""} ${s?.categoryPath || ""}`));
        mlbdFreshItems = Array.isArray(freshSec?.items) ? freshSec.items : (mlbd.sections?.[0]?.items || []);
        mlbdBanners = Array.isArray(mlbd.banners) ? mlbd.banners : [];
      }
      if (mlbdBanglaRes.status === "fulfilled" && Array.isArray(mlbdBanglaRes.value?.items)) {
        payload.mlbdBangla = mlbdBanglaRes.value.items;
      }
      const mlbdDirectOk = isMlbdDirectPlaybackAvailable();
      payload.mlbdDirectAvailable = mlbdDirectOk;
      const isDirectPlayable = x => Boolean(x && x.hasResource !== false && (mlbdDirectOk || x.source !== "movielinkbd" || x.mbSubjectId));
      const recentSeen = new Set();
      const recentPoolRaw = [
        ...mlbdFreshItems,
        ...(payload.mlbdBangla || []).slice(0, 12),
        ...(payload.curated?.recentlyAdded || []),
        ...(payload.curated?.latestMovies || []),
        ...(payload.curated?.recentlyUpdated || []),
        ...(payload.mlbdTrending || []).slice(0, 12)
      ].filter(x => {
        if (!x || x.hasResource === false) return false;
        const k = x.path || x.subjectId || x.title;
        if (!k || recentSeen.has(k)) return false;
        recentSeen.add(k);
        return true;
      });
      payload.recentlyUploaded = (mlbdDirectOk
        ? recentPoolRaw
        : [...recentPoolRaw].sort((a, b) => (isDirectPlayable(b) ? 1 : 0) - (isDirectPlayable(a) ? 1 : 0))
      ).slice(0, 30);
      const bannerSeen = new Set();
      const bannerPoolRaw = [...payload.recentlyUploaded.slice(0, 8), ...(payload.banners || []), ...mlbdBanners]
        .filter(x => {
          if (!x || x.hasResource === false) return false;
          const k = x.path || x.subjectId || x.title;
          if (!k || bannerSeen.has(k)) return false;
          bannerSeen.add(k);
          return true;
        });
      payload.banners = (mlbdDirectOk
        ? bannerPoolRaw
        : [...bannerPoolRaw].sort((a, b) => (isDirectPlayable(b) ? 1 : 0) - (isDirectPlayable(a) ? 1 : 0))
      ).slice(0, 10);
      if (payload.curated && Array.isArray(payload.mlbdBangla) && payload.mlbdBangla.length) {
        const existingIb = Array.isArray(payload.curated.indiaBangladeshTrending) ? payload.curated.indiaBangladeshTrending : [];
        const ibSeen = new Set();
        payload.curated.indiaBangladeshTrending = [...payload.mlbdBangla.slice(0, 10), ...existingIb]
          .filter(x => {
            const k = x?.path || x?.subjectId || x?.title;
            if (!k || ibSeen.has(k)) return false;
            ibSeen.add(k);
            return true;
          })
          .slice(0, 28);
      }
      return json(payload, 200, "public, max-age=60");
    }

    if (legacy === "categories") {
      const [mbRes, mlbdRes] = await Promise.allSettled([
        handleMovieBoxRoute("categories", query),
        getMlbdCategories()
      ]);
      const mbCats = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.categories) ? mbRes.value.categories : [];
      const mlbdCats = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.categories) ? mlbdRes.value.categories : [];
      const seen = new Set(mbCats.map(c => c.path));
      const mergedCats = [...mbCats, ...mlbdCats.filter(c => c?.path && !seen.has(c.path))];
      return json({
        ok: true,
        categories: mergedCats,
        servers: mlbdRes.status === "fulfilled" ? mlbdRes.value?.servers || [] : []
      }, 200, "public, max-age=120");
    }

    if (legacy === "search") {
      const q = String(query.get("q") || "").trim();
      const page = Math.max(1, Number(query.get("page")) || 1);
      const [mbRes, mlbdRes] = await Promise.allSettled([
        handleMovieBoxRoute("search", query),
        q ? getMlbdCatalog({ path: "/search", q, page }) : Promise.resolve({ items: [] })
      ]);
      const mbItems = mbRes.status === "fulfilled" && Array.isArray(mbRes.value?.items) ? mbRes.value.items : [];
      const mlbdItems = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [];
      const merged = [];
      const seen = new Set();
      const maxLen = Math.max(mlbdItems.length, mbItems.length);
      for (let i = 0; i < maxLen; i++) {
        for (const candidate of [mlbdItems[i], mbItems[i]]) {
          if (!candidate) continue;
          const key = candidate.path || candidate.title;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(candidate);
        }
      }
      return json({
        ok: true,
        items: merged,
        totalCount: merged.length,
        hasMore: Boolean(mbRes.value?.hasMore || mlbdRes.value?.hasMore)
      }, 200, "public, max-age=60");
    }

    if (legacy === "catalog") {
      const catPath = String(query.get("category") || query.get("path") || "/");
      const page = Math.max(1, Number(query.get("page")) || 1);
      const isMlbdOnlyCategory = /^\/(?:language\/(?:dual-audio|gujrati|kannada|marathi|malaysian|vietnamese|german|italian|portuguese|others)|genre\/(?:biographical|historical|musical|sports|superhero|survival|suspense)|category\/|collection\/|collections)/i.test(catPath);
      if (isMlbdOnlyCategory) {
        try {
          const mlbdCat = await getMlbdCatalog({ path: catPath, page });
          if (Array.isArray(mlbdCat?.items) && mlbdCat.items.length > 0) {
            return json({ ...mlbdCat, items: sortByReleaseNewest(mlbdCat.items) }, 200, "public, max-age=60");
          }
        } catch {}
        try {
          const mbFallback = await handleMovieBoxRoute("catalog", query);
          if (mbFallback?.ok && Array.isArray(mbFallback.items)) {
            return json({ ...mbFallback, items: sortByReleaseNewest(mbFallback.items) }, 200, "public, max-age=60");
          }
        } catch {}
        return json({ ok: true, items: [], maxPage: 1, page }, 200, "no-store");
      }
      const [mbRes, mlbdRes] = await Promise.allSettled([
        handleMovieBoxRoute("catalog", query),
        getMlbdCatalog({ path: catPath, page })
      ]);
      const mbPayload = mbRes.status === "fulfilled" && mbRes.value?.ok ? mbRes.value : { ok: true, items: [] };
      const mbItems = Array.isArray(mbPayload?.items) ? mbPayload.items : [];
      const mlbdItems = mlbdRes.status === "fulfilled" && Array.isArray(mlbdRes.value?.items) ? mlbdRes.value.items : [];
      const ordered = [...mlbdItems, ...mbItems];
      const merged = [];
      const seen = new Set();
      for (const item of ordered) {
        const key = item?.path || String(item?.title || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      return json({
        ...mbPayload,
        ok: true,
        items: sortByReleaseNewest(merged),
        maxPage: Math.max(
          Number(mbPayload?.maxPage || 1),
          Number(mlbdRes.status === "fulfilled" ? mlbdRes.value?.maxPage || 1 : 1)
        )
      }, 200, "public, max-age=60");
    }

    const payload = await handleMovieBoxRoute(legacy, query);
    if (payload && payload.ok === false && /^Unknown MovieBox API endpoint/i.test(payload.error || "")) {
      return json(payload, 404);
    }
    const statusCode = payload?.ok === false ? 502 : 200;
    const cacheControl = legacy === "stream" ? "no-store" : "public, max-age=60";
    return json(payload, statusCode, cacheControl);
  } catch (error) {
    try {
      const cpPayload = await tryCinePulseFallback(legacy, query, env?.CINEPULSE_API_KEY, request.headers.get("accept"));
      if (cpPayload) {
        return json(cpPayload, 200, "no-store");
      }
    } catch {}

    const fallback = handleMockMovieApi(legacy, query, incoming.origin);
    return json(fallback, 200, "no-store");
  }
}
