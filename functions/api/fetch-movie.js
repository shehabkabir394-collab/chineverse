const MAX_BYTES = 1_500_000;
const UA = "CineVerse4K-MetadataFetcher/1.0";
const SUPABASE_URL = "https://bqvlkprluentrsovfpcy.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_7Kna5pXHrSnKiO_s8Wr3bA_T5AAj4me";

async function requireAdmin(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new Error("Sign in as an approved administrator to fetch details.");
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization }, signal: AbortSignal.timeout(8000) });
  if (!userResponse.ok) throw new Error("Your admin session expired. Sign in again.");
  const user = await userResponse.json();
  if (!user?.id) throw new Error("Sign in as an approved administrator to fetch details.");
  const membershipResponse = await fetch(SUPABASE_URL + "/rest/v1/admin_users?user_id=eq." + encodeURIComponent(user.id) + "&select=user_id&limit=1", { headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization }, signal: AbortSignal.timeout(8000) });
  if (!membershipResponse.ok) throw new Error("Could not verify admin permission.");
  const rows = await membershipResponse.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Only approved administrators can fetch movie details.");
}

function badHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(":")) {
    if (h.includes(":")) return true; // disallow IPv6 literals
    const p = h.split(".").map(Number);
    if (p.some(n => n > 255)) return true;
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168);
  }
  return false;
}
function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid public webpage URL."); }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || badHost(u.hostname))
    throw new Error("Only public HTTPS webpages on the standard port are supported.");
  return u;
}
function decode(s) {
  return String(s || "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).trim();
}
function clean(v, max=5000) {
  if (typeof v === "object" && v) v = v.name || v["@id"] || v.url || "";
  return decode(String(v || "").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").slice(0,max);
}
function meta(html, names) {
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return decode(attrs.content);
  }
  return "";
}
function findMovie(node, depth=0) {
  if (!node || depth > 10) return null;
  if (Array.isArray(node)) { for (const item of node) { const found=findMovie(item,depth+1); if(found)return found; } return null; }
  if (typeof node !== "object") return null;
  const t = node["@type"];
  if ((Array.isArray(t) ? t : [t]).some(x => /movie|tvseries|creativework|videoobject/i.test(String(x||"")))) return node;
  if (node["@graph"]) return findMovie(node["@graph"],depth+1);
  return null;
}
function absolute(raw, base) {
  if (!raw) return "";
  try { const u = new URL(typeof raw === "object" ? (raw.url || raw["@id"] || "") : raw, base); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}
function firstText(...vals) { for (const v of vals) { const s=clean(v); if(s) return s; } return ""; }

async function getExistingCineVerseMovie(target, request) {
  const id = target.searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const authorization = request.headers.get("Authorization") || "";
  const apiUrl = SUPABASE_URL + "/rest/v1/movies?id=eq." + encodeURIComponent(id) +
    "&select=id,title,media_type,release_year,quality,rating,genre,language,description,poster_url,backdrop_url,trailer_url,video_url,download_url";
  const response = await fetch(apiUrl, {
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("Could not read this title from CineVerse. Check the movie record and admin access.");
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("No accessible CineVerse movie record matches this page ID.");
  const m = rows[0];
  return {
    source_url: target.href,
    title: m.title || "",
    release_year: m.release_year ?? null,
    description: m.description || "",
    poster_url: m.poster_url || "",
    backdrop_url: m.backdrop_url || "",
    genre: m.genre || "",
    rating: m.rating ?? null,
    quality: m.quality || "",
    video_url: m.video_url || "",
    download_url: m.download_url || target.href,
    warnings: ["Loaded from the existing CineVerse database record. Review the preview before copying fields into the form."]
  };
}

export async function onRequestPost({ request }) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    if (!body || typeof body.url !== "string" || body.url.length > 2048) return Response.json({ error:"A webpage URL is required." }, { status:400 });
    let target = safeUrl(body.url);
    const requestHost = new URL(request.url).hostname.toLowerCase();
    if (target.hostname.toLowerCase() === requestHost && target.pathname === "/movie") {
      const existing = await getExistingCineVerseMovie(target, request);
      if (existing) return Response.json(existing, { headers: { "Cache-Control": "no-store" } });
    }
    let response, html;
    for (let i=0; i<4; i++) {
      response = await fetch(target.href, { redirect:"manual", headers:{ "User-Agent":UA, "Accept":"text/html,application/xhtml+xml;q=0.9" }, signal:AbortSignal.timeout(12000) });
      if ([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get("location");
        if(!location) throw new Error("The source page redirected without a destination.");
        target=safeUrl(new URL(location,target).href); continue;
      }
      break;
    }
    if (!response || !response.ok) throw new Error("The source site did not return a readable page (HTTP "+(response?.status||0)+").");
    const type=response.headers.get("content-type")||"";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("This URL is not an HTML download/details page. For direct video URLs, add the link manually.");
    const reader=response.body?.getReader();
    if(!reader) throw new Error("Could not read the source page.");
    const chunks=[]; let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BYTES){await reader.cancel();throw new Error("The source page is too large to scan (limit 1.5 MB).");}chunks.push(value);}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    html=new TextDecoder("utf-8").decode(bytes);
    const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let structured=null;
    for(const match of scripts){try{const data=JSON.parse(match[1].replace(/<!--|-->/g,"").trim());structured=findMovie(data);if(structured)break;}catch{}}
    const title=firstText(structured?.name,meta(html,["og:title","twitter:title"]), (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]).replace(/\s*[|–—:]\s*(download|watch|stream|movie|full movie).*$/i,"").slice(0,180);
    const desc=firstText(structured?.description,meta(html,["og:description","description","twitter:description"]));
    const image=absolute(structured?.image||meta(html,["og:image","twitter:image"]),target.href);
    const date=firstText(structured?.datePublished,structured?.dateCreated,meta(html,["release_date","datePublished"]));
    const yearMatch=date.match(/(?:18|19|20|21)\d{2}/);
    const genres=Array.isArray(structured?.genre)?structured.genre.join(", "):clean(structured?.genre);
    const rating=structured?.aggregateRating?.ratingValue;
    const directCandidates=[structured?.contentUrl,structured?.video?.contentUrl,structured?.associatedMedia?.contentUrl];
    let videoUrl="";
    for(const candidate of directCandidates){const u=absolute(candidate,target.href);if(u && /\.(mp4|webm)(?:$|[?#])/i.test(u)){videoUrl=u;break;}}
    const qualityMatch=(html+" "+target.href).match(/\b(480p|720p|1080p|2160p|4k|2k|hevc)\b/i);
    return Response.json({
      source_url:target.href,
      title,
      release_year:yearMatch?Number(yearMatch[0]):null,
      description:desc.slice(0,5000),
      poster_url:image,
      genre:genres,
      rating:rating!=null && Number.isFinite(Number(rating)) ? Math.min(10,Math.max(0,Number(rating))) : null,
      quality:qualityMatch?({ "2160p":"4K UHD","4k":"4K UHD","2k":"2K","hevc":"HEVC"}[qualityMatch[1].toLowerCase()]||qualityMatch[1].toLowerCase()):"",
      video_url:videoUrl,
      download_url:target.href,
      warnings:["Automatic extraction depends on the source page's public HTML. Check every field before saving.","The page URL is saved as the authorized download/viewing link; a direct MP4/WebM URL is only filled when explicitly exposed in structured metadata."]
    },{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    return Response.json({ error: error?.name==="TimeoutError" ? "The source site took too long to respond. Try again or enter details manually." : (error?.message||"Could not fetch movie details.") }, { status:400, headers:{"Cache-Control":"no-store"} });
  }
}
