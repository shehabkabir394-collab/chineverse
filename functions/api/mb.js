import { upstream, response } from "../_shared/moviebox.js";

const MAIN = "https://h5-api.aoneroom.com";
const SPORT = "https://h5-sport-api.aoneroom.com";
const ALLOWED = [
  "/wefeed-h5api-bff/home",
  "/wefeed-h5api-bff/subject/search",
  "/wefeed-h5api-bff/subject/search-suggest",
  "/wefeed-h5api-bff/subject/everyone-search",
  "/wefeed-h5api-bff/subject/trending",
  "/wefeed-h5api-bff/ranking-list/content",
  "/wefeed-h5api-bff/subject/filter",
  "/wefeed-h5api-bff/filter",
  "/wefeed-h5api-bff/platform/play-list",
  "/wefeed-h5api-bff/detail",
  "/wefeed-h5api-bff/subject/detail-rec",
  "/wefeed-h5api-bff/post/list/subject",
  "/wefeed-h5api-bff/staff/subject-list",
  "/wefeed-h5api-bff/staff/staff-related",
  "/wefeed-h5api-bff/upcoming-subject-list",
  "/wefeed-h5api-bff/tab/get-bottom-tab-list",
  "/wefeed-h5api-bff/live/match-list-v5",
  "/wefeed-h5api-bff/live/league-tab",
  "/wefeed-h5api-bff/app/get-latest-app-pkgs"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function send(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS }
  });
}

function allowedEndpoint(value) {
  if (!value || value.length > 700 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\\\") || value.includes("..")) return false;
  const path = value.split("?")[0];
  return ALLOWED.some(item => path === item);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest({ request }) {
  if (request.method !== "GET" && request.method !== "POST") {
    return send({ ok: false, error: "Method not allowed." }, 405);
  }

  const url = new URL(request.url);
  const endpoint = url.searchParams.get("ep") || "";
  if (!allowedEndpoint(endpoint)) {
    return send({ ok: false, error: "This MovieBox endpoint is not allowed." }, 400);
  }

  let body;
  if (request.method === "POST") {
    const type = request.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("application/json")) {
      return send({ ok: false, error: "POST requests must use application/json." }, 415);
    }
    try {
      const raw = await request.text();
      if (raw.length > 64 * 1024) return send({ ok: false, error: "Request body is too large." }, 413);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send({ ok: false, error: "Invalid JSON request body." }, 400);
    }
  }

  try {
    const host = endpoint.startsWith("/wefeed-h5api-bff/live/") ? SPORT : MAIN;
    const result = await upstream(endpoint, { method: request.method, body, host, timeout: 18000 });
    return send({ ok: true, data: result });
  } catch (error) {
    return send({ ok: false, error: String(error?.message || "MovieBox upstream unavailable.").slice(0, 240) }, 502);
  }
}
