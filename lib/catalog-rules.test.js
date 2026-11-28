import test from "node:test";
import assert from "node:assert/strict";
import {
  isNigerianContent,
  isUpcomingUnreleased,
  isNoiseVideoClip,
  isMusicOrClipSubject,
  strictTitleMatchScore,
  dedupeRepeatedTitleYear,
  parseEpisodeRangeFromTitle,
  splitSearchTitleVariants,
  expandSearchQueryVariants,
  cleanYoutubeTrailerTitle,
  scoreSearchMatch,
  collectTitleSuggestions,
  CATALOG_PAGE_SIZE,
  paginateCatalogItems
} from "./catalog-rules.js";

test("isNigerianContent filters Nigerian items & sections without hiding Indian/Bangla titles", () => {
  assert.equal(isNigerianContent({ title: "Pushpa", country: "Nigeria" }), true);
  assert.equal(isNigerianContent({ title: "Toofan Ft. Patoranking", country: "Nigeria" }), true);
  assert.equal(isNigerianContent({ title: "AKOTAGIRI", country: "" }), true);
  assert.equal(isNigerianContent({ title: "Random Drama" }, "Nollywood Movie"), true);
  assert.equal(isNigerianContent({ title: "Random Show" }, "Must-watch Black Shows"), true);
  assert.equal(isNigerianContent({ title: "Random Bet" }, "Bet+"), true);

  assert.equal(isNigerianContent({ title: "Pushpa: The Rule - Part 2", country: "India", language: "Hindi" }), false);
  assert.equal(isNigerianContent({ title: "Toofan", country: "Bangladesh", language: "Bengali" }), false);
  assert.equal(isNigerianContent({ title: "Borbaad", country: "Bangladesh", language: "Bengali" }), false);
  assert.equal(isNigerianContent({ title: "Mirzapur", country: "India", language: "Hindi" }, "Popular Series"), false);
});

test("isUpcomingUnreleased strictly matches unreleased or future titles, never already-released 2026 titles", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");

  assert.equal(isUpcomingUnreleased({ title: "Future Film", hasResource: false, releaseDate: "2026-12-20" }, now), true);
  assert.equal(isUpcomingUnreleased({ title: "Distant Movie", hasResource: true, releaseDate: "2026-12-18" }, now), true);
  assert.equal(isUpcomingUnreleased({ title: "Unreleased Show", isUpcoming: true }, now), true);

  // Already-released 2026 or older titles with missing streams must NOT be labeled Upcoming
  assert.equal(isUpcomingUnreleased({ title: "Drummer Boy", hasResource: false, releaseDate: "2026-11-06" }, now), false);
  assert.equal(isUpcomingUnreleased({ title: "Your Ground", hasResource: false, releaseDate: "2026-11-01" }, now), false);
  assert.equal(isUpcomingUnreleased({ title: "Who the Hell Is Hamish?", hasResource: false, releaseDate: "2026-01-01" }, now), false);
  assert.equal(isUpcomingUnreleased({ title: "The Odyssey", hasResource: false, year: "2026" }, now), false);
  assert.equal(isUpcomingUnreleased({ title: "Old Show", hasResource: false, year: "2024" }, now), false);

  assert.equal(
    isUpcomingUnreleased({ title: "Shot Boot Three / Char Bicchu Aar Max (2026)", hasResource: true, releaseDate: "2026-04-17" }, now),
    false
  );
  assert.equal(
    isUpcomingUnreleased({ title: "The Hunger Games: Sunrise on the Reaping", hasResource: true, releaseDate: "2026-11-20" }, now),
    false
  );
  assert.equal(
    isUpcomingUnreleased({ title: "2026 Movie No Date", hasResource: true, year: "2026" }, now),
    false
  );
});

test("expandSearchQueryVariants expands compound terms like spiderman -> Spider-Man", () => {
  const variants = expandSearchQueryVariants("spiderman");
  assert.ok(variants.includes("spiderman"));
  assert.ok(variants.includes("Spider-Man"));
  assert.ok(variants.includes("Spider Man"));

  assert.ok(scoreSearchMatch({ title: "Spider-Man: Brand New Day", hasResource: true }, "spiderman") > 150);
  const suggs = collectTitleSuggestions("spiderman", {
    items: [{ title: "Spider-Man: Brand New Day", hasResource: true }]
  });
  assert.ok(suggs.includes("Spider-Man: Brand New Day"));
});

