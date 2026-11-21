import { upstream, rootData, response } from "../../_shared/moviebox.js";

function safeMediaUrl(value) {
  try { const u = new URL(String(value || "")); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; }
  catch { return ""; }
}
function score(item) {
  const value = item?.resolution ?? item?.quality ?? item?.resolutions?.[0] ?? "";
  return Number(String(typeof value === "object" ? value?.name || value?.label || value?.value : value).match(/\d{3,4}/)?.[0] || 0);
}
function safeFilename(value) {
  return String(value || "CineVerse-Download").replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 100);
}
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const subjectId = String(u.searchParams.get("subjectId") || "").trim().slice(0, 100);
  const detailPath = String(u.searchParams.get("detailPath") || "").trim().replace(/^\\/+|\\/+$/g, "").slice(0, 360);
  const se = Number(u.searchParams.get("se") ?? 0), ep = Number(u.searchParams.get("ep") ?? 0);
  const requested = String(u.searchParams.get("quality") || "best").trim().slice(0, 12).toLowerCase();
  if (!subjectId || !detailPath || !Number.isInteger(se) || !Number.isInteger(ep) || se < 0 || ep < 0 || se > 300 || ep > 1000) {
    return response({ ok: false, error: "Valid subjectId, detailPath, season and episode are required." }, 400);
  }
  const query = new URLSearchParams({ subjectId, se: String(se), ep: String(ep), detailPath, streamSignType: "1" });
  try {
    const raw = await upstream("/wefeed-h5api-bff/subject/play?" + query.toString(), {
      method: "GET", referer: "https://movie-box.co/", timeout: 25000
    });
    const root = rootData(raw) || {};
    const streams = (Array.isArray(root.streams) ? root.streams : Array.isArray(root.data?.streams) ? root.data.streams : [])
      .map(s => ({ ...s, safeUrl: safeMediaUrl(s?.url || s?.playUrl || s?.play_url) }))
      .filter(s => s.safeUrl && !/m3u8|hls/i.test(String(s.format || s.type || "")) && !/\.m3u8(?:$|[?#])/i.test(s.safeUrl));
    if (!streams.length) return response({ ok: false, error: "No direct downloadable MP4 source was returned for this episode." }, 404);
    const wanted = Number(requested.match(/\d{3,4}/)?.[0] || 0);
    streams.sort((a, b) => wanted ? Math.abs(score(a)-wanted)-Math.abs(score(b)-wanted) : score(b)-score(a));
    const chosen = streams[0];
    const headers = new Headers({ "Referer": "https://movie-box.co/", "Accept": "video/mp4,application/octet-stream,*/*" });
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    const media = await fetch(chosen.safeUrl, { method: "GET", headers, redirect: "follow", signal: AbortSignal.timeout(60000) });
    if (!media.ok && media.status !== 206) {
      return response({ ok: false, error: "The selected download source returned HTTP " + media.status + "." }, 502);
    }
    const out = new Headers({
      "Content-Type": media.headers.get("Content-Type") || "video/mp4",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": media.headers.get("Accept-Ranges") || "bytes",
      "Content-Disposition": 'attachment; filename="' + safeFilename(u.searchParams.get("filename")) + '.mp4"'
    });
    for (const key of ["Content-Length", "Content-Range"]) {
      const value = media.headers.get(key); if (value) out.set(key, value);
    }
    return new Response(media.body, { status: media.status, headers: out });
  } catch (error) {
    return response({ ok: false, error: String(error?.message || "Download source unavailable.").slice(0, 240) }, 502);
  }
}
