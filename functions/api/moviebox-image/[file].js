import {
  MOVIEBOX_REFERER,
  MOVIEBOX_UA,
  configureMediaSecret,
  verifyMediaToken
} from "../../../moviebox-api.js";
import { getActiveMlbdReferer } from "../../../movielinkbd-api.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const incoming = new URL(request.url);
  const targetUrl = verifyMediaToken(incoming.searchParams.get("t"));
  if (!targetUrl) {
    return new Response("Invalid or missing image token", { status: 400 });
  }

  const referer = /aisports/i.test(targetUrl)
    ? "https://aisports.mobi/"
    : /movielink/i.test(targetUrl)
      ? getActiveMlbdReferer()
      : MOVIEBOX_REFERER;

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "User-Agent": MOVIEBOX_UA,
        Referer: referer,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });
    if (!upstream.ok) {
      return new Response("Image unavailable", { status: upstream.status });
    }
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return new Response("Image upstream unavailable", { status: 502 });
  }
}