test("splitSearchTitleVariants splits multi-title strings and strips noisy tags", () => {
  const variants = splitSearchTitleVariants("Shot Boot Three / Char Bicchu Aar Max (2026) [ORG Bengali Dubbed] HDRip");
  assert.deepEqual(variants, [
    "Shot Boot Three",
    "Char Bicchu Aar Max",
    "Shot Boot Three Char Bicchu Aar Max"
  ]);

  const single = splitSearchTitleVariants("Mirzapur (2024) S03 Hindi Dubbed 1080p WEB-DL");
  assert.ok(single.includes("Mirzapur"));
});

test("scoreSearchMatch matches 2-3 char/word prefixes, ranks real movies above songs/lectures, and rejects unrelated titles", () => {
  assert.ok(scoreSearchMatch({ title: "Mirzapur" }, "mir") > 0);
  assert.ok(scoreSearchMatch({ title: "Shot Boot Three" }, "shot bo") > 0);
  assert.ok(scoreSearchMatch({ title: "Pushpa: The Rule - Part 2" }, "pushpa") > 0);

  const realMovieScore = scoreSearchMatch({ title: "Pushpa: The Rule - Part 2", country: "India", hasResource: true }, "pushpa");
  const songClipScore = scoreSearchMatch({ title: "Pushpa: Jaago Jaago Bakre (Video Song) | Allu Arjun", country: "India", hasResource: true }, "pushpa");
  assert.equal(isNoiseVideoClip({ title: "Pushpa: Jaago Jaago Bakre (Video Song)" }), true);
  assert.equal(isNoiseVideoClip({ title: "Pushpa: The Rule - Part 2" }), false);
  assert.ok(realMovieScore > songClipScore);

  // Critical regression check: unrelated popular shows MUST return 0!
  assert.equal(scoreSearchMatch({ title: "Stranger Things", genre: "Sci-Fi, Horror", country: "United States" }, "mirzapur"), 0);
  assert.equal(scoreSearchMatch({ title: "Friends", genre: "Comedy", country: "United States" }, "borbaad"), 0);
  assert.equal(scoreSearchMatch({ title: "The Boys", genre: "Action", country: "United States" }, "shot boot"), 0);
  assert.ok(scoreSearchMatch({ title: "Spider-Man: Brand New Day (2026)" }, "Spider Man") > 0);
  assert.equal(scoreSearchMatch({ title: "Ice Cream Man (2026)" }, "Spider Man"), 0);
  assert.equal(scoreSearchMatch({ title: "Mangolik (2026)" }, "Spider Man"), 0);
});

test("collectTitleSuggestions returns full-title autocomplete suggestions cleanly", () => {
  const suggestions = collectTitleSuggestions("mir", {
    suggestWords: ["mirzapur", "mirzapur season 3", "mirror mirror"],
    items: [
      { title: "Mirzapur: The Movie", hasResource: true },
      { title: "Pushpa", country: "Nigeria" },
      { title: "Stranger Things" }
    ]
  });
  assert.ok(suggestions.some(s => /mirzapur/i.test(s)));
  assert.equal(suggestions.some(s => /stranger things/i.test(s)), false);
  assert.equal(suggestions.some(s => /pushpa/i.test(s)), false);
});

