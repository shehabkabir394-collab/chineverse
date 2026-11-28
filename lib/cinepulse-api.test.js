import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CINEPULSE_UPSTREAM,
  buildCinePulseUpstreamUrl,
  loadDotEnvIfPresent,
  normalizeCinePulseDetail,
  normalizeCinePulseItem,
  normalizeCinePulsePayload,
  normalizeCinePulseRoute,
  rewriteCinePulseMediaUrl
} from "./cinepulse-api.js";
import {
  MLBD_HEALTH_CHECKS,
  buildMlbdComItem,
  classifyMirrorFailure,
  evaluateMlbdHealthHtml,
  extractCardsFromHtml,
  getMirrorHealthSnapshot,
  isCloudflareBlockedResponse,
  isMirrorInCooldown,
  isMlbdLatestPath,
  isMlbdTrendingPath,
  mapCategoryToMlbdComUrls,
  matchesMlbdCategoryItem,
  mergeAndDedupeMlbdItems,
  mlbdFetchPage,
  orderMlbdTrendingItems,
  resetMirrorStates,
  resolveMlbdUpstreamCatalogPath
} from "../movielinkbd-api.js";
import {
  applyDirectSourceMetadata,
  isDirectMediaResponseSafe,
  isDirectPublicImageCdn,
  isKnownProtectedMediaHost
} from "./media-delivery.js";

test("normalizeCinePulseRoute validates allowed allstreamingbd routes", () => {
  assert.equal(normalizeCinePulseRoute("home"), "home");
  assert.equal(normalizeCinePulseRoute("/v1/catalog/"), "catalog");
  assert.equal(normalizeCinePulseRoute("sports/matches"), "sports/matches");
  assert.equal(normalizeCinePulseRoute("updates-24h"), "updates-24h");
  assert.equal(normalizeCinePulseRoute("unknown-secret"), "");
});

test("buildCinePulseUpstreamUrl defaults source=all on discovery routes and preserves explicit source", () => {
  const homeUrl = buildCinePulseUpstreamUrl("home", {});
  assert.equal(homeUrl.origin, CINEPULSE_UPSTREAM);
  assert.equal(homeUrl.pathname, "/api/v1/home");
  assert.equal(homeUrl.searchParams.get("source"), "all");
  assert.equal(homeUrl.searchParams.get("lang"), "en");

  const mlbdCat = buildCinePulseUpstreamUrl("catalog", { source: "movielinkbd", category: "/language/bangla", page: "2" });
  assert.equal(mlbdCat.searchParams.get("source"), "movielinkbd");
  assert.equal(mlbdCat.searchParams.get("category"), "/language/bangla");
  assert.equal(mlbdCat.searchParams.get("page"), "2");

  const streamUrl = buildCinePulseUpstreamUrl("stream", { path: "/movie/test-2026" });
  assert.equal(streamUrl.searchParams.get("source"), null);
});

test("rewriteCinePulseMediaUrl maps CinePulse tokens and proxies external URLs", () => {
  assert.equal(
    rewriteCinePulseMediaUrl("/api/mb-stream.mp4?t=cp1abc12345"),
    "/api/cinepulse-media?t=cp1abc12345"
  );
  assert.equal(
    rewriteCinePulseMediaUrl("https://okay-891h.onrender.com/api/mb-stream.mp4?t=cp1xyz999"),
    "/api/cinepulse-media?t=cp1xyz999"
  );
  const hls = rewriteCinePulseMediaUrl("https://cdn.example.com/live/master.m3u8", "hls");
  assert.match(hls, /^\/api\/mlbd-hls\.m3u8\?t=/);
  const sub = rewriteCinePulseMediaUrl("https://cdn.example.com/sub.srt", "subtitle");
  assert.match(sub, /^\/api\/moviebox-subtitle\/cp-sub\.vtt\?vtt=1&t=/);
});

