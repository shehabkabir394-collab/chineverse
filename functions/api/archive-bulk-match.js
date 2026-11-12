const SUPABASE_URL = "https://bqvlkprluentrsovfpcy.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_7Kna5pXHrSnKiO_s8Wr3bA_T5AAj4me";
const TMDB_API = "https://api.themoviedb.org/3";
const MAX_PAGES = 2;
const MAX_MATCHES = 40;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function requireAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new Error("Administrator sign-in required.");
  const headers = { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization };
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", { headers, signal: AbortSignal.timeout(8000) });
  if (!userResponse.ok) throw new Error("Your admin session expired. Sign in again.");
  const user = await userResponse.json();
  if (!user?.id) throw new Error("Administrator sign-in required.");
  const adminResponse = await fetch(SUPABASE_URL + "/rest/v1/admin_users?user_id=eq." + encodeURIComponent(user.id) + "&select=user_id&limit=1", { headers, signal: AbortSignal.timeout(8000) });
  if (!adminResponse.ok) throw new Error("Could not verify administrator permission.");
  const admins = await adminResponse.json();
  if (!Array.isArray(admins) || admins.length !== 1) throw new Error("Only approved administrators can run bulk imports.");
}

function normTitle(value) {
  return String(value || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .normalize("NFKC").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function yearOf(value) {
  const match = String(value || "").match(/(?:18|19|20|21)\d{2}/);
  return match ? Number(match[0]) : null;
}
function allowedCommercialLicense(raw) {
  if (!raw) return false;
  let url;
  try { url = new URL(String(raw).replace(/^http:/i, "https:")); } catch { return false; }
  if (url.hostname !== "creativecommons.org") return false;
  const path = url.pathname.toLowerCase();
  if (path.includes("/licenses/by-nc") || path.includes("/licenses/by-nd") || path.includes("/licenses/by-nc-nd") || path.includes("/licenses/by-nc-sa")) return false;
  return path.includes("/publicdomain/zero/1.0") ||
    path.includes("/publicdomain/mark/1.0") ||
    path.includes("/licenses/publicdomain") ||
    /\/licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)/.test(path) ||
    /\/licenses\/by-sa\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)/.test(path);
}
function fileRank(file) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.split(".").pop();
  const preferred = { mp4: 5, webm: 4, m4v: 3, ogv: 2, ogg: 2, mkv: 1, mpg: 1, mpeg: 1 };
  return (preferred[ext] || 0) * 1e15 + Number(file.size || 0);
}
function videoFile(files) {
  return (files || [])
    .filter(file => {
      const name = String(file.name || "");
      const format = String(file.format || "").toLowerCase();
      return /\.(mp4|m4v|webm|ogv|ogg|mkv|mpg|mpeg)$/i.test(name) &&
        !/thumb|sample|preview|trailer|\.ia\./i.test(name) &&
        Number(file.size || 0) > 1024 * 1024 &&
        !/metadata|thumbnail|image/i.test(format);
    })
    .sort((a, b) => fileRank(b) - fileRank(a))[0] || null;
}

