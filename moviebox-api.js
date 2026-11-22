import crypto from "node:crypto";

export const MOVIEBOX_API = "https://h5-api.aoneroom.com";
export const MOVIEBOX_SPORT_API = "https://h5-sport-api.aoneroom.com";
export const MOVIEBOX_REFERER = "https://moviebox01.com/";
export const MOVIEBOX_PLAYER_REFERER = "https://movie-box.co/";
export const MOVIEBOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TOKEN_SECRET =
  process.env.MEDIA_PROXY_SECRET ||
  crypto.createHash("sha256").update(`${import.meta.url}::chineverse-media-proxy`).digest("hex");
const cache = new Map();
const subjectIndex = new Map();

export const CATEGORIES = [
  { label: "Movies", path: "/type/movies" },
  { label: "Dramas & Series", path: "/type/series" },
  { label: "K-Drama", path: "/language/korean" },
  { label: "C-Drama", path: "/language/chinese" },
  { label: "Hindi Dubbed", path: "/language/hindi-dubbed" },
  { label: "South Indian", path: "/southIndian" },
  { label: "Bollywood", path: "/bollywood" },
  { label: "Hollywood", path: "/language/english" },
  { label: "Bengali", path: "/language/bengali" },
  { label: "Anime", path: "/anime" },
  { label: "Short Drama", path: "/shorts" },
  { label: "Upcoming", path: "/upcoming" }
];

const COUNTRY_LANGUAGE_MAP = {
  "south korea": "Korean",
  korea: "Korean",
  china: "Chinese",
  taiwan: "Chinese",
  "hong kong": "Chinese",
  japan: "Japanese",
  india: "Hindi",
  bangladesh: "Bengali",
  pakistan: "Urdu",
  thailand: "Thai",
  indonesia: "Indonesian",
  philippines: "Filipino",
  "united states": "English",
  "united kingdom": "English",
  canada: "English",
  australia: "English",
  france: "French",
  spain: "Spanish",
  turkey: "Turkish"
};

export function buildMovieBoxHeaders(extra = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const reversed = String(ts).split("").reverse().join("");
  const hash = crypto.createHash("md5").update(reversed).digest("hex");
  return {
    "User-Agent": MOVIEBOX_UA,
    Accept: "application/json",
    "Content-Type": "application/json",
    Referer: MOVIEBOX_REFERER,
    "X-Client-Info": JSON.stringify({ timezone: "Asia/Dhaka" }),
    "X-Vip-Restrict": "0",
    "X-No-High-Risk-Restrict": "1",
    "X-Request-Lang": "en",
    "X-Client-Token": `${ts},${hash}`,
    ...extra
  };
}