test("normalizeCinePulseItem and normalizeCinePulsePayload preserve movielinkbd paths and proxy posters", () => {
  const item = normalizeCinePulseItem({
    title: "Premik Premika aar Petnee (2026)",
    path: "/series/premik-premika-aar-petnee-2026",
    poster: "https://img.movielinkapp.com/p/123.jpg",
    year: "2026"
  });
  assert.equal(item.source, "movielinkbd");
  assert.equal(item.isSeries, true);
  assert.match(item.poster, /^\/api\/moviebox-image\/cp-poster\.jpg\?t=/);
  assert.equal(item.detailsEndpoint, "/api/details?path=%2Fseries%2Fpremik-premika-aar-petnee-2026");

  const detail = normalizeCinePulseDetail({
    title: "Demo Movie",
    poster: "https://cdn.example.com/poster.jpg",
    sources: [{ url: "https://cdn.example.com/video.mp4", quality: "1080p" }],
    subtitles: [{ url: "https://cdn.example.com/en.srt", label: "English" }]
  }, "/movie/demo-movie-2026");
  assert.equal(detail.hasResource, true);
  assert.match(detail.sources[0].url, /^\/api\/mlbd-stream\.mp4\?t=/);
  assert.match(detail.subtitles[0].url, /^\/api\/moviebox-subtitle\/cp-sub\.vtt\?vtt=1&t=/);

  const payload = normalizeCinePulsePayload("stream", {
    ok: true,
    sources: [{ url: "/api/mb-stream.mp4?t=cp1tok123456", quality: "720p" }]
  });
  assert.equal(payload.sources[0].url, "/api/cinepulse-media?t=cp1tok123456");
});

test("loadDotEnvIfPresent loads unset env vars without overwriting existing process.env", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-env-"));
  const envFile = path.join(tmpDir, ".env");
  fs.writeFileSync(envFile, '# comment\nTEST_CP_KEY="secret-value-1"\nTEST_CP_EXISTING="should-not-overwrite"\n');
  const prevA = process.env.TEST_CP_KEY;
  const prevB = process.env.TEST_CP_EXISTING;
  delete process.env.TEST_CP_KEY;
  process.env.TEST_CP_EXISTING = "already-set";

  try {
    assert.equal(loadDotEnvIfPresent(envFile), true);
    assert.equal(process.env.TEST_CP_KEY, "secret-value-1");
    assert.equal(process.env.TEST_CP_EXISTING, "already-set");
  } finally {
    if (prevA === undefined) delete process.env.TEST_CP_KEY;
    else process.env.TEST_CP_KEY = prevA;
    if (prevB === undefined) delete process.env.TEST_CP_EXISTING;
    else process.env.TEST_CP_EXISTING = prevB;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mapCategoryToMlbdComUrls maps superhero, sports, and language categories cleanly", () => {
  assert.deepEqual(mapCategoryToMlbdComUrls("/collection/mcu-marvel-cinematic-universe"), ["/browse/genre-superhero"]);
  assert.deepEqual(mapCategoryToMlbdComUrls("/category/wwe"), ["/browse/genre-sports"]);
  assert.deepEqual(mapCategoryToMlbdComUrls("/language/bangla"), ["/browse/bangla", "/browse/bangla-dubbed"]);
});

