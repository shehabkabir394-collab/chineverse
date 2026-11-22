const ALLOWED_HOSTS = new Set(["chineverse.pages.dev", "chineverse4k.pages.dev"]);
const ALLOWED_ORIGINS = new Set(["https://chineverse.pages.dev"]);

function blocked(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin"
    }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Apply origin and host protections to MovieBox and CinePulse proxy APIs; leave other routes untouched.
  if (!url.pathname.startsWith("/api/movie-api/") && !url.pathname.startsWith("/api/cinepulse/")) {
    return context.next();
  }

  const isAllowedHostname = (hostname) => {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_HOSTS.has(host) || /^[a-z0-9-]+\.chineverse4k\.pages\.dev$/.test(host);
  };
  if (!isAllowedHostname(url.hostname)) {
    return blocked(403, "API host is not allowed.");
  }

  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  // Reject requests explicitly identified by the browser as cross-site.
  // "none" is normal for a URL opened directly in the address bar.
  if (fetchSite === "cross-site") {
    return blocked(403, "Cross-site API requests are not allowed.");
  }

  // If a browser sends Origin, it must be the production CineVerse origin.
  let originAllowed = !origin;
  if (origin) {
    try { originAllowed = ALLOWED_ORIGINS.has(origin) || isAllowedHostname(new URL(origin).hostname); }
    catch { originAllowed = false; }
  }
  if (!originAllowed) {
    return blocked(403, "This origin is not allowed to use the API.");
  }

  // Requests without Origin (direct navigation, curl, or same-origin
  // browser requests that omit it) are allowed. The MovieBox key remains
  // server-side and is never returned to the caller.

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
