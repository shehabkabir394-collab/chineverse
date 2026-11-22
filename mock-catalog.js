const now = Date.now();
const day = 86400000;

export const CATEGORIES = [
  { label: "Movies", path: "/type/movies" },
  { label: "Dramas & Series", path: "/type/series" },
  { label: "K-Drama", path: "/language/korean" },
  { label: "C-Drama", path: "/language/chinese" },
  { label: "Hindi Dubbed", path: "/language/hindi-dubbed" },
  { label: "South Indian", path: "/southIndian" },
  { label: "Bollywood", path: "/bollywood" },
  { label: "Hollywood", path: "/language/english" },
  { label: "Bengali", path: "/language/bengali" },
  { label: "Anime", path: "/anime" },
  { label: "Upcoming", path: "/upcoming" }
];

export const PLATFORMS = [
  { name: "Netflix" },
  { name: "Hoichoi" },
  { name: "Zee5" },
  { name: "Prime Video" },
  { name: "Disney+" }
];

const RAW_TITLES = [
  {
    id: "mb-101",
    subjectId: "101",
    path: "/mb/shadow-of-dhaka-101",
    title: "Shadow of Dhaka",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "4K",
    language: "Bengali · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "Bangladesh",
    year: "2026",
    releaseDate: "2026-10-18",
    uploadedAtMs: now - 1 * day,
    genre: "Action, Thriller",
    platform: "Hoichoi",
    views: 94200,
    pinned: true,
    storyline: "An investigative journalist uncovers a cross-border syndicate operating beneath Dhaka's busiest river port.",
    palette: ["#b91c1c", "#18181b"]
  },
  {
    id: "mb-102",
    subjectId: "102",
    path: "/mb/seoul-midnight-express-102",
    title: "Seoul Midnight Express",
    type: "series",
    mediaType: "series",
    typeBadge: "Series",
    quality: "1080p",
    language: "Korean · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "South Korea",
    year: "2026",
    releaseDate: "2026-11-02",
    uploadedAtMs: now - 2 * day,
    genre: "Drama, Mystery",
    platform: "Netflix",
    views: 88400,
    status: "Ongoing",
    totalEpisodes: 8,
    storyline: "Two strangers boarding the final subway line in Seoul discover their timelines intersect across ten years.",
    palette: ["#991b1b", "#0f172a"]
  },
  {
    id: "mb-103",
    subjectId: "103",
    path: "/mb/monsoon-rhythm-103",
    title: "Monsoon Rhythm",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "1080p",
    language: "Hindi",
    audioLanguage: "Hindi",
    country: "India",
    year: "2026",
    releaseDate: "2026-09-25",
    uploadedAtMs: now - 3 * day,
    genre: "Romance, Musical",
    platform: "Prime Video",
    views: 76500,
    storyline: "A classical violinist from Kolkata and an indie producer in Mumbai collaborate during one unforgettable monsoon season.",
    palette: ["#c2410c", "#1e1b4b"]
  },
  {
    id: "mb-104",
    subjectId: "104",
    path: "/mb/crimson-dynasty-104",
    title: "Crimson Dynasty",
    type: "series",
    mediaType: "series",
    typeBadge: "Series",
    quality: "1080p",
    language: "Chinese · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "China",
    year: "2026",
    releaseDate: "2026-10-10",
    uploadedAtMs: now - 4 * day,
    genre: "Historical, Drama",
    platform: "Netflix",
    views: 68900,
    totalEpisodes: 6,
    storyline: "A royal archivist navigates palace intrigue to protect an ancient treaty that keeps five provinces at peace.",
    palette: ["#be123c", "#1c1917"]
  },
  {
    id: "mb-105",
    subjectId: "105",
    path: "/mb/vikram-protocol-105",
    title: "Vikram Protocol",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "4K",
    language: "Tamil · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "India",
    year: "2026",
    releaseDate: "2026-11-08",
    uploadedAtMs: now - 5 * day,
    genre: "Action, Sci-Fi",
    platform: "Zee5",
    views: 81300,
    storyline: "A retired cyber-forensics specialist is pulled back into service when an autonomous defense grid goes rogue.",
    palette: ["#dc2626", "#09090b"]
  },
  {
    id: "mb-106",
    subjectId: "106",
    path: "/mb/astral-blade-chronicles-106",
    title: "Astral Blade Chronicles",
    type: "anime",
    mediaType: "anime",
    typeBadge: "Anime",
    quality: "1080p",
    language: "Japanese · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "Japan",
    year: "2026",
    releaseDate: "2026-10-29",
    uploadedAtMs: now - 6 * day,
    genre: "Anime, Fantasy, Action",
    platform: "Disney+",
    views: 72100,
    totalEpisodes: 4,
    isAnime: true,
    storyline: "Young swordsmiths forge starlight blades to defend floating archipelago cities from celestial storms.",
    palette: ["#7f1d1d", "#172554"]
  },
  {
    id: "mb-107",
    subjectId: "107",
    path: "/mb/padma-horizon-107",
    title: "Padma Horizon",
    type: "series",
    mediaType: "series",
    typeBadge: "Series",
    quality: "1080p",
    language: "Bengali",
    audioLanguage: "Bengali",
    country: "Bangladesh",
    year: "2026",
    releaseDate: "2026-11-12",
    uploadedAtMs: now - 7 * day,
    genre: "Drama, Family",
    platform: "Hoichoi",
    views: 59800,
    status: "Ongoing",
    totalEpisodes: 5,
    storyline: "Three generations of boatbuilders along the Padma river adapt to changing tides and modern ambitions.",
    palette: ["#0f766e", "#111827"]
  },
  {
    id: "mb-108",
    subjectId: "108",
    path: "/mb/neon-echoes-108",
    title: "Neon Echoes",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "4K",
    language: "English",
    audioLanguage: "English",
    country: "United States",
    year: "2026",
    releaseDate: "2026-10-01",
    uploadedAtMs: now - 8 * day,
    genre: "Sci-Fi, Thriller",
    platform: "Prime Video",
    views: 65400,
    storyline: "An audio restoration engineer hears encrypted coordinates inside vintage magnetic tapes from a vanished satellite.",
    palette: ["#e11d48", "#030712"]
  },
  {
    id: "mb-109",
    subjectId: "109",
    path: "/mb/busan-rain-109",
    title: "Busan Rain",
    type: "series",
    mediaType: "series",
    typeBadge: "Series",
    quality: "1080p",
    language: "Korean · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "South Korea",
    year: "2026",
    releaseDate: "2026-09-14",
    uploadedAtMs: now - 9 * day,
    genre: "Romance, Drama",
    platform: "Netflix",
    views: 74200,
    totalEpisodes: 6,
    storyline: "A coastal bookshop owner and a lighthouse architect reconnect every rainy season in Busan.",
    palette: ["#be185d", "#1e293b"]
  },
  {
    id: "mb-110",
    subjectId: "110",
    path: "/mb/lahore-nights-110",
    title: "Lahore Nights",
    type: "series",
    mediaType: "series",
    typeBadge: "Series",
    quality: "1080p",
    language: "Urdu",
    audioLanguage: "Urdu",
    country: "Pakistan",
    year: "2026",
    releaseDate: "2026-10-22",
    uploadedAtMs: now - 10 * day,
    genre: "Drama, Mystery",
    platform: "Zee5",
    views: 49300,
    totalEpisodes: 4,
    storyline: "A culinary historian solves a decades-old family mystery set in the walled city of Lahore.",
    palette: ["#b45309", "#18181b"]
  },
  {
    id: "mb-111",
    subjectId: "111",
    path: "/mb/himalayan-signal-111",
    title: "Himalayan Signal",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "1080p",
    language: "Nepali · Hindi Dubbed",
    audioLanguage: "Hindi",
    country: "Nepal",
    year: "2026",
    releaseDate: "2026-11-05",
    uploadedAtMs: now - 11 * day,
    genre: "Adventure, Drama",
    platform: "Disney+",
    views: 43200,
    storyline: "High-altitude radio operators guide a stranded research expedition through an unexpected Himalayan blizzard.",
    palette: ["#0369a1", "#0f172a"]
  },
  {
    id: "mb-112",
    subjectId: "112",
    path: "/mb/colombo-tide-112",
    title: "Colombo Tide",
    type: "movie",
    mediaType: "movie",
    typeBadge: "Movie",
    quality: "1080p",
    language: "Sinhala",
    audioLanguage: "Sinhala",
    country: "Sri Lanka",
    year: "2026",
    releaseDate: "2026-10-15",
    uploadedAtMs: now - 12 * day,
    genre: "Drama, Thriller",
    platform: "Prime Video",
    views: 38900,
    storyline: "A harbor pilot races against an approaching cyclone to rescue a drifting cargo vessel off Colombo.",
    palette: ["#1d4ed8", "#09090b"]
  }
];