test("matchesMlbdCategoryItem prevents unrelated anime/series leaks into MCU and WWE", () => {
  const animeItem = { title: "Fool Night (2026)", isSeries: true, isAnime: true, language: "Japanese" };
  const marvelItem = { title: "Captain America: Brave New World (2025)", isMovie: true, language: "English" };
  const wweItem = { title: "WWE WrestleMania 42 (2026)", isMovie: true, language: "English" };
  const banglaItem = { title: "Premik Premika aar Petnee (2026)", isSeries: true, language: "Bangla" };

  assert.equal(matchesMlbdCategoryItem(animeItem, "/collection/mcu-marvel-cinematic-universe"), false);
  assert.equal(matchesMlbdCategoryItem(marvelItem, "/collection/mcu-marvel-cinematic-universe"), true);
  assert.equal(matchesMlbdCategoryItem(animeItem, "/category/wwe"), false);
  assert.equal(matchesMlbdCategoryItem(wweItem, "/category/wwe"), true);
  assert.equal(matchesMlbdCategoryItem(banglaItem, "/language/bangla"), true);
  assert.equal(matchesMlbdCategoryItem(animeItem, "/language/bangla"), false);

  const hindiMovie = { title: "April X (2026) Hindi ORG", isSeries: false, isHindiDubbed: true, language: "Hindi" };
  const knightAnime = { title: "The Seven Knights of the Marronnier Kingdom (2026)", isSeries: true, isAnime: true };
  const banglaHorrorMovie = { title: "Bhooth Bangla (2026)", isSeries: false, language: "Hindi" };
  const banglaDubbedMovie = { title: "Pushpa 2 (2024) Bangla Dubbed", isSeries: false, language: "Bangla Dubbed" };
  const indianSeries = { title: "Mirzapur (2024) Hindi Original", isSeries: true, language: "Hindi Original" };

  assert.equal(matchesMlbdCategoryItem(hindiMovie, "/collection/best-bangla-dubbed-movies"), false);
  assert.equal(matchesMlbdCategoryItem(banglaDubbedMovie, "/collection/best-bangla-dubbed-movies"), true);
  assert.equal(matchesMlbdCategoryItem(knightAnime, "/collection/horror-night"), false);
  assert.equal(matchesMlbdCategoryItem(banglaHorrorMovie, "/collection/bangla-web-series"), false);
  assert.equal(matchesMlbdCategoryItem(banglaItem, "/collection/bangla-web-series"), true);
  assert.equal(matchesMlbdCategoryItem(animeItem, "/indian-series"), false);
  assert.equal(matchesMlbdCategoryItem(indianSeries, "/indian-series"), true);
});

test("MLBD_HEALTH_CHECKS requires /, /new, and /mostwatch/7d and evaluateMlbdHealthHtml excludes portals and redirects", () => {
  assert.deepEqual(
    MLBD_HEALTH_CHECKS.map(c => c.path),
    ["/", "/new", "/mostwatch/7d"]
  );

  const liveCardHtml = `
    <html><body>
      <div class="movie-card">
        <a href="/movie/test-live-movie-2026" class="title">Test Live Movie (2026)</a>
        <img data-src="https://img.movielinkapp.com/p/test.jpg" alt="Test Live Movie" />
        <span class="quality">1080p</span>
      </div>
    </body></html>
  `;

  for (const path of ["/", "/new", "/mostwatch/7d"]) {
    const res = evaluateMlbdHealthHtml({
      path,
      status: 200,
      ok: true,
      text: liveCardHtml,
      finalUrl: `https://rnztvk.movielinkbd.de${path}`,
      finalOrigin: "https://rnztvk.movielinkbd.de",
      baseUrl: "https://rnztvk.movielinkbd.de"
    });
    assert.equal(res.live, true);
    assert.equal(res.ok, true);
    assert.equal(res.fromArchive, false);
    assert.equal(res.cardCount, 1);
    assert.equal(res.reason, "ok");
  }

  const portalHtml = `<html><head><title>MovieLinkBD.com — Official</title></head><body>${"x".repeat(2000)}</body></html>`;
  const portalRes = evaluateMlbdHealthHtml({
    path: "/",
    status: 200,
    ok: true,
    text: portalHtml,
    finalUrl: "https://movielinkbd.com/",
    baseUrl: "https://movielinkbd.com"
  });
  assert.equal(portalRes.live, false);
  assert.equal(portalRes.ok, false);
  assert.equal(portalRes.cardCount, 0);
  assert.equal(portalRes.reason, "portal_landing");

  const collapsedRedirect = evaluateMlbdHealthHtml({
    path: "/new",
    status: 200,
    ok: true,
    text: liveCardHtml,
    finalUrl: "https://movielinkbd.com/",
    baseUrl: "https://movielinkbd.com"
  });
  assert.equal(collapsedRedirect.live, false);
  assert.equal(collapsedRedirect.reason, "redirected_to_home");

  const trapRes = evaluateMlbdHealthHtml({
    path: "/mostwatch/7d",
    status: 302,
    ok: false,
    blockedRedirect: "https://movielinkbd.app/",
    baseUrl: "https://movielinkbd.tv"
  });
  assert.equal(trapRes.live, false);
  assert.equal(trapRes.reason, "trap_redirect");
});