export function signMediaToken(url) {
  const payload = Buffer.from(String(url), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyMediaToken(token) {
  const raw = String(token || "");
  const dot = raw.indexOf(".");
  if (dot <= 0) return "";
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
  if (sig.length !== expected.length) return "";
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return "";
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = new URL(decoded);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

async function mbFetch(url, options = {}, ttlMs = 0) {
  const method = (options.method || "GET").toUpperCase();
  const cacheKey = `${method}:${url}:${options.body || ""}`;
  if (ttlMs > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
  }
  const response = await fetch(url, {
    method,
    headers: buildMovieBoxHeaders(options.headers || {}),
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 20000)
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`MovieBox API returned non-JSON (${response.status})`);
  }
  if (ttlMs > 0 && response.ok && json && json.code === 0) {
    cache.set(cacheKey, { data: json, expiresAt: Date.now() + ttlMs });
  }
  return json;
}

function inferLanguage(subject) {
  const title = String(subject?.title || "");
  const country = String(subject?.countryName || subject?.country || "").toLowerCase();
  const dubs = Array.isArray(subject?.dubs) ? subject.dubs : [];
  const hasHindiDub =
    /\[hindi\]|hindi dub/i.test(title) ||
    dubs.some(d => /hindi|^hi$/i.test(String(d?.lanName || d?.lanCode || d?.language || "")));
  const baseLang = COUNTRY_LANGUAGE_MAP[country] || "";
  if (hasHindiDub && baseLang && baseLang !== "Hindi") {
    return `${baseLang} · Hindi Dubbed`;
  }
  if (hasHindiDub) return "Hindi Dubbed";
  return baseLang || subject?.countryName || "International";
}

export function normalizeSubject(raw, extra = {}) {
  if (!raw || typeof raw !== "object") return null;
  const s = raw.subject && typeof raw.subject === "object" ? { ...raw.subject, ...raw, title: raw.title || raw.subject.title } : raw;
  const subjectId = String(s.subjectId || s.id || "").trim();
  const detailPath = String(s.detailPath || "").trim();
  const title = String(s.title || "").trim();
  if ((!subjectId && !detailPath && !title) || s.webHighRisk === true) return null;

  const subjectType = Number(s.subjectType || 1);
  const type =
    subjectType === 2
      ? "series"
      : subjectType === 6
        ? "anime"
        : subjectType === 7
          ? "series"
          : "movie";
  const typeBadge =
    subjectType === 2
      ? "Series"
      : subjectType === 6
        ? "Anime"
        : subjectType === 7
          ? "Short Drama"
          : "Movie";

  const poster =
    s.cover?.url ||
    s.image?.url ||
    (typeof s.poster === "string" ? s.poster : "") ||
    "";
  const path = subjectId
    ? `/mb/${subjectId}/${detailPath || subjectId}`
    : detailPath
      ? `/mb/${detailPath}`
      : "";
  const releaseDate = String(s.releaseDate || s.appointmentDate || "").trim();
  const language = inferLanguage(s);
  const dubs = Array.isArray(s.dubs) ? s.dubs : [];
  const isHindiDubbed =
    extra._hindiCatalog === true ||
    /hindi/i.test(title) ||
    /hindi/i.test(language) ||
    dubs.some(d => /hindi|^hi$/i.test(String(d?.lanName || d?.lanCode || "")));

  const item = {
    id: subjectId || detailPath,
    subjectId,
    detailPath,
    path,
    title: title || "Untitled",
    description: String(s.description || "").trim(),
    storyline: String(s.description || "").trim(),
    poster,
    previewImage: poster,
    posterUrl: poster,
    cover: poster,
    releaseDate,
    year: releaseDate.slice(0, 4),
    genre: String(s.genre || "").trim(),
    country: String(s.countryName || s.country || "").trim(),
    rating: String(s.imdbRatingValue || "").trim(),
    views: Number(s.imdbRatingCount || s.appointmentCnt || 0),
    subjectType,
    type,
    mediaType: type,
    typeBadge,
    isMovie: subjectType === 1,
    isSeries: subjectType === 2 || subjectType === 7,
    isAnime: subjectType === 6,
    quality: String(s.corner || "").trim() || "1080p",
    language,
    dubs,
    isHindiDubbed,
    _hindiCatalog: isHindiDubbed,
    _latestFeed: true,
    _dramaCatalog: subjectType === 2 || subjectType === 7,
    _koreanCatalog: /korea/i.test(String(s.countryName || "")),
    _animeCatalog: subjectType === 6,
    ...extra
  };

  if (subjectId) {
    subjectIndex.set(subjectId, item);
  }
  if (detailPath) {
    subjectIndex.set(detailPath.toLowerCase(), item);
  }
  return item;
}

function indexList(list, extra = {}) {
  return (Array.isArray(list) ? list : [])
    .map(item => normalizeSubject(item, extra))
    .filter(Boolean);
}

function parseMbPath(pathStr) {
  const clean = String(pathStr || "").replace(/^\/+(?:mb|movie|series)\//, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
    return { subjectId: parts[0], detailPath: parts.slice(1).join("/") };
  }
  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    return { subjectId: parts[0], detailPath: "" };
  }
  return { subjectId: "", detailPath: parts.join("/") };
}

async function resolveSubjectIdentity({ pathStr = "", subjectId = "", detailPath = "", title = "" }) {
  let sid = String(subjectId || "").trim();
  let dp = String(detailPath || "").trim();
  if (pathStr) {
    const parsed = parseMbPath(pathStr);
    if (!sid && parsed.subjectId) sid = parsed.subjectId;
    if (!dp && parsed.detailPath) dp = parsed.detailPath;
  }
  if (sid && (!dp || dp === sid)) {
    const cached = subjectIndex.get(sid);
    if (cached?.detailPath) dp = cached.detailPath;
  }
  if (!sid && dp) {
    const cached = subjectIndex.get(dp.toLowerCase());
    if (cached?.subjectId) sid = cached.subjectId;
  }
  if (!sid && title) {
    const q = String(title).trim().toLowerCase();
    for (const item of subjectIndex.values()) {
      if (item.title.toLowerCase() === q) {
        sid = item.subjectId;
        dp = item.detailPath;
        break;
      }
    }
  }
  return { subjectId: sid, detailPath: dp };
}

async function warmSubjectIndexIfNeeded() {
  if (subjectIndex.size >= 360) return;
  const jobs = [
    getHomeFeed(),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=1&perPage=28`, {}, 300000).then(j =>
      indexList(j?.data?.subjectList)
    ),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=2&perPage=28`, {}, 300000).then(j =>
      indexList(j?.data?.subjectList)
    ),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=3&perPage=28`, {}, 300000).then(j =>
      indexList(j?.data?.subjectList)
    ),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/ranking-list/content?id=872031290915189720&page=1&perPage=20`, {}, 300000).then(j =>
      indexList(j?.data?.subjectList)
    ),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/everyone-search`, {}, 300000).then(j => {
      for (const group of j?.data?.hot || []) indexList(group?.items);
    })
  ];
  for (const ch of [1, 2, 6, 7]) {
    for (const page of [1, 2]) {
      jobs.push(
        mbFetch(
          `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
          { method: "POST", body: JSON.stringify({ page, perPage: 24, channelId: ch, sort: "Hottest" }) },
          300000
        ).then(j => indexList(j?.data?.items))
      );
    }
  }
  for (const country of ["India", "South Korea", "China", "United States"]) {
    jobs.push(
      mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
        { method: "POST", body: JSON.stringify({ page: 1, perPage: 24, channelId: 1, country, sort: "Hottest" }) },
        300000
      ).then(j => indexList(j?.data?.items))
    );
  }
  await Promise.allSettled(jobs);
}