test("strictTitleMatchScore blocks substring hijacks, year mismatches, and wrong-movie bridges and matches cleaned YouTube trailers", () => {
  // Exact regression: "Premik Premika aar Petnee (2026)" vs "Premika (2020)"
  assert.equal(
    strictTitleMatchScore("Premik Premika aar Petnee", "Premika", { queryYear: "2026", candidateYear: "2020" }),
    0
  );
  assert.ok(
    strictTitleMatchScore("Premik Premika aar Petnee", "Premika") < 0.5
  );

  // Exact regression: "Shot Boot Three (2026)" vs "Das Boot (1981)"
  assert.equal(
    strictTitleMatchScore("Shot Boot Three", "Das Boot", { queryYear: "2026", candidateYear: "1981" }),
    0
  );
  assert.ok(strictTitleMatchScore("Shot Boot Three", "Das Boot") < 0.5);

  // YouTube trailer title cleanup for The Odyssey (2026)
  assert.equal(cleanYoutubeTrailerTitle("The Odyssey | Official New Trailer"), "The Odyssey");
  assert.ok(
    strictTitleMatchScore(
      "The Odyssey",
      cleanYoutubeTrailerTitle("THE ODYSSEY Official Final Trailer (2026) Matt Damon, Tom Holland, Christopher Nolan"),
      { queryYear: "2026", candidateYear: "2026" }
    ) >= 0.9
  );

  // Genuine MovieBox matches pass with high score
  assert.ok(strictTitleMatchScore("The Yellow Sea", "The Yellow Sea", { queryYear: "2010", candidateYear: "2010" }) >= 0.9);
  assert.ok(strictTitleMatchScore("Rendel: Cycle of Revenge", "Rendel: Cycle of Revenge", { queryYear: "2024", candidateYear: "2024" }) >= 0.9);
  assert.ok(strictTitleMatchScore("Borbaad", "Borbaad", { queryYear: "2025", candidateYear: "2025" }) >= 0.9);
});

test("isMusicOrClipSubject flags Pop & subjectType=6 music tracks without flagging anime", () => {
  assert.equal(isMusicOrClipSubject({ title: "Premika", genre: "Pop", subjectType: 1 }), true);
  assert.equal(isMusicOrClipSubject({ title: "Premika", genre: "Bollywood", subjectType: 6 }), true);
  assert.equal(isMusicOrClipSubject({ title: "Track", genre: "Pop", description: "Provided to YouTube by MusicBD" }), true);
  assert.equal(isMusicOrClipSubject({ title: "Attack on Titan", genre: "Anime, Action", subjectType: 6 }), false);
  assert.equal(isMusicOrClipSubject({ title: "Jujutsu Kaisen", genre: "Anime", subjectType: 2 }), false);
  assert.equal(isMusicOrClipSubject({ title: "The Yellow Sea", genre: "Crime, Thriller", subjectType: 1 }), false);
  assert.equal(isMusicOrClipSubject({ title: "Agent Kim Reactivated", genre: "Action, Thriller", subjectType: 2 }), false);
});

test("dedupeRepeatedTitleYear and parseEpisodeRangeFromTitle normalize MLBD titles cleanly", () => {
  assert.equal(
    dedupeRepeatedTitleYear("Agent Kim Reactivated (2026) S01 [Ep 01-02 Added] (2026)"),
    "Agent Kim Reactivated (2026) S01 [Ep 01-02 Added]"
  );
  assert.equal(
    dedupeRepeatedTitleYear("Premik Premika aar Petnee (2026) S01 [Ep 01-37 ORG Bangla Dubbed Added]"),
    "Premik Premika aar Petnee (2026) S01 [Ep 01-37 ORG Bangla Dubbed Added]"
  );

  assert.deepEqual(
    parseEpisodeRangeFromTitle("Agent Kim Reactivated (2026) S01 [Ep 01-02 Added]"),
    { season: 1, startEp: 1, endEp: 2 }
  );
  assert.deepEqual(
    parseEpisodeRangeFromTitle("Premik Premika aar Petnee (2026) S01 [Ep 01-37 ORG Bangla Dubbed Added]"),
    { season: 1, startEp: 1, endEp: 37 }
  );
  assert.equal(
    parseEpisodeRangeFromTitle("Shot Boot Three / Char Bicchu Aar Max (2026) [ORG Bengali Dubbed]"),
    null
  );
});

