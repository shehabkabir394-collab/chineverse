import { MOVIEBOX_UA, configureMediaSecret } from "../../moviebox-api.js";
import {
  getActiveMlbdReferer,
  resolveSafeMlbdToken,
  rewriteMlbdHlsPlaylist
} from "../../movielinkbd-api.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  const url = new URL(request.url);
  const token = String(url.searchParams.get("t") || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return new Response("Invalid or expired MovieStreamBD HLS token", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: getActiveMlbdReferer(),
        Accept: "*/*"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return new Response("HLS playlist unavailable", { status: upstream.status });
    }
    const rawText = await upstream.text();
    const rewritten = rewriteMlbdHlsPlaylist(rawText, upstream.url || targetUrl);
    return new Response(rewritten, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "public, max-age=180, s-maxage=600, stale-while-revalidate=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    return new Response(err?.message || "MovieStreamBD HLS proxy failed", { status: 502 });
  }
}
