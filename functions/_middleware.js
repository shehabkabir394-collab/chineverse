const ALLOWED_HOSTS = new Set(["chineverse.pages.dev"]);
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

  // Apply only to the MovieBox proxy API; leave pages and other APIs untouched.
  if (!url.pathname.startsWith("/api/movie-api/")) {
    return context.next();
  }

  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
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
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
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
