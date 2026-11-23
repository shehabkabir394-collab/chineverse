import {
  MOVIEBOX_UA,
  configureMediaSecret,
  signMediaToken,
  verifyMediaToken
} from "../../../moviebox-api.js";

export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  configureMediaSecret(env?.MEDIA_PROXY_SECRET);

  const incoming = new URL(request.url);
  const targetUrl = verifyMediaToken(incoming.searchParams.get("t"));
  if (!targetUrl) {
    return new Response("Invalid or missing sports stream token", { status: 400 });
  }

  try {
    const reqHeaders = {
      "User-Agent": MOVIEBOX_UA,
      Referer: "https://aisports.mobi/",
      Accept: "*/*"
    };
    const range = request.headers.get("range");
    if (range) reqHeaders.Range = range;

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: reqHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Live sports stream unavailable", { status: upstream.status });
    }

    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const cl = Number(upstream.headers.get("content-length") || 0);
    const file = String(params.file || "");
    const maybePlaylist =
      ct.includes("mpegurl") ||
      ct.includes("text/plain") ||
      /\.m3u8(?:$|[?#])/i.test(targetUrl) ||
      file.endsWith(".m3u8") ||
      (cl > 0 && cl < 524288 && !ct.includes("mp2t") && !ct.includes("video/"));

    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    if (maybePlaylist) {
      const buf = await upstream.arrayBuffer();
      const raw = new TextDecoder().decode(buf);
      if (raw.trimStart().startsWith("#EXTM3U")) {
        let nextIsVariant = false;
        const rewritten = raw
          .split(/\r?\n/)
          .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith("#")) {
              if (/^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF)/i.test(trimmed)) {
                nextIsVariant = true;
              }
              return line.replace(/URI="([^"]+)"/gi, (_, uri) => {
                try {
                  const abs = new URL(uri, upstream.url || targetUrl).href;
                  const isSubM3u8 = /\.m3u8(?:$|[?#])/i.test(abs) || /#EXT-X-MEDIA/i.test(trimmed);
                  const ext = isSubM3u8 ? "sub.m3u8" : "key.bin";
                  return `URI="/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}"`;
                } catch {
                  return `URI="${uri}"`;
                }
              });
            }
            try {
              const abs = new URL(trimmed, upstream.url || targetUrl).href;
              const isSubM3u8 = nextIsVariant || /\.m3u8(?:$|[?#])/i.test(abs);
              nextIsVariant = false;
              const ext = isSubM3u8 ? "sub.m3u8" : "seg.ts";
              return `/api/sports-hls/${ext}?t=${encodeURIComponent(signMediaToken(abs))}`;
            } catch {
              nextIsVariant = false;
              return line;
            }
          })
          .join("\n");
        headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        return new Response(rewritten, { status: 200, headers });
      }
      headers.set("Content-Type", ct || "video/mp2t");
      return new Response(buf, { status: upstream.status, headers });
    }

    headers.set("Content-Type", ct || "video/mp2t");
    if (upstream.headers.get("content-range")) {
      headers.set("Content-Range", upstream.headers.get("content-range"));
    }
    if (upstream.headers.get("content-length")) {
      headers.set("Content-Length", upstream.headers.get("content-length"));
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    return new Response(error?.message || "Sports stream proxy error", { status: 502 });
  }
}
