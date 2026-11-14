const PLATFORMS = new Set([
  "shortmax","blinkdrama","vibeshort","storyreel","dramarush","dramawave","dramabox",
  "netshort","flextv","flickreels","reelshort","stardusttv","dramabite","starshort",
  "microdrama","melolo","shortwave","cubetv","pinedrama","raptdrama","goodshort","joyreels","vigloo"
]);

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!env.APISHORT_API_KEY) return json({ error: "APIShort key is not configured. Add APISHORT_API_KEY as a Cloudflare Pages secret." }, 503);

  const parts = url.pathname.replace(/^\/api\/apishort\/?/, "").split("/").filter(Boolean);
  const platform = (parts.shift() || "").toLowerCase();
  const endpoint = parts.join("/");
  if (!PLATFORMS.has(platform) || !endpoint || endpoint.length > 220 ||
      endpoint.split("/").some(p => p === "." || p === "..") ||
      !/^[a-zA-Z0-9_./-]+$/.test(endpoint)) {
    return json({ error: "Unsupported platform or endpoint." }, 400);
  }

  const upstream = new URL("https://apishort.com/v1/" + platform + "/" + endpoint);
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === "api_key" || key.toLowerCase() === "x-api-key") continue;
    upstream.searchParams.append(key, value);
  }

  try {
    const response = await fetch(upstream.toString(), {
      method: "GET",
      headers: { "X-API-Key": env.APISHORT_API_KEY, "Accept": "application/json" }
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return json({ error: "APIShort upstream request failed. Please try again later." }, 502);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
