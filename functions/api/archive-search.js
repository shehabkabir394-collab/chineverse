// Cloudflare Pages Function: read-only Internet Archive movie search.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (raw.length < 2 || raw.length > 120) {
    return Response.json({ error: "Search text must be between 2 and 120 characters." }, { status: 400 });
  }

  // Search titles only; never fetch or proxy video bytes.
  const safeTitle = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const params = new URLSearchParams();
  params.set("q", 'mediatype:movies AND title:"' + safeTitle + '"');
  ["identifier", "title", "year", "date", "description", "licenseurl", "rights", "downloads"].forEach((field) => params.append("fl[]", field));
  params.set("rows", "20");
  params.set("output", "json");
  params.append("sort[]", "downloads desc");

  try {
    const response = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
      headers: { "Accept": "application/json", "User-Agent": "CineVerse4K-ArchiveSearch/1.0" }
    });
    if (!response.ok) return Response.json({ error: "Internet Archive search returned HTTP " + response.status }, { status: 502 });
    const payload = await response.json();
    const docs = payload?.response?.docs || [];
    return Response.json({
      total: payload?.response?.numFound || 0,
      results: docs.map((item) => ({
        identifier: item.identifier,
        title: item.title || item.identifier,
        year: item.year || item.date || "",
        description: item.description || "",
        licenseurl: item.licenseurl || "",
        rights: item.rights || "",
        downloads: item.downloads || 0,
        details_url: "https://archive.org/details/" + encodeURIComponent(item.identifier),
        embed_url: "https://archive.org/embed/" + encodeURIComponent(item.identifier)
      }))
    }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    return Response.json({ error: "Could not reach Internet Archive: " + (error?.message || "network error") }, { status: 502 });
  }
}
