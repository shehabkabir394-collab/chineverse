const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://chineverse.pages.dev/</loc></url>
  <url><loc>https://chineverse.pages.dev/privacy.html</loc></url>
</urlset>`;

export async function onRequestGet() {
  return new Response(SITEMAP, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
}
