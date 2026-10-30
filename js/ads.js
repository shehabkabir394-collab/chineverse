/* AdSense slots stay disabled until the owner supplies approved IDs. */
(() => {
  const config = {
    client: "ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID",
    slots: {
      HOME_BANNER: "REPLACE_WITH_HOME_AD_UNIT_ID",
      DETAIL_TOP: "REPLACE_WITH_DETAIL_TOP_AD_UNIT_ID",
      DETAIL_BOTTOM: "REPLACE_WITH_DETAIL_BOTTOM_AD_UNIT_ID",
    },
  };
  if (!/^ca-pub-\d{16}$/.test(config.client)) return;
  const placements = [...document.querySelectorAll("[data-ad-slot]")].filter((el) => /^\d{6,}$/.test(config.slots[el.dataset.adSlot] || ""));
  if (!placements.length) return;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}`;
  script.onload = () => placements.forEach((el) => {
    const ad = document.createElement("ins");
    ad.className = "adsbygoogle";
    ad.style.display = "block";
    ad.dataset.adClient = config.client;
    ad.dataset.adSlot = config.slots[el.dataset.adSlot];
    ad.dataset.adFormat = "auto";
    ad.dataset.fullWidthResponsive = "true";
    el.replaceChildren(ad);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
    catch (error) { console.warn("Ad slot could not be initialized.", error); }
  });
  document.head.append(script);
})();
