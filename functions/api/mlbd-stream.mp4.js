import { MOVIEBOX_UA, configureMediaSecret } from "../../moviebox-api.js";
import { getActiveMlbdReferer, resolveSafeMlbdToken } from "../../movielinkbd-api.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    });
  }
  configureMediaSecret(env?.MEDIA_PROXY_SECRET);
  const url = new URL(request.url);
  const token = String(url.searchParams.get("t") || "").trim();
  const targetUrl = resolveSafeMlbdToken(token);
  if (!targetUrl) {
    return new Response("Invalid or expired MovieLinkBD media token", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  const reqHeaders = new Headers({
    "User-Agent": MOVIEBOX_UA,
    Accept: request.headers.get("accept") || "*/*",
    Referer: getActiveMlbdReferer()
  });
  const range = request.headers.get("range");
  if (range) reqHeaders.set("Range", range);
  const ifRange = request.headers.get("if-range");
  if (ifRange) reqHeaders.set("If-Range", ifRange);

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: reqHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(45000)
    });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Media upstream unavailable", { status: upstream.status });
    }

    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = upstream.headers.get(name);
      if (v) headers.set(name, v);
    }
    const rawCt = (upstream.headers.get("content-type") || "").toLowerCase();
    const isSub = /\/vsub\//i.test(targetUrl);
    if (!rawCt || rawCt.includes("octet-stream") || (rawCt.startsWith("image/") && /watch\.movielink\.tv/i.test(targetUrl))) {
      headers.set("content-type", isSub ? "text/vtt; charset=utf-8" : "video/mp4");
    }
    if (!headers.get("accept-ranges")) {
      headers.set("accept-ranges", "bytes");
    }
    const forceDownload = url.searchParams.get("download") === "1";
    const rawName = String(url.searchParams.get("filename") || "MovieStreamBD-Video.mp4")
      .replace(/["\\\r\n;]+/g, "")
      .trim() || "MovieStreamBD-Video.mp4";
    if (forceDownload) {
      headers.set("content-disposition", `attachment; filename="${rawName}"`);
      headers.set("cache-control", "private, no-store");
    } else {
      headers.set("cache-control", "no-store");
    }
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (err) {
    return new Response(err?.message || "MovieLinkBD stream proxy failed", { status: 502 });
  }
}
