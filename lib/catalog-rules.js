const NIGERIAN_COUNTRY_RE = /\b(?:nigeria|nollywood|ghana)\b/i;
const NIGERIAN_SECTION_RE = /\b(?:nollywood|must-watch\s*black\s*shows?|black\s*cinema|black\s*shows?)\b|bet\+/i;
const NIGERIAN_CONTENT_RE = /\b(?:nollywood|nigeria|nigerian|yoruba|igbo|hausa|naija|lagos|abuja|ekiti|enugu|anambra|ibadan|ogun|kano|odunlade|adekola|funke\s+akindele|iyabo\s+ojo|toyi?n\s+abraham|mercy\s+johnson|patience\s+ozokwor|aki\s+and\s+pawpaw|osita\s+iheme|chinedu\s+ikedieze|pete\s+edochie|ramsey\s+nouah|genevieve\s+nnaji|omoni\s+oboli|rini\s+okorie|bimbo\s+ademoye|destiny\s+etiko|yul\s+edochie|zubby\s+michael|frederick\s+leonard|maurice\s+sam|sonia\s+uche|clinton\s+joshua|ruth\s+kadiri|uche\s+nancy|chidi\s+mokeme|kunle\s+afolayan|mo\s+abudu|akotagiri|jagun\s+jagun|anik[uo]lapo|omo\s+ghetto|king\s+of\s+boys|alakada|jenifa|battle\s+on\s+buka\s+street|a\s+tribe\s+called\s+judah|the\s+black\s+book|brotherhood\s+naija|loves?\s+in\s+lagos|chief\s+daddy|sugar\s+rush\s+lagos)\b/i;
const NIGERIAN_KNOWN_SPAM_TITLE_RE = /^(?:akotagiri|save\s+my\s+life\s*2|the\s+wrong\s+boyfriend|love\s+is\s+blind|husband\s+on\s+lease|his\s+unloved\s+wife|unbreakable\s+bonds|to\s+love\s+and\s+cherish|a\s+father'?s\s+love|bound\s+by\s+destiny)$/i;

const SEARCH_STOP_WORDS = new Set([
  "movie", "movies", "film", "films", "video", "videos", "full", "hd",
  "watch", "online", "download", "free", "new", "latest", "best", "top",
  "show", "shows", "part", "season", "episode", "series", "dubbed", "org", "hq"
]);

const NOISE_VIDEO_CLIP_RE = /\b(?:video\s+song|lyrical(?:\s+video)?|full\s+song|audio\s+song|entry\s+song|full\s+naat|naat\s+sharif|lok\s+virsa|one\s+shot\s+revision|jee\s+main|state\s+boards|ncert\s*\d+|cbse\s+course|class\s*\d+\s+(?:maths|science|economics|physics|chemistry|biology|english|history))\b/i;

export function isNoiseVideoClip(item) {
  const title = String(item?.title || item || "").trim();
  if (!title) return false;
  return NOISE_VIDEO_CLIP_RE.test(title);
}

export function getEndOfTodayMs(nowMs = Date.now()) {
  const bdt = new Date(nowMs + 6 * 3600 * 1000);
  return Date.UTC(bdt.getUTCFullYear(), bdt.getUTCMonth(), bdt.getUTCDate(), 23, 59, 59, 999) - 6 * 3600 * 1000;
}

export function isNigerianContent(item, sectionTitle = "") {
  const sec = String(sectionTitle || "").trim();
  if (sec && (NIGERIAN_SECTION_RE.test(sec) || NIGERIAN_COUNTRY_RE.test(sec))) {
    return true;
  }
  if (!item || typeof item !== "object") return false;

  const country = String(item.country || item.countryName || "").trim();
  if (NIGERIAN_COUNTRY_RE.test(country)) return true;

  const title = String(item.title || "").trim();
  const lang = String(item.language || "").trim();
  const genre = String(item.genre || "").trim();
  const platform = String(item.platform || "").trim();
  const desc = String(item.description || item.storyline || "").trim();
  const hay = `${title} ${lang} ${genre} ${platform} ${country} ${desc}`;

  if (NIGERIAN_CONTENT_RE.test(hay)) return true;
  if (NIGERIAN_KNOWN_SPAM_TITLE_RE.test(title) && !/\b(?:india|korean|japan|china|bangla|hindi|united\s+states|uk|turkey)\b/i.test(`${country} ${lang}`)) {
    return true;
  }
  if (/\byoruba\b|\bigbo\b|\bhausa\b/i.test(lang)) return true;
  if (/afri[ck]an?\s+movie|nigerian\s+movie|nollywood/i.test(hay)) return true;
  return false;
}

export function isUpcomingUnreleased(item, nowMs = Date.now()) {
  if (!item || typeof item !== "object") return false;

  const endToday = getEndOfTodayMs(nowMs);
  const currentYear = new Date(nowMs + 6 * 3600 * 1000).getUTCFullYear();
  const rawDate = String(item.releaseDate || item.appointmentDate || "").trim();
  let hasPastReleaseDate = false;

  if (rawDate) {
    const ts = Date.parse(rawDate);
    if (Number.isFinite(ts) && ts > 0) {
      if (ts > endToday + 2 * 86400 * 1000) {
        return true;
      }
      if (ts > endToday && item.hasResource !== true) {
        return true;
      }
      if (ts <= endToday) {
        hasPastReleaseDate = true;
      }
    }
  }

  // Never mark a title as upcoming/unreleased when its release date has already passed
  if (hasPastReleaseDate) return false;

  const yearNum = Number(String(item.year || "").match(/\b(19\d\d|20\d\d)\b/)?.[1] || 0);
  if (yearNum > currentYear) return true;
  if (yearNum > 0 && yearNum < currentYear && item.isUpcoming !== true) {
    return false;
  }

  if (item.isUpcoming === true) return true;

  const titleBadge = `${item.title || ""} ${item.typeBadge || ""}`;
  if (/\b(?:upcoming|coming\s*soon|unreleased)\b/i.test(titleBadge) && item.hasResource !== true) {
    return true;
  }
  return false;
}

const COMPOUND_QUERY_ALIASES = [
  [/\bspider\s*man\b/gi, "Spider-Man"],
  [/\bspiderman\b/gi, "Spider-Man"],
  [/\biron\s*man\b/gi, "Iron Man"],
  [/\bironman\b/gi, "Iron Man"],
  [/\bant\s*man\b/gi, "Ant-Man"],
  [/\bantman\b/gi, "Ant-Man"],
  [/\bxmen\b/gi, "X-Men"],
  [/\bsuperman\b/gi, "Superman"],
  [/\bbatman\b/gi, "Batman"],
  [/\baquaman\b/gi, "Aquaman"],
  [/\bkdrama\b/gi, "K-Drama"],
  [/\bcdrama\b/gi, "C-Drama"],
  [/\bjdrama\b/gi, "J-Drama"],
  [/\bscifi\b/gi, "Sci-Fi"],
  [/\bonepiece\b/gi, "One Piece"]
];

export function expandSearchQueryVariants(rawQuery = "") {
  const base = String(rawQuery || "").replace(/\s+/g, " ").trim();
  if (!base) return [];
  const out = [];
  const add = val => {
    const clean = String(val || "").replace(/\s+/g, " ").trim();
    if (clean.length >= 2 && !out.some(x => x.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
  };
  add(base);
  for (const [re, replacement] of COMPOUND_QUERY_ALIASES) {
    if (re.test(base)) {
      re.lastIndex = 0;
      const expanded = base.replace(re, replacement);
      add(expanded);
      add(expanded.replace(/-/g, " "));
    }
  }
  if (/-/.test(base)) {
    add(base.replace(/-/g, " "));
    add(base.replace(/-/g, ""));
  }
  return out;
}

export function cleanSearchTitleText(rawTitle = "") {
  return String(rawTitle || "")
    .replace(/\s*[—–-]\s*Movie(?:Link|Stream)BD.*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:19|20)\d{2}[^)]*\)(?:\s+(?:hindi|bangla|bengali|tamil|telugu|malayalam|korean|english|turkish|indonesian|dubbed|dual|multi|audio|org|hq|hdcam|predvd|camrip|webrip|dvdrip))*/gi, " ")
    .replace(/\((?:hindi|bangla|bengali|english|tamil|telugu|malayalam|korean|turkish|indonesian|dual\s*audio|dubbed|org|hq|uncut)[^)]*\)/gi, " ")
    .replace(/\b(?:S\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?|Season\s*\d+|Ep(?:isode)?\s*\d+(?:\s*[-–]\s*\d+)?|Full\s*HD|HDRip|WEB-?DL|BluRay|HEVC|1080p|720p|480p|4K|ORG|HQ|Uncut|Added|Completed|Complete|Dual\s*Audio|Multi\s*Audio|(?:Hindi|Bangla|Bengali|Tamil|Telugu|Malayalam|Korean|English)\s*(?:HQ|ORG)?\s*Dubbed)\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[/_|]+/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSearchTitleVariants(rawTitle = "") {
  const input = String(rawTitle || "").trim();
  if (!input) return [];

  const out = [];
  const add = val => {
    const clean = String(val || "")
      .replace(/^[\s/|:-]+|[\s/|:-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length >= 2 && !out.some(x => x.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
  };

  // Split around slash / pipe BEFORE concatenation so individual titles are tried first
  const rawParts = input.split(/\s*[\/|]\s*/);
  for (const part of rawParts) {
    add(cleanSearchTitleText(part).replace(/\s*\/\s*/g, " "));
  }

  // Preserve year-split variants when not already split by slash e.g. "Title A (2026) Title B", skipping tag-only suffixes like "Hindi ORG"
  const yrSplit = input.match(/^(.+?)\s*\((?:19|20)\d{2}[^)]*\)\s+(.+)$/);
  const TAG_ONLY_RE = /^(?:hindi|bangla|bengali|tamil|telugu|malayalam|korean|english|turkish|indonesian|dubbed|dual|multi|audio|org|hq|uncut|added|completed|complete|hd|full|hdrip|web-?dl|bluray|hevc|1080p|720p|480p|4k|s\d{1,2}|season\s*\d+|\[[^\]]*\]|\s)+$/i;
  if (yrSplit && !/[\/|]/.test(yrSplit[1])) {
    add(cleanSearchTitleText(yrSplit[1]).replace(/\s*\/\s*/g, " "));
    if (!TAG_ONLY_RE.test(yrSplit[2])) {
      add(cleanSearchTitleText(yrSplit[2]).replace(/\s*\/\s*/g, " "));
    }
  }

  const combined = cleanSearchTitleText(input).replace(/\s*\/\s*/g, " ");
  add(combined);

  // Also try short core title (without subtitle after hyphen/colon)
  const colonSplit = combined.split(/\s*[:–-]\s*/)[0];
  if (colonSplit && colonSplit.length >= 3) add(colonSplit);

  return out;
}

export function normalizeMatchText(s = "") {
  return String(s || "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreSearchMatch(item, rawQuery, options = {}) {
  const qNorm = normalizeMatchText(rawQuery);
  if (!qNorm) return options.allowEmpty ? 10 : 0;

  const title = normalizeMatchText(item?.title || "");
  const cleanTitle = normalizeMatchText(cleanSearchTitleText(item?.title || ""));
  const qCompact = qNorm.replace(/\s+/g, "");
  const titleCompact = title.replace(/\s+/g, "");
  const cleanCompact = cleanTitle.replace(/\s+/g, "");
  const hay = normalizeMatchText([
    item?.title,
    item?.searchTitle,
    item?.genre,
    item?.country,
    item?.countryName,
    item?.language,
    item?.typeBadge,
    item?.platform,
    item?.description
  ].filter(Boolean).join(" "));

  const rawTokens = qNorm.split(" ").filter(Boolean);
  const meaningfulTokens = rawTokens.filter(t => !SEARCH_STOP_WORDS.has(t));
  const tokens = meaningfulTokens.length ? meaningfulTokens : rawTokens;
  if (!tokens.length) return 0;

  const titleWords = (cleanTitle || title).split(" ").filter(Boolean);
  const hayWords = hay.split(" ").filter(Boolean);

  let score = 0;

  if (title === qNorm || cleanTitle === qNorm) {
    score = 220;
  } else if (qCompact.length >= 4 && (titleCompact === qCompact || cleanCompact === qCompact)) {
    score = 212;
  } else if (title.startsWith(qNorm) || cleanTitle.startsWith(qNorm)) {
    score = 185;
  } else if (qCompact.length >= 4 && (titleCompact.startsWith(qCompact) || cleanCompact.startsWith(qCompact))) {
    score = 178;
  } else if (title.includes(qNorm) || cleanTitle.includes(qNorm)) {
    score = 160;
  } else if (qCompact.length >= 5 && (titleCompact.includes(qCompact) || cleanCompact.includes(qCompact))) {
    score = 152;
  } else if (
    tokens.length >= 2 &&
    tokens.every((t, i) => {
      // Allow partial last word / 2-char word prefixes, e.g. "shot bo" -> "Shot Boot Three", "mirz s2" -> "Mirzapur"
      const isLast = i === tokens.length - 1;
      if (title.includes(t)) return true;
      if (isLast || t.length >= 2) {
        return titleWords.some(w => w.startsWith(t));
      }
      return false;
    })
  ) {
    score = 142;
  } else if (
    tokens.length === 1 &&
    tokens[0].length >= 2 &&
    titleWords.some(w => w.startsWith(tokens[0]))
  ) {
    score = 132;
  } else if (tokens.every(t => hay.includes(t))) {
    score = 110;
  } else if (
    tokens.length >= 2 &&
    tokens.filter(t => hay.includes(t) || hayWords.some(w => w.startsWith(t))).length >= Math.ceil(tokens.length * 0.7)
  ) {
    score = 88;
  } else if (tokens.length === 1 && tokens[0].length >= 3 && title.includes(tokens[0])) {
    score = 72;
  } else if (options.allowBroadMatch && tokens.some(t => t.length >= 3 && hay.includes(t))) {
    score = 54;
  }

  // Strictly reject unrelated items! Never assign a fallback score to zero-overlap items.
  if (score <= 0) return 0;

  if (item?.hasResource !== false) score += 14;
  if (item?.poster || item?.previewImage) score += 8;
  if (/\b(?:india|bangladesh)\b/i.test(`${item?.country || ""} ${item?.language || ""}`)) score += 8;

  if (isNoiseVideoClip(item) && !/\b(?:song|lyrical|naat|revision|class|jee|ncert|cbse)\b/i.test(qNorm)) {
    score = Math.max(1, score - 75);
  }

  return score;
}

export function collectTitleSuggestions(query, { suggestWords = [], items = [], extraTitles = [], limit = 10 } = {}) {
  const qNorm = normalizeMatchText(query);
  const qCompact = qNorm.replace(/\s+/g, "");
  const tokens = qNorm.split(" ").filter(Boolean);
  const lastTok = tokens[tokens.length - 1] || "";

  const candidates = [];
  const seen = new Set();

  const add = (rawTitle, baseBoost = 0) => {
    const clean = String(rawTitle || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || clean.length < 2) return;
    if (NIGERIAN_CONTENT_RE.test(clean) || NIGERIAN_KNOWN_SPAM_TITLE_RE.test(clean)) return;

    const k = clean.toLowerCase();
    if (seen.has(k)) return;

    const norm = normalizeMatchText(clean);
    if (!norm) return;
    const normCompact = norm.replace(/\s+/g, "");
    if (qNorm) {
      const words = norm.split(" ").filter(Boolean);
      const exactStarts = norm.startsWith(qNorm) || (qCompact.length >= 4 && normCompact.startsWith(qCompact));
      const contains = norm.includes(qNorm) || (qCompact.length >= 4 && normCompact.includes(qCompact));
      const tokenPrefixMatch = tokens.length > 0 && tokens.every((t, idx) =>
        norm.includes(t) || ((idx === tokens.length - 1 || t.length >= 2) && words.some(w => w.startsWith(t)))
      );
      const wordStartsLast = lastTok.length >= 2 && words.some(w => w.startsWith(lastTok));
      if (!exactStarts && !contains && !tokenPrefixMatch && !wordStartsLast && baseBoost < 80) {
        return;
      }
      let sc = baseBoost;
      if (exactStarts) sc += 120;
      else if (contains) sc += 95;
      else if (tokenPrefixMatch) sc += 80;
      else if (wordStartsLast) sc += 45;
      if (norm === qNorm) sc -= 5; // prefer fuller title variants slightly alongside exact match
      seen.add(k);
      candidates.push({ title: clean, sc });
    } else {
      seen.add(k);
      candidates.push({ title: clean, sc: baseBoost });
    }
  };

  for (const w of suggestWords) add(w, 60);
  for (const t of extraTitles) add(t, 45);
  for (const it of items) {
    if (!it || isNigerianContent(it)) continue;
    add(it.title, it.hasResource !== false ? 52 : 30);
  }

  return candidates
    .sort((a, b) => b.sc - a.sc || a.title.length - b.title.length)
    .slice(0, limit)
    .map(x => x.title);
}

const STRICT_STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "in", "on", "to", "from", "part",
  "movie", "movies", "series", "season", "ep", "episode", "episodes",
  "full", "hd", "dubbed", "org", "hq", "added", "bangla", "bengali", "hindi"
]);

export function extractTitleYears(raw = "") {
  const maxYr = new Date().getUTCFullYear() + 2;
  return [...String(raw || "").matchAll(/[\(\[]?(19\d\d|20\d\d)[\)\]]?/g)]
    .map(m => Number(m[1]))
    .filter(y => y >= 1900 && y <= maxYr);
}

export function strictTitleMatchScore(queryTitle = "", candidateTitle = "", { queryYear = "", candidateYear = "", isSeries = false } = {}) {
  const qRaw = String(queryTitle || "").trim();
  const cRaw = String(candidateTitle || "").trim();
  if (!qRaw || !cRaw) return 0;

  const qNorm = normalizeMatchText(cleanSearchTitleText(qRaw).replace(/\s*\/\s*/g, " ")) || normalizeMatchText(qRaw);
  const cNorm = normalizeMatchText(cleanSearchTitleText(cRaw).replace(/\s*\/\s*/g, " ")) || normalizeMatchText(cRaw);
  if (!qNorm || !cNorm) return 0;

  const qYears = queryYear && /^\d{4}$/.test(String(queryYear)) ? [Number(queryYear)] : extractTitleYears(qRaw);
  const cYears = candidateYear && /^\d{4}$/.test(String(candidateYear)) ? [Number(candidateYear)] : extractTitleYears(cRaw);
  let yearDelta = null;
  if (qYears.length && cYears.length) {
    let minDiff = Infinity;
    for (const qy of qYears) {
      for (const cy of cYears) {
        minDiff = Math.min(minDiff, Math.abs(qy - cy));
      }
    }
    if (Number.isFinite(minDiff)) {
      yearDelta = minDiff;
    }
  }

  const looksLikeSeries = Boolean(
    isSeries ||
    /\b(?:S\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?|Season\s*\d+)\b/i.test(`${qRaw} ${cRaw}`)
  );
  if (yearDelta !== null && yearDelta >= 2) {
    if (!(looksLikeSeries && qNorm === cNorm && yearDelta <= 12)) {
      return 0;
    }
  }

  const yearBonus =
    yearDelta === 0
      ? 0.06
      : yearDelta === 1
        ? -0.04
        : yearDelta !== null && yearDelta >= 2
          ? -0.06
          : 0;

  if (qNorm === cNorm) {
    return Math.min(1, 0.96 + yearBonus);
  }

  const qWordsAll = qNorm.split(" ").filter(Boolean);
  const cWordsAll = cNorm.split(" ").filter(Boolean);
  const qMeaningful = qWordsAll.filter(w => w.length >= 2 && !STRICT_STOP_WORDS.has(w));
  const cMeaningful = cWordsAll.filter(w => w.length >= 2 && !STRICT_STOP_WORDS.has(w));
  const qTokens = qMeaningful.length ? qMeaningful : qWordsAll;
  const cTokens = cMeaningful.length ? cMeaningful : cWordsAll;
  if (!qTokens.length || !cTokens.length) return 0;

  const cSet = new Set(cTokens);
  const qSet = new Set(qTokens);
  let qHits = 0;
  for (const t of qSet) {
    if (cSet.has(t)) qHits++;
  }
  if (qHits === 0) return 0;

  const recall = qHits / qSet.size;
  const precision = qHits / cSet.size;
  let score = (2 * recall * precision) / (recall + precision);

  // Allow strong containment bonus ONLY when lengths & token counts are reasonably comparable (prevents "Premika" hijacking "Premik Premika aar Petnee")
  const lenRatio = Math.min(qNorm.length, cNorm.length) / Math.max(qNorm.length, cNorm.length);
  const tokRatio = Math.min(qSet.size, cSet.size) / Math.max(qSet.size, cSet.size);
  if ((cNorm.includes(qNorm) || qNorm.includes(cNorm)) && lenRatio >= 0.72 && tokRatio >= 0.65) {
    score = Math.max(score, 0.86);
  }

  return Math.max(0, Math.min(1, score + yearBonus));
}

export function cleanYoutubeTrailerTitle(rawTitle = "") {
  return String(rawTitle || "")
    .replace(/\s*[|\-–—:]+\s*(?:[^|]*?\b(?:official|teaser|final|new|main|first|full|imax|hindi|bangla|bengali|english|4k)\b[^|]*?\b(?:trailer|teaser|promo|glimpse|preview)\b.*|\btrailer\b.*|\bteaser\b.*)$/i, "")
    .replace(/\s*\b(?:official|teaser|final|new|main|first|full|imax)\s+(?:(?:new|final|teaser|official|imax|hindi|bangla|english)\s+)*trailer\b.*$/i, "")
    .replace(/\s*\((?:19|20)\d{2}\)\s+.*$/i, m => m.match(/\((?:19|20)\d{2}\)/)?.[0] || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isMusicOrClipSubject(item) {
  if (!item || typeof item !== "object") return false;
  if (isNoiseVideoClip(item)) return true;
  const genre = String(item.genre || "").trim();
  const typeBadge = String(item.typeBadge || "").trim();
  const desc = String(item.description || item.storyline || "").trim();
  const title = String(item.title || "").trim();
  const st = Number(item.subjectType || 0);
  if (st === 6 && !item.isAnime && !/\banime\b|animation/i.test(`${genre} ${typeBadge} ${title}`)) {
    return true;
  }
  if (/\b(?:pop|music\s*video|lyric\s*video)\b/i.test(genre) && !/\b(?:drama|action|comedy|thriller|horror|crime|romance|documentary|animation|anime|biographical|musical)\b/i.test(genre)) {
    return true;
  }
  if (/\b(?:provided to youtube by|auto-generated by youtube|official music video|official audio)\b/i.test(desc)) {
    return true;
  }
  return false;
}

export function dedupeRepeatedTitleYear(rawTitle = "") {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  if (!title) return "";
  const m = title.match(/^(.*\b(?:19\d\d|20\d\d)\b.*)\s+\(((?:19|20)\d{2})\)\s*$/);
  if (m && m[1].includes(m[2])) {
    return m[1].trim();
  }
  return title;
}

export function parseEpisodeRangeFromTitle(rawTitle = "") {
  const s = String(rawTitle || "");
  const seasonMatch = /\bS(\d{1,2})\b/i.exec(s) || /\bSeason\s*(\d{1,2})\b/i.exec(s);
  const rangeMatch =
    /\[[^\]]*\b(?:Ep(?:isode)?s?)\s*0*(\d{1,3})\s*[-–to]+\s*0*(\d{1,3})\b[^\]]*\]/i.exec(s) ||
    /\b(?:Ep(?:isode)?s?)\s*0*(\d{1,3})\s*[-–]\s*0*(\d{1,3})\b/i.exec(s);
  if (rangeMatch) {
    const startEp = Math.max(1, Number(rangeMatch[1]) || 1);
    const endEp = Math.min(200, Math.max(startEp, Number(rangeMatch[2]) || startEp));
    const season = seasonMatch ? Math.max(1, Number(seasonMatch[1]) || 1) : 1;
    return { season, startEp, endEp };
  }
  const singleEpMatch = /\bEp(?:isode)?\s*0*(\d{1,3})\b/i.exec(s);
  if (singleEpMatch && seasonMatch) {
    const ep = Math.min(200, Math.max(1, Number(singleEpMatch[1]) || 1));
    const season = Math.max(1, Number(seasonMatch[1]) || 1);
    return { season, startEp: 1, endEp: ep };
  }
  if (seasonMatch) {
    return { season: Math.max(1, Number(seasonMatch[1]) || 1), startEp: 1, endEp: 1 };
  }
  return null;
}

export const CATALOG_PAGE_SIZE = 30;

export function paginateCatalogItems(allItems = [], page = 1, pageSize = CATALOG_PAGE_SIZE, options = {}) {
  const safePerPage = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || CATALOG_PAGE_SIZE)));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const list = Array.isArray(allItems) ? allItems : [];
  const bufferedTotal = list.length;
  const start = (safePage - 1) * safePerPage;
  const pageItems = list.slice(start, start + safePerPage);
  const upstreamHasMore = Boolean(options.upstreamHasMore);
  const estimatedTotal = Math.max(0, Math.floor(Number(options.estimatedTotalCount) || 0));

  const totalCount = upstreamHasMore
    ? Math.max(bufferedTotal + 1, estimatedTotal, start + pageItems.length + 1)
    : bufferedTotal;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePerPage));
  const hasMore = safePage < totalPages;

  return {
    items: pageItems,
    page: safePage,
    perPage: safePerPage,
    pageSize: safePerPage,
    totalCount,
    totalItems: totalCount,
    totalPages,
    maxPage: totalPages,
    hasMore,
    isExactTotal: !upstreamHasMore
  };
}


