/* Only Drama — 8Stream provider adapter (disabled scaffold)
 * Source reference: https://github.com/himanshu8443/8StreamApi
 *
 * This adapter intentionally makes NO requests to 8StreamApi and does not
 * resolve or play third-party streams. Enable only after written permission
 * for the video catalogue and authorization to use the provider endpoints.
 */
(() => {
  "use strict";

  const CONFIG = Object.freeze({
    provider: "8stream",
    enabled: true,
    rightsVerified: false,
    apiBaseUrl: ""
  });

  const LANGUAGE_PRIORITY = Object.freeze([
    "hindi-dubbed",
    "bengali",
    "english"
  ]);

  function normalizeLanguage(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "unknown";
    if (/hindi|हिन्दी|हिंदी/.test(text) && /dub|dubbed|ডাব/.test(text)) {
      return "hindi-dubbed";
    }
    if (/^hi$|hindi|हिन्दी|हिंदी/.test(text)) return "hindi";
    if (/bengali|bangla|বাংলা|বангла/.test(text)) return "bengali";
    if (/^en$|english/.test(text)) return "english";
    return text.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  }

  function languageRank(value) {
    const language = normalizeLanguage(value);
    const index = LANGUAGE_PRIORITY.indexOf(language);
    return index === -1 ? LANGUAGE_PRIORITY.length : index;
  }

  function rankLanguageCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
      .map((item, index) => ({ item, index, rank: languageRank(
        item && (item.language || item.lang || item.audioLanguage || item.title)
      ) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(entry => entry.item);
  }

  function isAvailable() {
    return CONFIG.enabled && CONFIG.rightsVerified && /^https:\/\//i.test(CONFIG.apiBaseUrl);
  }

  async function getMediaInfo() {
    return {
      success: false,
      provider: CONFIG.provider,
      disabled: true,
      message: "Provider disabled: rights and endpoint authorization have not been verified."
    };
  }

  async function getSeasonList() {
    return {
      success: false,
      provider: CONFIG.provider,
      disabled: true,
      message: "Provider disabled: rights and endpoint authorization have not been verified."
    };
  }

  async function getStream() {
    return {
      success: false,
      provider: CONFIG.provider,
      disabled: true,
      message: "Stream resolution is disabled until the content and provider are authorized."
    };
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
    getStream
  });
})();
