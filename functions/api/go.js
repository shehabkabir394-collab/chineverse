import { configureMediaSecret } from "../../moviebox-api.js";
import { resolveSafeMlbdToken } from "../../movielinkbd-api.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  const url = new URL(request.url);
  const token = String(url.searchParams.get("t") || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return new Response("Invalid or expired download redirect token", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: targetUrl,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    }
  });
}
