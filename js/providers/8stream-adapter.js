/* Chineverse — 8Stream provider adapter.
 * Requests only the documented API for a supplied IMDb ID.
 * Keep rightsVerified true only while catalogue and endpoint authorization remain valid.
 */
(() => {
  "use strict";

  const CONFIG = Object.freeze({
    provider: "8stream",
    enabled: true,
    rightsVerified: true,
    apiBaseUrl: location.origin
  });

  const LANGUAGE_PRIORITY = Object.freeze([
    "hindi-dubbed",
    "bengali",
    "english",
    "hindi"
  ]);

  function normalizeLanguage(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "unknown";
    if (/hindi|हिन्दी|हिंदी/.test(text) && /dub|dubbed|ডাব/.test(text)) return "hindi-dubbed";
    if (/^hi$|hindi|हिन्दी|हिंदी/.test(text)) return "hindi";
    if (/bengali|bangla|বাংলা|বাঙ্গলা/.test(text)) return "bengali";
    if (/^en$|english/.test(text)) return "english";
    if (/tamil|தமிழ்/.test(text)) return "tamil";
    if (/telugu|తెలుగు/.test(text)) return "telugu";
    return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  }

  function languageRank(value) {
    const index = LANGUAGE_PRIORITY.indexOf(normalizeLanguage(value));
    return index < 0 ? LANGUAGE_PRIORITY.length : index;
  }

  function rankLanguageCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
      .map((item, index) => ({
        item,
        index,
        rank: languageRank(item && (item.language || item.lang || item.audioLanguage || item.title))
      }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(entry => entry.item);
  }

  function isAvailable() {
    return CONFIG.enabled && CONFIG.rightsVerified && /^https:\/\//i.test(CONFIG.apiBaseUrl);
  }

  function apiUrl(path, params) {
    const url = new URL(path, CONFIG.apiBaseUrl);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function requestJson(url, init) {
    let response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { Accept: "application/json", ...(init && init.headers) }
      });
    } catch (error) {
      return { success: false, provider: CONFIG.provider, error: "network_error", message: error.message };
    }
    let body;
    try {
      body = await response.json();
    } catch (_) {
      return { success: false, provider: CONFIG.provider, error: "invalid_json", status: response.status };
    }
    if (!response.ok || body.success !== true) {
      return {
        success: false,
        provider: CONFIG.provider,
        error: "provider_error",
        status: response.status,
        message: typeof body.message === "string" ? body.message : "Provider request failed."
      };
    }
    return { success: true, provider: CONFIG.provider, data: body.data || {} };
  }

  async function getMediaInfo(imdbId) {
    if (!isAvailable()) return { success: false, provider: CONFIG.provider, error: "provider_unavailable" };
    if (!/^tt\d+$/i.test(String(imdbId || ""))) {
      return { success: false, provider: CONFIG.provider, error: "invalid_imdb_id" };
    }
    const result = await requestJson(apiUrl("/api/8stream/media-info", { id: imdbId }));
    if (!result.success) return result;
    return {
      ...result,
      data: { ...result.data, playlist: rankLanguageCandidates(result.data.playlist) }
    };
  }

  async function getSeasonList(imdbId) {
    if (!isAvailable()) return { success: false, provider: CONFIG.provider, error: "provider_unavailable" };
    if (!/^tt\d+$/i.test(String(imdbId || ""))) {
      return { success: false, provider: CONFIG.provider, error: "invalid_imdb_id" };
    }
    return requestJson(apiUrl("/api/8stream/season-list", { id: imdbId }));
  }

  async function getStream(file, key) {
    if (!isAvailable()) return { success: false, provider: CONFIG.provider, error: "provider_unavailable" };
    if (typeof file !== "string" || !file || typeof key !== "string" || !key) {
      return { success: false, provider: CONFIG.provider, error: "missing_stream_parameters" };
    }
    const result = await requestJson(apiUrl("/api/8stream/get-stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, key })
    });
    if (!result.success) return result;
    const link = result.data.link;
    if (typeof link !== "string" || !/^https:\/\//i.test(link)) {
      return { success: false, provider: CONFIG.provider, error: "invalid_stream_url" };
    }
    return { ...result, data: { ...result.data, link } };
  }

  async function getPreferredStream(imdbId) {
    const media = await getMediaInfo(imdbId);
    if (!media.success) return media;
    const selected = media.data.playlist.find(item =>
      LANGUAGE_PRIORITY.includes(normalizeLanguage(item && item.title))
    );
    if (!selected) {
      return { success: false, provider: CONFIG.provider, error: "no_preferred_language", data: { playlist: media.data.playlist } };
    }
    const stream = await getStream(selected.file, media.data.key);
    if (!stream.success) return stream;
    return { ...stream, data: { ...stream.data, selectedLanguage: selected.title, selectedTrackId: selected.id } };
  }

  window.OnlyDramaProviders = window.OnlyDramaProviders || {};
  window.OnlyDramaProviders.eightStream = Object.freeze({
    config: CONFIG,
    isAvailable,
    languagePriority: LANGUAGE_PRIORITY,
    normalizeLanguage,
    languageRank,
    rankLanguageCandidates,
    getMediaInfo,
    getSeasonList,
    getStream,
    getPreferredStream
  });
})();
