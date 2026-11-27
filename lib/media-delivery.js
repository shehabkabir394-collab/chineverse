const DIRECT_PUBLIC_IMAGE_HOST_RE =
  /(?:^|\.)(?:image\.tmdb\.org|media-amazon\.com|r2\.dev|ibb\.co(?:\.com)?|postimg\.cc|ytimg\.com|mzstatic\.com|tvmaze\.com|wikimedia\.org|wikipedia\.org|img\.movielinkapp\.com|pbcdnw\.aoneroom\.com)$/i;

const PROTECTED_MEDIA_HOST_RE =
  /(?:^|\.)(?:hakunaymatata\.com|okay-891h\.onrender\.com|movielinkbd\.[a-z]+)$/i;

const PROTECTED_MEDIA_SUBDOMAIN_OR_PATH_RE =
  /(?:^|\.)mlbd-hls\.|\.m3u8(?:$|[?#])|\.mpd(?:$|[?#])|\/(?:m|hls|s|vseg|vsub)\//i;

const DIRECT_SAFE_MP4_HOST_RE =
  /(?:^|\.)(?:fsl-cdn\.fsldownload-worker\.workers\.dev|r2\.dev)$/i;

export function isDirectPublicImageCdn(rawUrl = "") {
  const s = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return DIRECT_PUBLIC_IMAGE_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

export function isKnownProtectedMediaHost(rawUrl = "") {
  const s = String(rawUrl || "").trim();
  if (!s) return true;
  if (PROTECTED_MEDIA_SUBDOMAIN_OR_PATH_RE.test(s)) return true;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    return PROTECTED_MEDIA_HOST_RE.test(u.hostname);
  } catch {
    return true;
  }
}

export function isKnownDirectSafeMp4Host(rawUrl = "") {
  const s = String(rawUrl || "").trim();
  if (!/^https:\/\//i.test(s)) return false;
  if (isKnownProtectedMediaHost(s)) return false;
  try {
    const u = new URL(s);
    return DIRECT_SAFE_MP4_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

export function isHlsMediaSource(src = {}) {
  const u = String(src?.url || src?.proxyUrl || "");
  const fmt = `${src?.format || ""} ${src?.mime || ""} ${src?.type || ""}`;
  return (
    /\.m3u8(?:$|[?#])/i.test(u) ||
    /\/api\/(?:sports-hls|mlbd-hls)\//i.test(u) ||
    /hls|mpegurl|m3u8/i.test(fmt)
  );
}

export function isDirectMediaResponseSafe({ ok = false, status = 0, headers = null } = {}) {
  const isOk = Boolean(ok || status === 206);
  if (!isOk) return { directOk: false, directCors: false };

  const getHeader = name => {
    if (!headers) return "";
    if (typeof headers.get === "function") return String(headers.get(name) || "");
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (String(k).toLowerCase() === lower) return String(v || "");
    }
    return "";
  };

  const ct = getHeader("content-type").toLowerCase();
  if (
    ct.includes("text/html") ||
    ct.includes("application/json") ||
    ct.includes("text/plain") ||
    ct.startsWith("image/") ||
    ct.includes("mpegurl") ||
    ct.includes("m3u8")
  ) {
    return { directOk: false, directCors: false };
  }

  const acceptRanges = getHeader("accept-ranges").toLowerCase();
  const hasRangeSupport = status === 206 || acceptRanges.includes("bytes");
  if (!hasRangeSupport) {
    return { directOk: false, directCors: false };
  }

  const acao = getHeader("access-control-allow-origin").trim();
  const directCors = acao === "*" || /^https?:\/\//i.test(acao);
  return { directOk: true, directCors };
}

export function applyDirectSourceMetadata(src, targetUrl = "", directStats = null) {
  if (!src || typeof src !== "object") return src;
  const cleanTarget = String(targetUrl || src.directUrl || "").trim();
  const proxyBackup =
    String(src.proxyUrl || "").trim() ||
    (String(src.url || "").startsWith("/api/") ? String(src.url) : "");

  if (isHlsMediaSource(src) || !cleanTarget || isKnownProtectedMediaHost(cleanTarget)) {
    return {
      ...src,
      ...(proxyBackup && src.url !== proxyBackup ? { url: proxyBackup } : {}),
      ...(proxyBackup ? { proxyUrl: proxyBackup } : {}),
      directPlayback: false,
      directCors: false
    };
  }

  if (directStats && directStats.directOk === false) {
    return {
      ...src,
      ...(proxyBackup ? { url: proxyBackup, proxyUrl: proxyBackup } : {}),
      directPlayback: false,
      directCors: false
    };
  }

  const directAllowed = Boolean(
    (directStats && directStats.directOk === true) ||
    (!directStats && isKnownDirectSafeMp4Host(cleanTarget))
  );
  if (!directAllowed) {
    return src;
  }

  return {
    ...src,
    url: cleanTarget,
    directUrl: cleanTarget,
    ...(proxyBackup ? { proxyUrl: proxyBackup } : {}),
    directPlayback: true,
    directCors: Boolean(directStats ? directStats.directCors : isKnownDirectSafeMp4Host(cleanTarget))
  };
}