async function archiveCandidate(movie) {
  const title = String(movie.title || "").trim();
  const year = Number(movie.release_year);
  const safeTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const params = new URLSearchParams();
  params.set("q", 'mediatype:movies AND title:"' + safeTitle + '"');
  ["identifier", "title", "year", "date", "licenseurl", "rights"].forEach(field => params.append("fl[]", field));
  params.set("rows", "8");
  params.set("output", "json");
  const searchResponse = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
    headers: { Accept: "application/json", "User-Agent": "CineVerse4K-BulkImport/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!searchResponse.ok) return { movie, status: "search_error", reason: "Archive search HTTP " + searchResponse.status };
  const search = await searchResponse.json();
  const exact = (search?.response?.docs || []).filter(item =>
    normTitle(item.title) === normTitle(title) && yearOf(item.year || item.date) === year
  );
  if (exact.length !== 1) return {
    movie, status: exact.length > 1 ? "ambiguous" : "not_found",
    reason: exact.length > 1 ? "More than one exact title/year match; manual review needed." : "No exact title and release-year match."
  };
  const item = exact[0];
  const metaResponse = await fetch("https://archive.org/metadata/" + encodeURIComponent(item.identifier), {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000)
  });
  if (!metaResponse.ok) return { movie, status: "metadata_error", reason: "Could not read Archive item metadata." };
  const meta = await metaResponse.json();
  const actualTitle = meta?.metadata?.title || item.title;
  const actualYear = yearOf(meta?.metadata?.year || meta?.metadata?.date || item.year || item.date);
  if (normTitle(actualTitle) !== normTitle(title) || actualYear !== year) {
    return { movie, status: "mismatch", reason: "Item metadata does not exactly match the movie title and year." };
  }
  const license = meta?.metadata?.licenseurl || item.licenseurl || "";
  if (!allowedCommercialLicense(license)) {
    return { movie, status: "rights_review", reason: "No clearly reusable commercial license was identified. Not imported.", archive_title: actualTitle, archive_url: "https://archive.org/details/" + encodeURIComponent(item.identifier), license };
  }
  const file = videoFile(meta.files);
  if (!file) return { movie, status: "no_video_file", reason: "No supported full video file was found in this Archive item.", archive_url: "https://archive.org/details/" + encodeURIComponent(item.identifier), license };
  const encodedName = String(file.name).split("/").map(encodeURIComponent).join("/");
  return {
    movie, status: "candidate", archive_identifier: item.identifier, archive_title: actualTitle,
    archive_url: "https://archive.org/details/" + encodeURIComponent(item.identifier),
    watch_url: "https://archive.org/embed/" + encodeURIComponent(item.identifier),
    download_url: "https://archive.org/download/" + encodeURIComponent(item.identifier) + "/" + encodedName,
    file_name: file.name, file_size: Number(file.size || 0), file_format: file.format || "",
    license: String(license).replace(/^http:/i, "https:")
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await fn(items[index]); }
      catch (error) { results[index] = { movie: items[index], status: "error", reason: error?.message || "Source lookup failed." }; }
    }
  }));
  return results;
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const category = body?.category;
    const pages = Number(body?.pages);
    if (!["popular", "now_playing", "upcoming", "top_rated"].includes(category)) return json({ error: "Choose a supported TMDB movie list." }, 400);
    if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) return json({ error: "Bulk scan is limited to 1–2 pages (up to 40 movies) per batch." }, 400);
    const token = env.TMDB_API_READ_ACCESS_TOKEN;
    if (!token) return json({ error: "TMDB service is not configured in Cloudflare Pages." }, 503);
    const headers = { Authorization: "Bearer " + token, accept: "application/json" };
    const responses = await Promise.all(Array.from({ length: pages }, (_, i) =>
      fetch(TMDB_API + "/movie/" + category + "?include_adult=false&language=en-US&page=" + (i + 1), { headers, signal: AbortSignal.timeout(10000) })
    ));
    const failed = responses.find(response => !response.ok);
    if (failed) return json({ error: "TMDB returned HTTP " + failed.status }, 502);
    const bodies = await Promise.all(responses.map(response => response.json()));
    const movies = bodies.flatMap(page => page.results || []).filter(movie => movie && movie.adult !== true && movie.title).map(movie => ({
      tmdb_id: Number(movie.id), title: String(movie.title).slice(0, 180),
      release_year: yearOf(movie.release_date), description: String(movie.overview || "").slice(0, 5000),
      poster_url: movie.poster_path ? "https://image.tmdb.org/t/p/w500" + movie.poster_path : null,
      backdrop_url: movie.backdrop_path ? "https://image.tmdb.org/t/p/w1280" + movie.backdrop_path : null,
      rating: Number.isFinite(Number(movie.vote_average)) ? Math.round(Number(movie.vote_average) * 10) / 10 : null,
      language: String(movie.original_language || "").toUpperCase(), media_type: "movie"
    }));
    const results = await mapLimit(movies.slice(0, MAX_MATCHES), 6, archiveCandidate);
    const counts = results.reduce((out, item) => { out[item.status] = (out[item.status] || 0) + 1; return out; }, {});
    return json({ category, pages, total: results.length, counts, results });
  } catch (error) {
    return json({ error: error?.name === "TimeoutError" ? "Bulk search timed out. Try one page at a time." : (error?.message || "Bulk import failed.") }, 400);
  }
}
