import { upstream, rootData, response } from "../../_shared/moviebox.js";

function safeMediaUrl(value) {
  try { const u = new URL(String(value || "")); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; }
  catch { return ""; }
}
function score(item) {
  const value = item?.resolution ?? item?.quality ?? item?.resolutions?.[0] ?? "";
  const n = Number(String(typeof value === "object" ? value?.name || value?.label || value?.value : value).match(/\d{3,4}/)?.[0] || 0);
  return n;
}
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const subjectId = String(u.searchParams.get("subjectId") || "").trim().slice(0, 100);
  const detailPath = String(u.searchParams.get("detailPath") || "").trim().replace(/^\/+|\/+$/g, "").slice(0, 360);
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
    return new Response(null, { status: 302, headers: {
      "Location": chosen.safeUrl, "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin"
    }});
  } catch (error) {
    return response({ ok: false, error: String(error?.message || "Download source unavailable.").slice(0, 240) }, 502);
  }
}
