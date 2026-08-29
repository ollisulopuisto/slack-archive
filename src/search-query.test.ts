import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  getSearchFilter,
  filterResultsByPhrases,
  sortSearchResults,
  extractHighlightTerms,
  splitSearchHighlight,
} from "./search-query.js";

describe("parseSearchQuery", () => {
  it("extracts quoted phrases and clean query", () => {
    const res = parseSearchQuery('hello "great world" test');
    expect(res.phrases).toEqual(["great world"]);
    expect(res.cleanQuery).toBe("hello  great world  test");
  });

  it("handles queries without phrases", () => {
    const res = parseSearchQuery("simple query");
    expect(res.phrases).toEqual([]);
    expect(res.cleanQuery).toBe("simple query");
  });
});

describe("extractHighlightTerms", () => {
  it("extracts both phrases and words sorted by length", () => {
    const terms = extractHighlightTerms('hello "big world" a');
    expect(terms).toEqual(["big world", "hello", "a"]);
  });

  it("returns empty array for empty or blank query", () => {
    expect(extractHighlightTerms("")).toEqual([]);
    expect(extractHighlightTerms("   ")).toEqual([]);
    expect(extractHighlightTerms('""')).toEqual([]);
  });

  it("deduplicates terms ignoring case", () => {
    const terms = extractHighlightTerms("test TEST");
    expect(terms).toEqual(["test"]);
  });
});

describe("splitSearchHighlight", () => {
  it("splits matching text into matched and non-matched segments", () => {
    const segments = splitSearchHighlight("Say hello to the world!", "hello");
    expect(segments).toEqual([
      { text: "Say ", match: false },
      { text: "hello", match: true },
      { text: " to the world!", match: false },
    ]);
  });

  it("matches case-insensitively while preserving original case in text", () => {
    const segments = splitSearchHighlight("Hello HELLO hello", "hello");
    expect(segments).toEqual([
      { text: "Hello", match: true },
      { text: " ", match: false },
      { text: "HELLO", match: true },
      { text: " ", match: false },
      { text: "hello", match: true },
    ]);
  });

  it("matches quoted phrases as a unit", () => {
    const segments = splitSearchHighlight(
      "The quick brown fox jumps",
      '"quick brown"',
    );
    expect(segments).toEqual([
      { text: "The ", match: false },
      { text: "quick brown", match: true },
      { text: " fox jumps", match: false },
    ]);
  });

  it("escapes special regex characters in query safely", () => {
    const segments = splitSearchHighlight(
      "Price is $10.00 (discount)",
      '"$10.00 (discount)"',
    );
    expect(segments).toEqual([
      { text: "Price is ", match: false },
      { text: "$10.00 (discount)", match: true },
    ]);

    const wordSegments = splitSearchHighlight(
      "Array[0] + value?",
      "Array[0] value?",
    );
    expect(wordSegments).toEqual([
      { text: "Array[0]", match: true },
      { text: " + ", match: false },
      { text: "value?", match: true },
    ]);
  });

  it("returns the entire text as non-matched when query is empty or no terms match", () => {
    expect(splitSearchHighlight("Some text", "")).toEqual([
      { text: "Some text", match: false },
    ]);
    expect(splitSearchHighlight("Some text", "nomatch")).toEqual([
      { text: "Some text", match: false },
    ]);
  });

  it("returns empty array when text is empty", () => {
    expect(splitSearchHighlight("", "query")).toEqual([]);
  });
});

describe("getSearchFilter", () => {
  it("filters by channel and user", () => {
    const filter = getSearchFilter({ channel: "C1", user: "U1" });
    expect(filter).toBeDefined();
    expect(filter!({ c: "C1", u: "U1" })).toBe(true);
    expect(filter!({ c: "C1", u: "U2" })).toBe(false);
    expect(filter!({ c: "C2", u: "U1" })).toBe(false);
  });

  it("returns undefined when no filters are set", () => {
    expect(getSearchFilter({})).toBeUndefined();
  });
});

describe("filterResultsByPhrases", () => {
  it("keeps results matching all phrases case-insensitively", () => {
    const results = [
      { m: "Hello World and Universe" },
      { m: "Hello Only" },
      { m: "world universe" },
    ];
    const filtered = filterResultsByPhrases(results, ["World", "Universe"]);
    expect(filtered).toEqual([
      { m: "Hello World and Universe" },
      { m: "world universe" },
    ]);
  });
});

describe("sortSearchResults", () => {
  const items = [
    { t: "100.0", m: "first" },
    { t: "300.0", m: "third" },
    { t: "200.0", m: "second" },
  ];

  it("sorts newest first", () => {
    const res = sortSearchResults(items, "newest");
    expect(res.map((x) => x.t)).toEqual(["300.0", "200.0", "100.0"]);
  });

  it("sorts oldest first", () => {
    const res = sortSearchResults(items, "oldest");
    expect(res.map((x) => x.t)).toEqual(["100.0", "200.0", "300.0"]);
  });
});
