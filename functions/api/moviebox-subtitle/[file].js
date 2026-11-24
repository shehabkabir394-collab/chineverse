import {
  MOVIEBOX_PLAYER_REFERER,
  MOVIEBOX_UA,
  configureMediaSecret,
  convertSrtToVtt,
  verifyMediaToken
} from "../../../moviebox-api.js";
import { getActiveMlbdReferer } from "../../../movielinkbd-api.js";

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const incoming = new URL(request.url);
  const targetUrl = verifyMediaToken(incoming.searchParams.get("t"));
  if (!targetUrl) {
    return new Response("Invalid or missing subtitle token", { status: 400 });
  }

  const referer = /movielink/i.test(targetUrl) ? getActiveMlbdReferer() : MOVIEBOX_PLAYER_REFERER;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: referer
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      return new Response("Subtitle unavailable", { status: upstream.status });
    }
    const rawText = await upstream.text();
    const file = String(params.file || "");
    const wantVtt = incoming.searchParams.get("vtt") === "1" || /\.vtt$/i.test(file);
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": wantVtt ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8"
    });
    return new Response(wantVtt ? convertSrtToVtt(rawText) : rawText, {
      status: 200,
      headers
    });
  } catch {
    return new Response("Subtitle upstream unavailable", { status: 502 });
  }
}
