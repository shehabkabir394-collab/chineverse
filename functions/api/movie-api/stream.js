import { upstream, rootData, response } from "../../_shared/moviebox.js";

const safeText = (v, max = 300) => String(v ?? "").trim().slice(0, max);
function safeMediaUrl(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol !== "https:" || u.username || u.password) return "";
    return u.href;
  } catch { return ""; }
}
function qualityOf(item) {
  const raw = item?.resolution ?? item?.quality ?? item?.resolutions?.[0] ?? item?.label ?? "";
  if (typeof raw === "object") return safeText(raw?.name || raw?.label || raw?.resolution || raw?.value);
  return safeText(raw || item?.format || "Auto");
}
function findEmbed(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return "";
  if (Array.isArray(value)) { for (const x of value) { const found = findEmbed(x, depth + 1); if (found) return found; } return ""; }
  for (const k of ["embedPlayerUrl","embed_player_url","embedUrl","embed_url","playerUrl","player_url"]) {
    const u = safeMediaUrl(value[k]); if (u) return u;
  }
  for (const v of Object.values(value)) if (v && typeof v === "object") { const found = findEmbed(v, depth + 1); if (found) return found; }
  return "";
}
export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const subjectId = safeText(u.searchParams.get("subjectId"), 100);
  const detailPath = safeText(u.searchParams.get("detailPath"), 360).replace(/^\/+|\/+$/g, "");
  const seRaw = u.searchParams.get("se"), epRaw = u.searchParams.get("ep");
  const se = seRaw === null ? 0 : Number(seRaw), ep = epRaw === null ? 0 : Number(epRaw);
  if (!subjectId || !detailPath || !Number.isInteger(se) || !Number.isInteger(ep) || se < 0 || ep < 0 || se > 300 || ep > 1000) {
    return response({ ok: false, error: "Valid subjectId, detailPath, season (se) and episode (ep) are required." }, 400);
  }
  const query = new URLSearchParams({ subjectId, se: String(se), ep: String(ep), detailPath, streamSignType: "1" });
  try {
    // MovieBox documents this as GET. Playback uses the provider's web Referer.
    const raw = await upstream("/wefeed-h5api-bff/subject/play?" + query.toString(), {
      method: "GET", referer: "https://movie-box.co/", timeout: 25000
    });
    const root = rootData(raw) || {};
    const streams = Array.isArray(root.streams) ? root.streams : Array.isArray(root.data?.streams) ? root.data.streams : [];
    const sources = streams.map((s, i) => {
      const url = safeMediaUrl(s?.url || s?.playUrl || s?.play_url);
      if (!url) return null;
      const q = qualityOf(s);
      return {
        id: safeText(s.id || s.streamId || s.stream_id || String(i), 120),
        url, quality: q, resolution: q,
        size: s.size ?? null, type: safeText(s.format || s.type || "mp4", 30),
        provider: safeText(s.provider || "MovieBox", 80),
        audioLanguage: safeText(s.audioLanguage || s.language || s.lang || "", 60)
      };
    }).filter(Boolean);
    const embedPlayerUrl = findEmbed(raw);
    if (!sources.length && !embedPlayerUrl) {
      return response({ ok: false, error: "The upstream play API returned no usable stream URLs.", upstreamCode: root.code ?? null }, 502);
    }
    return response({ ok: true, subjectId, detailPath, se, ep, sources, streams: sources, embedPlayerUrl,
      captions: Array.isArray(root.captions) ? root.captions : [] }, 200, "private, no-store");
  } catch (error) {
    return response({ ok: false, error: safeText(error?.message || "Playback source unavailable.", 240) }, 502);
  }
}