test("Trending /mostwatch/7d routing resolves upstream paths and preserves popularity ranking", () => {
  assert.equal(isMlbdTrendingPath("/mostwatch/7d"), true);
  assert.equal(isMlbdTrendingPath("/mostwatch/7d/page/2/"), true);
  assert.equal(isMlbdTrendingPath("/mostwatch"), true);
  assert.equal(isMlbdTrendingPath("/popular"), true);
  assert.equal(isMlbdTrendingPath("/new"), false);

  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/mostwatch/7d", page: 1 }), "/mostwatch/7d");
  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/mostwatch/7d", page: 2 }), "/mostwatch/7d/page/2/");
  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/popular", page: 1 }), "/mostwatch/7d");
  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/new", page: 1 }), "/new");

  const sampleHtml = `
    <div class="movie-card">
      <a href="/movie/older-hit-2024" class="title">Older Hit (2024)</a>
      <img data-src="https://img.movielinkapp.com/p/old.jpg" alt="Older Hit" />
      <span class="views-badge-top">188.42K</span>
    </div>
    <div class="movie-card">
      <a href="/series/bigg-boss-2026" class="title">Bigg Boss (2026) S20</a>
      <img data-src="https://img.movielinkapp.com/p/bb.jpg" alt="Bigg Boss" />
      <span class="views-badge-top">2.02M</span>
    </div>
  `;
  const parsed = extractCardsFromHtml(sampleHtml, "https://rnztvk.movielinkbd.de", {
    skipArchiveUpsert: true,
    skipRegistry: true
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].viewsText, "188.42K");
  assert.equal(parsed[0].views, 188420);
  assert.equal(parsed[0].fromArchive, false);
  assert.equal(parsed[1].viewsText, "2.02M");
  assert.equal(parsed[1].views, 2020000);
  assert.equal(parsed[1].fromArchive, false);

  const ordered = orderMlbdTrendingItems(parsed);
  assert.deepEqual(ordered.map(x => x.path), ["/series/bigg-boss-2026", "/movie/older-hit-2024"]);
});

test("Latest /new route resolves strictly to /new and never maps /new or /mostwatch/7d to homepage /", () => {
  assert.equal(isMlbdLatestPath("/new"), true);
  assert.equal(isMlbdLatestPath("/new/page/3/"), true);
  assert.equal(isMlbdLatestPath("/latest"), true);
  assert.equal(isMlbdLatestPath("/"), false);
  assert.equal(isMlbdLatestPath("/mostwatch/7d"), false);

  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/new", page: 1 }), "/new");
  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/new", page: 2 }), "/new/page/2/");
  assert.equal(resolveMlbdUpstreamCatalogPath({ path: "/latest", page: 1 }), "/new");

  assert.deepEqual(mapCategoryToMlbdComUrls("/new"), []);
  assert.deepEqual(mapCategoryToMlbdComUrls("/latest"), []);
  assert.deepEqual(mapCategoryToMlbdComUrls("/mostwatch/7d"), []);
  assert.deepEqual(mapCategoryToMlbdComUrls("/popular"), []);
});