test("multi-season series bridge across premiere years while keeping movie year mismatch strict", () => {
  // Exact multi-season series must match despite year difference between premiere (2018) and latest season (2026)
  assert.ok(
    strictTitleMatchScore("Bachelor Point (2026) S05", "Bachelor Point S1-S5", {
      queryYear: "2026",
      candidateYear: "2018",
      isSeries: true
    }) >= 0.85
  );
  assert.ok(
    strictTitleMatchScore("Ethos (2026) S02", "Ethos S1-S2", {
      queryYear: "2026",
      candidateYear: "2020",
      isSeries: true
    }) >= 0.85
  );
  assert.ok(
    strictTitleMatchScore("Heart Beat (2026) S03", "Heart Beat S1-S3", {
      queryYear: "2026",
      candidateYear: "2024",
      isSeries: true
    }) >= 0.85
  );

  // Diacritics & trailing release language tags
  assert.ok(
    strictTitleMatchScore("Siccîn 9", "Siccin 9", { queryYear: "2026", candidateYear: "2026" }) >= 0.95
  );
  assert.deepEqual(splitSearchTitleVariants("Nina (2024) Hindi ORG"), ["Nina"]);
  assert.deepEqual(splitSearchTitleVariants("Vacancy 2: The First Cut (2008) Hindi ORG"), [
    "Vacancy 2: The First Cut",
    "Vacancy 2"
  ]);

  // Movie remakes & wrong-title series still return 0
  assert.equal(
    strictTitleMatchScore("The Odyssey", "The Odyssey", { queryYear: "2026", candidateYear: "2016", isSeries: false }),
    0
  );
  assert.equal(
    strictTitleMatchScore("Premik Premika aar Petnee (2026) S01", "Premika", {
      queryYear: "2026",
      candidateYear: "2020",
      isSeries: true
    }),
    0
  );
});

test("paginateCatalogItems slices merged lists strictly to 30 items per page with consistent totals", () => {
  assert.equal(CATALOG_PAGE_SIZE, 30);

  const items150 = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: `Title ${i + 1}` }));
  const p1 = paginateCatalogItems(items150, 1, 30, { upstreamHasMore: false });
  const p2 = paginateCatalogItems(items150, 2, 30, { upstreamHasMore: false });
  const p5 = paginateCatalogItems(items150, 5, 30, { upstreamHasMore: false });

  assert.equal(p1.items.length, 30);
  assert.equal(p1.items[0].id, 1);
  assert.equal(p1.items[29].id, 30);
  assert.equal(p1.perPage, 30);
  assert.equal(p1.totalCount, 150);
  assert.equal(p1.totalPages, 5);
  assert.equal(p1.maxPage, 5);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.isExactTotal, true);

  assert.equal(p2.items.length, 30);
  assert.equal(p2.items[0].id, 31);
  assert.equal(p2.items[29].id, 60);
  assert.equal(p2.hasMore, true);

  // Zero overlap between page 1 and page 2
  const p1Ids = new Set(p1.items.map(x => x.id));
  assert.equal(p2.items.some(x => p1Ids.has(x.id)), false);

  assert.equal(p5.items.length, 30);
  assert.equal(p5.items[0].id, 121);
  assert.equal(p5.items[29].id, 150);
  assert.equal(p5.hasMore, false);

  // Partial last page (31 items -> page 1 = 30, page 2 = 1)
  const items31 = items150.slice(0, 31);
  const partial1 = paginateCatalogItems(items31, 1, 30, { upstreamHasMore: false });
  const partial2 = paginateCatalogItems(items31, 2, 30, { upstreamHasMore: false });
  assert.equal(partial1.items.length, 30);
  assert.equal(partial1.totalCount, 31);
  assert.equal(partial1.totalPages, 2);
  assert.equal(partial1.hasMore, true);
  assert.equal(partial2.items.length, 1);
  assert.equal(partial2.items[0].id, 31);
  assert.equal(partial2.hasMore, false);

  // Upstream hasMore estimation keeps totalCount & totalPages consistent
  const est = paginateCatalogItems(items150.slice(0, 80), 1, 30, {
    upstreamHasMore: true,
    estimatedTotalCount: 305
  });
  assert.equal(est.items.length, 30);
  assert.equal(est.totalCount, 305);
  assert.equal(est.totalPages, Math.ceil(305 / 30));
  assert.equal(est.maxPage, est.totalPages);
  assert.equal(est.hasMore, true);
  assert.equal(est.isExactTotal, false);
});


