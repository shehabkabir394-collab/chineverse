import { buildPosterSvg } from "../../../mock-catalog.js";

export async function onRequest({ params }) {
  const id = String(params.file || "").replace(/\.svg$/i, "");
  return new Response(buildPosterSvg(id), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