test("media-delivery keeps protected CDNs proxied and serves verified MP4 CDNs directly with proxyUrl fallback", () => {
  assert.equal(isDirectPublicImageCdn("https://image.tmdb.org/t/p/w500/abc.jpg"), true);
  assert.equal(isDirectPublicImageCdn("https://img.movielinkapp.com/p/123.jpg"), true);
  assert.equal(isDirectPublicImageCdn("https://hakunaymatata.com/private/img.jpg"), false);

  assert.equal(isKnownProtectedMediaHost("https://mlbd-hls.fsldownload-worker.workers.dev/seg.m3u8"), true);
  assert.equal(isKnownProtectedMediaHost("https://bcdnxw.hakunaymatata.com/resource/vid.mp4"), true);
  assert.equal(isKnownProtectedMediaHost("https://fsl-cdn.fsldownload-worker.workers.dev/movie.mp4"), false);

  const directUrl = "https://fsl-cdn.fsldownload-worker.workers.dev/movie.mp4";
  const directSrc = applyDirectSourceMetadata(
    {
      url: "/api/mlbd-stream.mp4?t=abc",
      proxyUrl: "/api/mlbd-stream.mp4?t=abc",
      quality: "1080p",
      format: "MP4"
    },
    directUrl
  );
  assert.equal(directSrc.url, directUrl);
  assert.equal(directSrc.directUrl, directUrl);
  assert.equal(directSrc.proxyUrl, "/api/mlbd-stream.mp4?t=abc");
  assert.equal(directSrc.directPlayback, true);

  const downgradedSrc = applyDirectSourceMetadata(directSrc, directUrl, { directOk: false, directCors: false });
  assert.equal(downgradedSrc.url, "/api/mlbd-stream.mp4?t=abc");
  assert.equal(downgradedSrc.proxyUrl, "/api/mlbd-stream.mp4?t=abc");
  assert.equal(downgradedSrc.directPlayback, false);

  const hlsSrc = applyDirectSourceMetadata(
    {
      url: "/api/mlbd-hls.m3u8?t=xyz",
      proxyUrl: "/api/mlbd-hls.m3u8?t=xyz",
      quality: "720p",
      format: "HLS"
    },
    "https://mlbd-hls.fsldownload-worker.workers.dev/master.m3u8"
  );
  assert.equal(hlsSrc.url, "/api/mlbd-hls.m3u8?t=xyz");
  assert.equal(hlsSrc.directPlayback, false);

  assert.deepEqual(
    isDirectMediaResponseSafe({
      ok: true,
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-range": "bytes 0-255/1048576",
        "access-control-allow-origin": "*"
      }
    }),
    { directOk: true, directCors: true }
  );
  assert.deepEqual(
    isDirectMediaResponseSafe({
      ok: true,
      status: 200,
      headers: {
        "content-type": "image/jpeg"
      }
    }),
    { directOk: false, directCors: false }
  );
});