function mapPlatformName(name) {
  const raw = String(name || "").trim();
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = {
    netflix: "Netflix",
    primevideo: "PrimeVideo",
    amazonprime: "PrimeVideo",
    disney: "Disney",
    disneyplus: "Disney",
    appletv: "AppleTV",
    appletvplus: "AppleTV",
    viu: "Viu",
    hulu: "Hulu",
    zee5: "Zee5",
    vivamax: "Vivamax",
    hoichoi: "Hoichoi",
    showmax: "Showmax"
  };
  return map[key] || raw || "Netflix";
}

function categoryToFilterBody(category, page = 1) {
  const c = String(category || "").toLowerCase();
  const body = { page, perPage: 24, channelId: 1, sort: "Latest" };
  if (c.includes("series") || c === "/drama" || c.includes("drama")) body.channelId = 2;
  if (c.includes("anime")) body.channelId = 6;
  if (c.includes("short")) body.channelId = 7;
  if (c.includes("korean")) {
    body.channelId = 2;
    body.country = "South Korea";
  } else if (c.includes("chinese")) {
    body.channelId = 2;
    body.country = "China";
  } else if (c.includes("japanese")) {
    body.country = "Japan";
  } else if (c.includes("hindi-dubbed") || c.includes("hindi dub")) {
    body.classify = "Hindi dub";
  } else if (c.includes("hindi")) {
    body.country = "India";
  } else if (c.includes("bollywood") || c.includes("/trending/india")) {
    body.country = "India";
  } else if (c.includes("bangla") || c.includes("bengali") || c.includes("bangladesh")) {
    body.country = "Bangladesh";
  } else if (c.includes("pakistan")) {
    body.country = "Pakistan";
  } else if (c.includes("english") || c.includes("hollywood")) {
    body.country = "United States";
  }
  if (c.startsWith("/genre/")) {
    const g = category.split("/").pop() || "";
    body.genre = g.charAt(0).toUpperCase() + g.slice(1);
  }
  return body;
}