function posterUrl(baseUrl, item) {
  return `${baseUrl}/api/poster/${encodeURIComponent(item.id)}.svg`;
}

function hydrateItem(baseUrl, item) {
  const poster = posterUrl(baseUrl, item);
  return {
    ...item,
    poster,
    previewImage: poster,
    posterUrl: poster,
    detailsEndpoint: `${baseUrl}/api/movie-api/details?path=${encodeURIComponent(item.path)}`,
    _hindiCatalog: /hindi/i.test(item.language || "") || /hindi/i.test(item.audioLanguage || ""),
    _latestFeed: true,
    _dramaCatalog: item.type === "series",
    _koreanCatalog: /korean/i.test(item.language || "") || /korea/i.test(item.country || ""),
    _animeCatalog: item.type === "anime" || item.isAnime === true
  };
}

export function buildPosterSvg(id) {
  const item = RAW_TITLES.find(t => t.id === id) || RAW_TITLES[0];
  const [c1, c2] = item.palette || ["#b91c1c", "#09090d"];
  const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 580" width="400" height="580">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="32%" r="60%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="580" fill="url(#bg)"/>
  <rect width="400" height="580" fill="url(#glow)"/>
  <rect x="24" y="24" width="110" height="30" rx="6" fill="#000000" fill-opacity="0.55"/>
  <text x="79" y="44" fill="#ffffff" font-family="system-ui, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${esc(item.quality)} · ${esc(item.year)}</text>
  <circle cx="200" cy="235" r="46" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
  <polygon points="188,215 188,255 224,235" fill="#ffffff" fill-opacity="0.9"/>
  <rect x="0" y="380" width="400" height="200" fill="#000000" fill-opacity="0.55"/>
  <text x="28" y="438" fill="#fca5a5" font-family="system-ui, sans-serif" font-size="13" font-weight="700" letter-spacing="1.5">${esc(item.typeBadge.toUpperCase())} · ${esc(item.country.toUpperCase())}</text>
  <text x="28" y="480" fill="#ffffff" font-family="system-ui, sans-serif" font-size="26" font-weight="800">${esc(item.title)}</text>
  <text x="28" y="514" fill="#d4d4d8" font-family="system-ui, sans-serif" font-size="14">${esc(item.genre)}</text>
  <text x="28" y="544" fill="#a1a1aa" font-family="system-ui, sans-serif" font-size="13">${esc(item.language)}</text>
</svg>`;
}

export function handleMockMovieApi(legacy, query, baseUrl) {
  const items = RAW_TITLES.map(t => hydrateItem(baseUrl, t));
  const byCategory = (cat) => {
    const c = String(cat || "").toLowerCase();
    if (!c || c === "/" || c === "/new" || c === "/mostwatch/7d") return items;
    if (c.includes("movie")) return items.filter(i => i.type === "movie");
    if (c.includes("series") || c.includes("drama")) return items.filter(i => i.type === "series");
    if (c.includes("korean")) return items.filter(i => /korea/i.test(i.country) || /korean/i.test(i.language));
    if (c.includes("chinese")) return items.filter(i => /china/i.test(i.country) || /chinese/i.test(i.language));
    if (c.includes("hindi")) return items.filter(i => i._hindiCatalog);
    if (c.includes("south")) return items.filter(i => /tamil|telugu|south/i.test(i.language + " " + i.genre));
    if (c.includes("bollywood")) return items.filter(i => /india/i.test(i.country));
    if (c.includes("english")) return items.filter(i => /english/i.test(i.language));
    if (c.includes("bengali") || c.includes("bangladesh")) return items.filter(i => /bengali|bangladesh/i.test(i.language + " " + i.country));
    if (c.includes("anime")) return items.filter(i => i.type === "anime" || i.isAnime);
    if (c.includes("india")) return items.filter(i => /india/i.test(i.country));
    if (c.includes("pakistan")) return items.filter(i => /pakistan/i.test(i.country));
    if (c.includes("nepal")) return items.filter(i => /nepal/i.test(i.country));
    if (c.includes("sri-lanka")) return items.filter(i => /sri lanka/i.test(i.country));
    return items;
  };

  switch (legacy) {
    case "home":
      return {
        ok: true,
        categories: CATEGORIES,
        platforms: PLATFORMS,
        banners: items.filter(i => i.type === "movie").slice(0, 5),
        trending: [...items].sort((a, b) => b.views - a.views),
        upcoming: items.slice(0, 4),
        sections: [
          { title: "Hindi Dubbed Hits", badge: "HINDI AUDIO", categoryPath: "/language/hindi-dubbed", items: items.filter(i => i._hindiCatalog) },
          { title: "Trending Bengali Movies", badge: "DHAKA & KOLKATA", categoryPath: "/language/bengali", items: items.filter(i => /bengali|bangladesh/i.test(i.language + " " + i.country)) },
          { title: "K-Drama Favorites", badge: "KOREAN SERIES", categoryPath: "/language/korean", items: items.filter(i => /korea/i.test(i.country)) },
          { title: "South Indian & Bollywood", badge: "INDIA TRENDING", categoryPath: "/bollywood", items: items.filter(i => /india/i.test(i.country)) },
          { title: "Anime in Hindi", badge: "ANIME ZONE", categoryPath: "/anime", items: items.filter(i => i.type === "anime") }
        ]
      };

    case "categories":
      return { ok: true, categories: CATEGORIES };

    case "catalog": {
      const cat = query.get("category") || query.get("path") || "";
      const list = byCategory(cat);
      return { ok: true, items: list, page: Number(query.get("page") || 1), totalPages: 1, hasMore: false };
    }

    case "search":
    case "suggest": {
      const q = String(query.get("q") || "").trim().toLowerCase();
      const matched = q
        ? items.filter(i => [i.title, i.genre, i.language, i.country, i.storyline].join(" ").toLowerCase().includes(q))
        : items;
      return { ok: true, items: matched, page: 1, totalPages: 1 };
    }

    case "hot-search":
      return { ok: true, items: ["Shadow of Dhaka", "Seoul Midnight Express", "Vikram Protocol", "Hindi Dubbed", "K-Drama", "Anime"] };

    case "filter-options":
      return {
        ok: true,
        languages: ["Hindi", "Bengali", "Korean", "Chinese", "Tamil", "English", "Japanese", "Urdu", "Nepali"],
        types: ["Movie", "Series", "Anime"],
        genres: ["Action", "Drama", "Thriller", "Romance", "Mystery", "Sci-Fi", "Historical", "Adventure", "Fantasy"]
      };

    case "filter":
      return { ok: true, items, page: 1, totalPages: 1 };

    case "platform": {
      const name = String(query.get("platform") || query.get("name") || "").toLowerCase();
      const list = name ? items.filter(i => i.platform.toLowerCase().includes(name)) : items;
      return { ok: true, items: list.length ? list : items.slice(0, 6), page: Number(query.get("page") || 1), totalPages: 1 };
    }

    case "upcoming":
      return { ok: true, items: items.slice(0, 6) };

    case "shorts":
    case "reels":
      return {
        ok: true,
        items: items.slice(0, 4).map(i => ({ ...i, description: "Quick Preview · " + i.genre }))
      };

    case "sports":
    case "sports/matches":
      return {
        ok: true,
        channels: [
          { id: "sp-1", name: "CineSports HD 1", category: "Cricket", league: "International T20", quality: "1080p", live: true, logo: `${baseUrl}/images/moviestreambd-logo.svg` },
          { id: "sp-2", name: "Football Arena Live", category: "Football", league: "Premier Matchday", quality: "1080p", live: true, logo: `${baseUrl}/images/moviestreambd-logo.svg` },
          { id: "sp-3", name: "Asia Sports Network", category: "Multi-Sport", league: "Live Broadcast", quality: "720p", live: true, logo: `${baseUrl}/images/moviestreambd-logo.svg` }
        ]
      };

    case "sports/leagues":
      return { ok: true, leagues: ["International T20", "Premier Matchday", "Asia Cup Highlights"] };

    case "details": {
      const reqPath = String(query.get("path") || "");
      const reqTitle = String(query.get("title") || "").toLowerCase();
      const found = items.find(i => i.path === reqPath)
        || (reqTitle ? items.find(i => i.title.toLowerCase() === reqTitle) : null)
        || items[0];
      const epCount = found.totalEpisodes || 1;
      const episodes = Array.from({ length: epCount }, (_, idx) => ({
        label: found.type === "movie" ? `${found.title} (${found.quality})` : `Episode ${idx + 1}`,
        number: idx + 1,
        seasonNumber: found.type === "movie" ? 0 : 1,
        episodeNumber: idx + 1,
        thumbnail: found.poster,
        kind: found.type === "movie" ? "Feature Film" : `Season 1 · Episode ${idx + 1}`,
        sources: []
      }));
      return {
        ok: true,
        detail: {
          ...found,
          episodes,
          dubs: [{ language: found.audioLanguage || "Hindi" }, { language: "Original Audio" }],
          staff: [
            { staffId: "st-1", name: "A. Rahman", role: "Director" },
            { staffId: "st-2", name: "N. Sultana", role: "Lead Cast" },
            { staffId: "st-3", name: "K. Min-ho", role: "Screenplay" }
          ]
        }
      };
    }

    case "stream":
      return {
        ok: true,
        stream: {
          sources: [
            {
              url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
              quality: "1080p",
              provider: "Preview Server 1",
              type: "video/mp4",
              audioLanguage: "Hindi"
            },
            {
              url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
              quality: "720p",
              provider: "Preview Server 2",
              type: "video/mp4",
              audioLanguage: "Original"
            }
          ]
        }
      };

    case "related":
      return { ok: true, items: items.slice(0, 6) };

    case "comments":
      return {
        ok: true,
        comments: [
          { userName: "Rafiqul", content: "Great pacing and crisp picture quality!", createdAt: "2 hours ago" },
          { userName: "Tasnim", content: "Loved the soundtrack and Hindi dub clarity.", createdAt: "Yesterday" }
        ]
      };

    case "staff":
      return {
        ok: true,
        staff: {
          name: "Featured Cast & Crew",
          biography: "Preview biography entry loaded from local catalog fallback. Configure CINEPULSE_API_KEY in environment variables for live upstream metadata."
        }
      };

    case "me":
      return {
        ok: true,
        account: {
          name: "Local Preview Mode",
          plan: "Fallback Catalog",
          status: "Connected (Set CINEPULSE_API_KEY for live upstream)"
        }
      };

    case "status":
      return { ok: true, status: "ok", mode: "fallback" };

    default:
      return { ok: true, items: [] };
  }
}