test("Mirror system isolates 403, Cloudflare challenge, and 429 retry-after per mirror without global blocking", async () => {
  resetMirrorStates();
  try {
    const cfHeaders = new Headers({ "cf-mitigated": "challenge" });
    const plain403 = classifyMirrorFailure({ status: 403, headers: new Headers(), text: "Forbidden" });
    const cf403 = classifyMirrorFailure({ status: 403, headers: cfHeaders, text: "Just a moment..." });
    const rl429 = classifyMirrorFailure({ status: 429, headers: new Headers({ "retry-after": "2" }), text: "Too Many Requests" });

    assert.equal(plain403.reason, "http_403");
    assert.equal(plain403.isCloudflareBlock, false);
    assert.equal(cf403.reason, "cf_challenge");
    assert.equal(cf403.isCloudflareBlock, true);
    assert.ok(cf403.cooldownMs > plain403.cooldownMs);
    assert.equal(rl429.reason, "rate_limit_429");
    assert.equal(rl429.retryAfterMs, 2000);
    assert.equal(isCloudflareBlockedResponse(403, new Headers(), "Forbidden"), false);
    assert.equal(isCloudflareBlockedResponse(403, cfHeaders, "Challenge"), true);

    const calls = [];
    const validHtml = `<html><body><div class="movie-card"><a href="/movie/ok-2026" class="title">OK Movie (2026)</a></div>${"x".repeat(500)}</body></html>`;
    const mirrors = [
      "https://rnztvk.movielinkbd.de",
      "https://movielinkbd.tv",
      "https://5njsa5.movielinkbd.de",
      "https://74wyzj.movielinkbd.de"
    ];

    const res = await mlbdFetchPage("/new", {
      bypassCache: true,
      mirrors,
      retryDelayCapMs: 50,
      discoverMirrorsFn: async () => [],
      fetchMirrorFn: async (base, path) => {
        calls.push(`${base}${path}`);
        if (base === "https://rnztvk.movielinkbd.de") {
          return { res: { ok: false, status: 403, headers: new Headers() }, text: "Access Denied", finalUrl: `${base}${path}`, finalOrigin: base };
        }
        if (base === "https://movielinkbd.tv") {
          return { res: { ok: false, status: 403, headers: new Headers({ "cf-mitigated": "challenge" }) }, text: "Just a moment...", finalUrl: `${base}${path}`, finalOrigin: base };
        }
        if (base === "https://5njsa5.movielinkbd.de") {
          return { res: { ok: false, status: 429, headers: new Headers({ "retry-after": "1" }) }, text: "Rate limited", finalUrl: `${base}${path}`, finalOrigin: base };
        }
        return { res: { ok: true, status: 200, headers: new Headers() }, text: validHtml, finalUrl: `${base}${path}`, finalOrigin: base };
      }
    });

    assert.equal(res.mirrorUsed, "https://74wyzj.movielinkbd.de");
    // 5njsa5 should have been retried once after 429 delay before moving on
    assert.equal(calls.filter(c => c.startsWith("https://5njsa5.movielinkbd.de")).length, 2);

    // Per-mirror independent cooldowns: failed mirrors are in cooldown, healthy mirror is not
    assert.equal(isMirrorInCooldown("https://rnztvk.movielinkbd.de"), true);
    assert.equal(isMirrorInCooldown("https://movielinkbd.tv"), true);
    assert.equal(isMirrorInCooldown("https://5njsa5.movielinkbd.de"), true);
    assert.equal(isMirrorInCooldown("https://74wyzj.movielinkbd.de"), false);

    const snapshot = getMirrorHealthSnapshot();
    assert.equal(snapshot["https://rnztvk.movielinkbd.de"].lastReason, "http_403");
    assert.equal(snapshot["https://movielinkbd.tv"].lastReason, "cf_challenge");
    assert.equal(snapshot["https://5njsa5.movielinkbd.de"].lastReason, "rate_limit_429");
    assert.equal(snapshot["https://74wyzj.movielinkbd.de"].lastReason, "ok");

    // Subsequent request should skip cooldown mirrors and go directly to the healthy mirror
    const secondCalls = [];
    const res2 = await mlbdFetchPage("/mostwatch/7d", {
      mirrors,
      discoverMirrorsFn: async () => [],
      fetchMirrorFn: async (base, path) => {
        secondCalls.push(base);
        return { res: { ok: true, status: 200, headers: new Headers() }, text: validHtml, finalUrl: `${base}${path}`, finalOrigin: base };
      }
    });
    assert.equal(res2.mirrorUsed, "https://74wyzj.movielinkbd.de");
    assert.deepEqual(secondCalls, ["https://74wyzj.movielinkbd.de"]);
  } finally {
    resetMirrorStates();
  }
});