export async function getHomeFeed() {
  const [homeRes, trendingRes, upcomingRes, hindiRes] = await Promise.allSettled([
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/home?host=movie-box.co`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=1&perPage=28`, {}, 180000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/upcoming-subject-list?page=1&perPage=18`, {}, 300000),
    mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
      method: "POST",
      body: JSON.stringify({ page: 1, perPage: 18, channelId: 1, classify: "Hindi dub", sort: "Latest" })
    }, 180000)
  ]);

  const homeData = homeRes.status === "fulfilled" ? homeRes.value?.data || {} : {};
  const opList = Array.isArray(homeData.operatingList) ? homeData.operatingList : [];

  const banners = [];
  const sections = [];
  const upcoming = [];

  for (const op of opList) {
    if (op.type === "BANNER" && Array.isArray(op.banner?.items)) {
      for (const b of op.banner.items) {
        const item = normalizeSubject(b.subject || b, {
          poster: b.image?.url || b.subject?.cover?.url || "",
          previewImage: b.image?.url || b.subject?.cover?.url || ""
        });
        if (item) banners.push(item);
      }
    } else if (op.type === "SUBJECTS_MOVIE" && Array.isArray(op.subjects) && op.subjects.length) {
      const title = String(op.title || "Featured").trim();
      if (/nollywood|black shows/i.test(title)) continue;
      const items = indexList(op.subjects);
      if (items.length) {
        sections.push({
          title,
          badge: "MOVIEBOX LIVE",
          categoryPath: /k-drama/i.test(title)
            ? "/language/korean"
            : /c-drama/i.test(title)
              ? "/language/chinese"
              : /anime/i.test(title)
                ? "/anime"
                : /series/i.test(title)
                  ? "/type/series"
                  : "/type/movies",
          items
        });
      }
    } else if (op.type === "APPOINTMENT_LIST" && Array.isArray(op.subjects)) {
      upcoming.push(...indexList(op.subjects));
    }
  }

  const hindiItems =
    hindiRes.status === "fulfilled" ? indexList(hindiRes.value?.data?.items, { _hindiCatalog: true }) : [];
  if (hindiItems.length) {
    sections.unshift({
      title: "Hindi Dubbed — Movies & Series",
      badge: "HINDI AUDIO",
      categoryPath: "/language/hindi-dubbed",
      items: hindiItems
    });
  }

  const trending =
    trendingRes.status === "fulfilled" ? indexList(trendingRes.value?.data?.subjectList) : [];
  const rawUpcoming =
    upcomingRes.status === "fulfilled" ? indexList(upcomingRes.value?.data?.items) : [];
  const upcomingList = rawUpcoming.length ? rawUpcoming : upcoming;

  const platforms = Array.isArray(homeData.platformList)
    ? homeData.platformList.map(p => ({ name: p.name }))
    : [];

  return {
    ok: true,
    categories: CATEGORIES,
    platforms,
    banners: banners.length ? banners : trending.slice(0, 6),
    trending,
    upcoming: upcomingList.length ? upcomingList : upcoming,
    sections
  };
}

export async function handleMovieBoxRoute(legacy, query) {
  switch (legacy) {
    case "home":
      return await getHomeFeed();

    case "categories":
      return { ok: true, categories: CATEGORIES };

    case "trending": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const perPage = Math.min(28, Math.max(1, Number(query.get("perPage") || 24)));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/trending?page=${page}&perPage=${perPage}`,
        {},
        180000
      );
      const items = indexList(j?.data?.subjectList);
      return {
        ok: true,
        items,
        pager: j?.data?.pager || {},
        totalPages: Number(j?.data?.pager?.totalCount ? Math.ceil(j.data.pager.totalCount / perPage) : 5)
      };
    }

    case "ranking": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const perPage = Math.min(24, Math.max(1, Number(query.get("perPage") || 20)));
      const id = String(query.get("id") || "872031290915189720");
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/ranking-list/content?id=${encodeURIComponent(id)}&page=${page}&perPage=${perPage}`,
        {},
        180000
      );
      const items = indexList(j?.data?.subjectList);
      return { ok: true, title: j?.data?.title || "Top Charts", items, pager: j?.data?.pager || {} };
    }

    case "search": {
      const keyword = String(query.get("q") || query.get("keyword") || "").trim();
      const page = Math.max(1, Number(query.get("page") || 1));
      const rawTypes = String(query.get("subjectType") || "0")
        .split(",")
        .map(n => Number(n.trim()))
        .filter(n => Number.isFinite(n) && n > 0);
      const subjectType = rawTypes.length === 1 ? rawTypes[0] : 0;
      if (!keyword) return { ok: true, items: [], page: 1, totalPages: 1 };

      const matchesType = item => {
        if (!rawTypes.length) return true;
        const st = Number(item.subjectType || 1);
        if (rawTypes.includes(st)) return true;
        if (rawTypes.includes(6) && (item.isAnime === true || /anime|animation/i.test(`${item.genre} ${item.typeBadge} ${item.title}`))) return true;
        if (rawTypes.includes(7) && /short/i.test(`${item.typeBadge} ${item.genre}`)) return true;
        return false;
      };

      // 1) Try direct MovieBox subject/search endpoint first
      try {
        const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search`, {
          method: "POST",
          body: JSON.stringify({ keyword, page, perPage: 24, subjectType })
        });
        if (j?.code === 0 && Array.isArray(j?.data?.items)) {
          const items = indexList(j.data.items).filter(matchesType);
          return {
            ok: true,
            items,
            pager: j.data.pager || {},
            totalPages: j.data.pager?.hasMore ? page + 1 : page
          };
        }
      } catch {
        // Fall through to suggestion + enriched catalog index search
      }

      // 2) Enriched multi-token + suggest + filter search fallback
      await warmSubjectIndexIfNeeded();
      const lower = keyword.toLowerCase();
      const tokens = lower.split(/\s+/).filter(Boolean);
      const uniq = new Map();

      const scoreItem = item => {
        const titleLower = String(item.title || "").toLowerCase();
        const hay = `${titleLower} ${item.genre} ${item.country} ${item.language} ${item.typeBadge} ${item.description}`.toLowerCase();
        if (titleLower === lower) return 100;
        if (titleLower.startsWith(lower)) return 80;
        if (titleLower.includes(lower)) return 60;
        if (tokens.length > 1 && tokens.every(t => hay.includes(t))) return 40;
        if (hay.includes(lower)) return 25;
        if (rawTypes.includes(6) && /anime/i.test(lower) && (item.isAnime || /animation|anime/i.test(item.genre))) return 20;
        return 0;
      };

      const collectFromIndex = terms => {
        for (const item of subjectIndex.values()) {
          if (!item.subjectId || !matchesType(item)) continue;
          let sc = scoreItem(item);
          if (!sc && Array.isArray(terms) && terms.length) {
            const tLower = item.title.toLowerCase();
            if (terms.some(w => tLower.includes(w))) sc = 35;
          }
          if (sc > 0) {
            const prev = uniq.get(item.subjectId);
            if (!prev || sc > prev._sc) uniq.set(item.subjectId, { ...item, _sc: sc });
          }
        }
      };

      let suggestTerms = [];
      try {
        const sg = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/search-suggest`, {
          method: "POST",
          body: JSON.stringify({ keyword, perPage: 10 })
        }, 45000);
        for (const s of sg?.data?.items || []) {
          if (s?.subject) {
            const norm = normalizeSubject(s.subject);
            if (norm?.subjectId && matchesType(norm)) uniq.set(norm.subjectId, { ...norm, _sc: 90 });
          } else if (typeof s?.word === "string" && s.word.trim()) {
            suggestTerms.push(s.word.trim().toLowerCase());
          }
        }
      } catch {}

      collectFromIndex(suggestTerms);

      // If keyword hints at a genre/country/language, also pull live filtered titles on demand
      const dynamicFilters = [];
      if (/hindi/i.test(lower)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 1, classify: "Hindi dub", sort: "Hottest" }, extra: { _hindiCatalog: true } });
      if (/bengali|bangla/i.test(lower)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 1, country: "India", sort: "Latest" }, extra: {} });
      if (/korean|k-?drama/i.test(lower)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 2, country: "South Korea", sort: "Hottest" }, extra: {} });
      if (/anime/i.test(lower) || rawTypes.includes(6)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 6, sort: "Hottest" }, extra: { isAnime: true, _animeCatalog: true } });
      if (/short/i.test(lower) || rawTypes.includes(7)) dynamicFilters.push({ body: { page: 1, perPage: 24, channelId: 7, sort: "Hottest" }, extra: { subjectType: 7 } });
      if (dynamicFilters.length && uniq.size < 12) {
        await Promise.allSettled(
          dynamicFilters.map(df =>
            mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
              method: "POST",
              body: JSON.stringify(df.body)
            }, 120000).then(j => indexList(j?.data?.items, df.extra))
          )
        );
        collectFromIndex(suggestTerms);
      }

      const list = [...uniq.values()]
        .sort((a, b) => (b._sc || 0) - (a._sc || 0) || (b.views || 0) - (a.views || 0))
        .map(({ _sc, ...rest }) => rest);
      return { ok: true, items: list, page: 1, totalPages: 1 };
    }

    case "suggest": {
      const keyword = String(query.get("q") || query.get("keyword") || "").trim();
      if (!keyword) return { ok: true, items: [] };
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/search-suggest`,
        {
          method: "POST",
          body: JSON.stringify({ keyword, perPage: 10 })
        },
        45000
      );
      const raw = Array.isArray(j?.data?.items) ? j.data.items : [];
      const items = raw.map(x => {
        if (x?.subject) return normalizeSubject(x.subject);
        return x?.word || x?.title || "";
      }).filter(Boolean);
      return { ok: true, items };
    }

    case "hot-search": {
      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/everyone-search`, {}, 60000);
      const everyone = Array.isArray(j?.data?.everyoneSearch) ? j.data.everyoneSearch : [];
      for (const group of j?.data?.hot || []) {
        indexList(group?.items);
      }
      const items = everyone.map(x => x?.title || x?.word || x).filter(Boolean);
      return { ok: true, items };
    }

    case "filter-options": {
      await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/filter`, {}, 600000).catch(() => null);
      return {
        ok: true,
        languages: ["Hindi", "Korean", "Chinese", "English", "Bengali", "Japanese", "Tamil", "Urdu"],
        types: ["Movie", "Series", "Anime", "Short Drama"],
        genres: ["Action", "Adventure", "Animation", "Comedy", "Crime", "Drama", "Family", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller"]
      };
    }

    case "catalog":
    case "filter": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const cat = String(query.get("category") || query.get("path") || "");
      const lower = cat.toLowerCase();

      if (lower === "/upcoming") {
        return await handleMovieBoxRoute("upcoming", query);
      }
      if (lower === "/mostwatch/7d" || lower === "/new") {
        return await handleMovieBoxRoute("trending", query);
      }
      if (lower.includes("southindian") || lower.includes("south-indian")) {
        const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`, {
          method: "POST",
          body: JSON.stringify({ page, perPage: 24, channelId: 1, country: "India", sort: "Hottest" })
        }, 120000);
        return { ok: true, items: indexList(j?.data?.items), page, totalPages: j?.data?.pager?.hasMore ? page + 1 : page };
      }

      const body = categoryToFilterBody(cat, page);
      if (query.get("channelId")) body.channelId = Number(query.get("channelId"));
      if (query.get("genre")) body.genre = query.get("genre");
      if (query.get("country")) body.country = query.get("country");
      if (query.get("year")) body.year = query.get("year");
      if (query.get("sort")) body.sort = query.get("sort");
      if (query.get("classify")) body.classify = query.get("classify");

      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
        { method: "POST", body: JSON.stringify(body) },
        120000
      );
      const extra = body.classify === "Hindi dub" ? { _hindiCatalog: true } : {};
      let items = indexList(j?.data?.items, extra);
      // Fallback if a country filter like Bangladesh returns 0 in MovieBox filter
      if (!items.length && body.country === "Bangladesh") {
        const home = await getHomeFeed();
        items = [...home.trending, ...home.sections.flatMap(s => s.items)].filter(i => /bengali|bangla/i.test(i.language + " " + i.title)).slice(0, 24);
      }
      const totalCount = Number(j?.data?.pager?.totalCount || 0);
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / 24)) : (j?.data?.pager?.hasMore ? page + 1 : page);
      return { ok: true, items, page, totalPages, pager: j?.data?.pager || {} };
    }

    case "platform": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const platform = mapPlatformName(query.get("platform") || query.get("name") || "Netflix");
      // MovieBox requires perPage <= 6 (400 Error if > 6)
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/platform/play-list?page=${page}&perPage=6&platform=${encodeURIComponent(platform)}`,
        {},
        180000
      );
      const months = Array.isArray(j?.data?.monthList) ? j.data.monthList : [];
      const rawSubjects = months.flatMap(m => (Array.isArray(m.subjects) ? m.subjects : []));
      const items = indexList(rawSubjects, { platform });
      const totalCount = Number(j?.data?.pager?.totalCount || 0);
      const totalPages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / 6)) : (j?.data?.pager?.hasMore ? page + 1 : page);
      return { ok: true, platform, items, page, totalPages, pager: j?.data?.pager || {} };
    }

    case "upcoming": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/upcoming-subject-list?page=${page}&perPage=24`,
        {},
        300000
      );
      let items = indexList(j?.data?.items);
      if (!items.length && page === 1) {
        const home = await getHomeFeed();
        items = Array.isArray(home.upcoming) ? home.upcoming : [];
      }
      return { ok: true, items, page };
    }

    case "shorts":
    case "reels": {
      const page = Math.max(1, Number(query.get("page") || 1));
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/filter`,
        {
          method: "POST",
          body: JSON.stringify({ page, perPage: 24, channelId: 7, sort: "Hottest" })
        },
        120000
      );
      return { ok: true, items: indexList(j?.data?.items), page };
    }

    case "details": {
      const pathStr = String(query.get("path") || "");
      const title = String(query.get("title") || "");
      const { subjectId, detailPath } = await resolveSubjectIdentity({
        pathStr,
        subjectId: query.get("subjectId") || "",
        detailPath: query.get("detailPath") || "",
        title
      });
      if (!subjectId && !detailPath) {
        return { ok: false, error: "Missing subjectId or detailPath for details lookup." };
      }
      const qs = new URLSearchParams();
      if (detailPath) qs.set("detailPath", detailPath);
      if (subjectId) qs.set("subjectId", subjectId);

      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/detail?${qs.toString()}`, {}, 300000);
      if (j?.code !== 0 || !j?.data?.subject) {
        return { ok: false, error: j?.message || "Title details unavailable." };
      }
      const subj = normalizeSubject(j.data.subject);
      const seasons = Array.isArray(j.data.resource?.seasons) ? j.data.resource.seasons : [];
      const episodes = [];
      const isMovie = subj.subjectType === 1 || (!seasons.length || (seasons.length === 1 && Number(seasons[0].se) === 0));

      if (isMovie) {
        episodes.push({
          label: `${subj.title} (${subj.quality})`,
          number: 1,
          seasonNumber: 0,
          episodeNumber: 1,
          se: 0,
          ep: 0,
          thumbnail: subj.poster,
          kind: "Feature Film",
          sources: []
        });
      } else {
        for (const season of seasons) {
          const se = Number(season.se || 1);
          const maxEp = Math.max(1, Math.min(200, Number(season.maxEp || 1)));
          for (let ep = 1; ep <= maxEp; ep++) {
            episodes.push({
              label: `S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")}`,
              number: ep,
              seasonNumber: se,
              episodeNumber: ep,
              se,
              ep,
              seasonName: `Season ${se}`,
              thumbnail: subj.poster,
              kind: `Season ${se} · Episode ${ep}`,
              sources: []
            });
          }
        }
      }

      const stars = (Array.isArray(j.data.stars) ? j.data.stars : []).map(st => ({
        staffId: String(st.staffId || ""),
        name: st.name || "",
        role: st.character || "",
        avatarUrl: st.avatarUrl || "",
        detailPath: st.detailPath || ""
      }));

      const rawDubs = Array.isArray(j.data.dubs)
        ? j.data.dubs
        : Array.isArray(j.data.subject?.dubs)
          ? j.data.subject.dubs
          : [];
      const dubs = rawDubs.map(d => ({
        subjectId: String(d.subjectId || ""),
        detailPath: String(d.detailPath || ""),
        path: d.subjectId ? `/mb/${d.subjectId}/${d.detailPath || d.subjectId}` : "",
        language: d.lanName || d.lanCode || "Audio",
        lanName: d.lanName || "",
        lanCode: d.lanCode || "",
        original: Boolean(d.original),
        type: Number(d.type ?? 0)
      }));

      return {
        ok: true,
        detail: {
          ...subj,
          dubs,
          staff: stars,
          episodes,
          totalEpisodes: episodes.length,
          postList: j.data.postList || [],
          metadata: j.data.metadata || {}
        }
      };
    }

    case "stream": {
      let { subjectId, detailPath } = await resolveSubjectIdentity({
        pathStr: query.get("path") || "",
        subjectId: query.get("subjectId") || "",
        detailPath: query.get("detailPath") || "",
        title: query.get("title") || ""
      });
      if (!subjectId) {
        return { ok: false, error: "subjectId is required to fetch stream sources." };
      }
      if (!detailPath || detailPath === subjectId) {
        try {
          const detJson = await mbFetch(
            `${MOVIEBOX_API}/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(subjectId)}`,
            {},
            300000
          );
          if (detJson?.data?.subject?.detailPath) {
            detailPath = String(detJson.data.subject.detailPath).trim();
            normalizeSubject(detJson.data.subject);
          }
        } catch {}
      }
      const se = Math.max(0, Number(query.get("se") ?? 0));
      let ep = Math.max(0, Number(query.get("ep") ?? 0));
      const referer = `${MOVIEBOX_PLAYER_REFERER}movies/${detailPath || subjectId}?id=${subjectId}`;

      const fetchPlay = async (sNum, eNum) => {
        const u = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&se=${sNum}&ep=${eNum}&detailPath=${encodeURIComponent(detailPath)}&streamSignType=1`;
        return await mbFetch(u, { headers: { Referer: referer } }, 0);
      };

      let playJson = await fetchPlay(se, ep);
      let rawStreams = Array.isArray(playJson?.data?.streams) ? playJson.data.streams : [];

      // Movies use se=0&ep=0 on MovieBox even when UI sends ep=1
      if (!rawStreams.length && se === 0 && ep !== 0) {
        playJson = await fetchPlay(0, 0);
        rawStreams = Array.isArray(playJson?.data?.streams) ? playJson.data.streams : [];
        if (rawStreams.length) ep = 0;
      }

      const sources = rawStreams
        .filter(s => s?.url)
        .map(s => {
          const res = String(s.resolutions || "720").match(/\d+/)?.[0] || "720";
          const token = signMediaToken(s.url);
          const isHls = /\.m3u8(?:$|[?#])/i.test(String(s.url)) || /hls|m3u8/i.test(String(s.format || ""));
          return {
            id: String(s.id || ""),
            url: isHls
              ? `/api/sports-hls/stream.m3u8?t=${encodeURIComponent(token)}`
              : `/api/cinepulse-media?mb=${encodeURIComponent(token)}&res=${res}`,
            quality: `${res}p`,
            resolution: `${res}p`,
            size: s.size || "",
            format: isHls ? "HLS" : (s.format || "MP4"),
            type: isHls ? "application/vnd.apple.mpegurl" : "video/mp4",
            provider: "MovieBox Direct",
            audioLanguage: ""
          };
        })
        .sort((a, b) => Number.parseInt(b.quality, 10) - Number.parseInt(a.quality, 10));

      let subtitles = [];
      const firstStreamId = rawStreams[0]?.id;
      if (firstStreamId) {
        try {
          const capUrl = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${encodeURIComponent(firstStreamId)}&subjectId=${encodeURIComponent(subjectId)}&detailPath=${encodeURIComponent(detailPath)}`;
          const capJson = await mbFetch(capUrl, { headers: { Referer: referer } }, 60000);
          const caps = Array.isArray(capJson?.data?.captions) ? capJson.data.captions : [];
          subtitles = caps
            .filter(c => c?.url)
            .map((c, idx) => ({
              id: String(c.id || idx),
              url: `/api/moviebox-subtitle/sub-${idx}.srt?t=${encodeURIComponent(signMediaToken(c.url))}`,
              label: c.lanName || c.lan || `Subtitle ${idx + 1}`,
              language: c.lan || "und",
              delay: Number(c.delay || 0)
            }));
        } catch {
          subtitles = [];
        }
      }

      return {
        ok: true,
        stream: {
          sources,
          subtitles,
          hasResource: Boolean(playJson?.data?.hasResource ?? sources.length > 0),
          vipLocked: Boolean(playJson?.data?.vipLocked)
        },
        sources,
        subtitles
      };
    }

    case "captions": {
      const subjectId = String(query.get("subjectId") || "");
      const detailPath = String(query.get("detailPath") || "");
      const streamId = String(query.get("id") || query.get("streamId") || "");
      if (!streamId || !subjectId) return { ok: true, captions: [] };
      const capUrl = `${MOVIEBOX_API}/wefeed-h5api-bff/subject/caption?format=MP4&id=${encodeURIComponent(streamId)}&subjectId=${encodeURIComponent(subjectId)}&detailPath=${encodeURIComponent(detailPath)}`;
      const j = await mbFetch(capUrl, {}, 60000);
      const captions = (Array.isArray(j?.data?.captions) ? j.data.captions : []).map((c, idx) => ({
        id: String(c.id || idx),
        lan: c.lan || "und",
        lanName: c.lanName || c.lan || "Subtitle",
        url: `/api/moviebox-subtitle/sub-${idx}.srt?t=${encodeURIComponent(signMediaToken(c.url))}`,
        delay: Number(c.delay || 0)
      }));
      return { ok: true, captions };
    }

    case "related": {
      const { subjectId } = await resolveSubjectIdentity({
        subjectId: query.get("subjectId") || "",
        title: query.get("title") || ""
      });
      if (!subjectId) return { ok: true, items: [] };
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/subject/detail-rec?subjectId=${encodeURIComponent(subjectId)}&page=1&perPage=18`,
        {},
        300000
      );
      return { ok: true, items: indexList(j?.data?.items) };
    }

    case "comments": {
      const subjectId = String(query.get("subjectId") || "");
      const page = Math.max(0, Number(query.get("page") || 1) - 1);
      if (!subjectId) return { ok: true, comments: [] };
      const j = await mbFetch(
        `${MOVIEBOX_API}/wefeed-h5api-bff/post/list/subject?id=${encodeURIComponent(subjectId)}&page=${page}&perPage=20`,
        {},
        60000
      );
      const list = Array.isArray(j?.data?.postList) ? j.data.postList : [];
      const comments = list.map(p => ({
        userName: p.user?.nickname || p.user?.name || p.author?.nickname || "Viewer",
        content: p.content || p.title || "",
        createdAt: p.createdAt || p.createTime || ""
      })).filter(c => c.content);
      return { ok: true, comments, pager: j?.data?.pager || {} };
    }

    case "staff": {
      const staffId = String(query.get("staffId") || "");
      const page = Math.max(1, Number(query.get("page") || 1));
      if (!staffId) return { ok: true, staff: {} };
      const [infoRes, listRes] = await Promise.allSettled([
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/staff/staff-related?staffId=${encodeURIComponent(staffId)}`, {}, 300000),
        mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/staff/subject-list?perPage=24&page=${page}&staffId=${encodeURIComponent(staffId)}`, {}, 300000)
      ]);
      const relatedItems = infoRes.status === "fulfilled" ? infoRes.value?.data?.items || [] : [];
      const person = relatedItems.find(x => String(x.staffId) === staffId) || relatedItems[0] || {};
      const works = listRes.status === "fulfilled" ? indexList(listRes.value?.data?.subjectList || listRes.value?.data?.items) : [];
      return {
        ok: true,
        staff: {
          staffId,
          name: person.name || "Cast & Crew",
          biography: person.description || (works.length ? `Featured in: ${works.slice(0, 6).map(w => w.title).join(", ")}` : "No additional biography available."),
          avatarUrl: person.avatarUrl || "",
          works
        }
      };
    }

    case "sports":
    case "sports/matches": {
      const j = await mbFetch(`${MOVIEBOX_SPORT_API}/wefeed-h5api-bff/live/match-list-v5`, {}, 30000);
      const list = Array.isArray(j?.data?.list) ? j.data.list : [];
      const rank = s => (s === "MatchIng" ? 0 : s === "MatchNotStart" ? 1 : 2);
      const sorted = [...list].sort((a, b) => rank(a.status) - rank(b.status));
      const channels = sorted.map(m => {
        const t1 = m.team1?.name || "Team A";
        const t2 = m.team2?.name || "Team B";
        const s1 = m.team1?.score ?? "";
        const s2 = m.team2?.score ?? "";
        const scoreText = s1 !== "" && s2 !== "" ? ` (${s1} - ${s2})` : "";
        const isLive = m.status === "MatchIng";
        const rawUrl = m.playPath || "";
        const proxiedUrl = rawUrl
          ? `/api/sports-hls/playlist.m3u8?t=${encodeURIComponent(signMediaToken(rawUrl))}`
          : "";
        return {
          id: String(m.id || ""),
          name: `${t1} vs ${t2}${scoreText}`,
          title: `${t1} vs ${t2}${scoreText}`,
          logo: m.team1?.avatar || m.team2?.avatar || "",
          team1Logo: m.team1?.avatar || "",
          team2Logo: m.team2?.avatar || "",
          streamUrl: proxiedUrl,
          playUrl: proxiedUrl,
          url: proxiedUrl,
          category: m.team1?.type || "Football",
          league: isLive
            ? `LIVE · ${m.timeDesc || m.league || "Match in progress"}`
            : m.status === "MatchNotStart"
              ? `Upcoming · ${m.timeDesc || "Scheduled"}`
              : `Ended · ${m.timeDesc || "Full Time"}`,
          quality: isLive ? "LIVE HD" : m.status === "MatchNotStart" ? "SOON" : "ENDED",
          status: m.status || "",
          live: isLive
        };
      });
      return { ok: true, channels, hasMore: Boolean(j?.data?.hasMore) };
    }

    case "sports/leagues": {
      const j = await mbFetch(`${MOVIEBOX_SPORT_API}/wefeed-h5api-bff/live/league-tab`, {}, 120000);
      return { ok: true, leagues: j?.data || [] };
    }

    case "bottom-tabs": {
      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/tab/get-bottom-tab-list`, {}, 600000);
      return { ok: true, bottomTabs: j?.data?.bottomTabs || [] };
    }

    case "app-info": {
      const j = await mbFetch(`${MOVIEBOX_API}/wefeed-h5api-bff/app/get-latest-app-pkgs?appName=moviebox`, {}, 600000);
      return { ok: true, packages: j?.data || [] };
    }

    case "me":
      return {
        ok: true,
        account: {
          name: "MovieBox Direct Upstream",
          plan: "Live Main API (h5-api.aoneroom.com)",
          status: "Connected",
          cachedTitles: subjectIndex.size
        }
      };

    case "status":
      return { ok: true, status: "connected", upstream: MOVIEBOX_API, cachedTitles: subjectIndex.size };

    case "updates-24h":
      return await handleMovieBoxRoute("trending", query);

    default:
      return { ok: false, error: `Unknown MovieBox API endpoint: ${legacy}` };
  }
}