test("mergeAndDedupeMlbdItems merges Live+Archive, deduplicates by title & path, keeps newest first for Latest, and preserves Trending rank", () => {
  const now = Date.now();
  const liveLatest = [
    { path: "/movie/alpha-2026", title: "Alpha (2026)", year: "2026", uploadedAtMs: now - 3600_000, poster: "", fromArchive: false },
    { path: "/series/beta-2026", title: "Beta (2026) S01", year: "2026", uploadedAtMs: now - 7200_000, poster: "https://img.example/beta.jpg", isSeries: true, fromArchive: false }
  ];
  const archiveLatest = [
    // Duplicate by path (should enrich poster onto Live item)
    { path: "/movie/alpha-2026", title: "Alpha (2026)", year: "2026", uploadedAtMs: now - 86400_000, poster: "https://img.example/alpha.jpg", fromArchive: true },
    // Duplicate by title with different path (should deduplicate!)
    { path: "/series/mKs_beta_dup", title: "Beta (2026) S01", year: "2026", uploadedAtMs: now - 90000_000, poster: "https://img.example/beta2.jpg", isSeries: true, fromArchive: true },
    // Unique archive item that is newer than Beta
    { path: "/movie/gamma-2026", title: "Gamma (2026)", year: "2026", uploadedAtMs: now - 5400_000, poster: "https://img.example/gamma.jpg", fromArchive: true }
  ];

  const mergedLatest = mergeAndDedupeMlbdItems(liveLatest, archiveLatest, { mode: "latest" });
  assert.equal(mergedLatest.length, 3);
  assert.deepEqual(mergedLatest.map(x => x.path), ["/movie/alpha-2026", "/movie/gamma-2026", "/series/beta-2026"]);
  assert.equal(mergedLatest[0].fromArchive, false);
  assert.equal(mergedLatest[0].poster, "https://img.example/alpha.jpg");
  assert.equal(mergedLatest[1].fromArchive, true);

  const liveTrending = [
    { path: "/movie/t1", title: "Trend One (2026)", year: "2026", views: 500000, fromArchive: false },
    { path: "/movie/t2", title: "Trend Two (2026)", year: "2026", views: 1200000, fromArchive: false }
  ];
  const archiveTrending = [
    { path: "/movie/t2-alt", title: "Trend Two (2026)", year: "2026", views: 9999999, fromArchive: true },
    { path: "/movie/t3", title: "Archive Hit (2025)", year: "2025", views: 2500000, hypeScore: 900, fromArchive: true },
    { path: "/movie/t4", title: "Archive Older (2024)", year: "2024", views: 100000, hypeScore: 200, fromArchive: true }
  ];

  const mergedTrending = mergeAndDedupeMlbdItems(liveTrending, archiveTrending, { mode: "trending" });
  // Live trending stays ordered by real live views first, deduplicating Trend Two, followed by Archive ordered by views desc
  assert.deepEqual(mergedTrending.map(x => x.path), ["/movie/t2", "/movie/t1", "/movie/t3", "/movie/t4"]);
  assert.equal(mergedTrending[0].fromArchive, false);
  assert.equal(mergedTrending[2].fromArchive, true);
});

test("buildMlbdComItem preserves full batch title in detailsEndpoint and disambiguates synthetic batch paths", () => {
  const ep135 = buildMlbdComItem({
    title: "Bachelor Point (2026) S05 [Ep 135-140 Completed]",
    year: "2026",
    typeText: "Series"
  });
  const ep129 = buildMlbdComItem({
    title: "Bachelor Point (2026) S05 [Ep 129-134 Completed]",
    year: "2026",
    typeText: "Series"
  });

  assert.ok(ep135 && ep129);
  assert.notEqual(ep135.path, ep129.path);
  const qs = new URLSearchParams(ep135.detailsEndpoint.split("?")[1] || "");
  assert.equal(qs.get("title"), "Bachelor Point (2026) S05 [Ep 135-140 Completed]");

  const synA = buildMlbdComItem({
    title: "Synthetic Test Show (2026) S05 [Ep 135-140 Completed]",
    year: "2026",
    typeText: "Series"
  });
  const synB = buildMlbdComItem({
    title: "Synthetic Test Show (2026) S05 [Ep 129-134 Completed]",
    year: "2026",
    typeText: "Series"
  });
  assert.match(synA.path, /-s05-ep-135-140$/);
  assert.match(synB.path, /-s05-ep-129-134$/);
  assert.notEqual(synA.path, synB.path);
});



