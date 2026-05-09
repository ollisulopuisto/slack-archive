import { describe, it, expect, beforeEach } from "vitest";
import MiniSearch from "minisearch";

// Emulate the search logic used in bot.ts and search.html
function performSearch(
  miniSearch: MiniSearch,
  query: string,
  filters: { channel?: string; user?: string } = {},
) {
  // Extract quoted phrases
  const phrases: string[] = [];
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    phrases.push(match[1]);
  }

  const cleanQuery = query.replace(/"/g, " ").trim();

  const searchOptions: any = {
    combineWith: "AND",
    prefix: true,
  };

  if (filters.channel || filters.user) {
    searchOptions.filter = (result: any) => {
      let match = true;
      if (filters.channel) match = match && result.c === filters.channel;
      if (filters.user) match = match && result.u === filters.user;
      return match;
    };
  }

  let results: any[] = [];
  if (cleanQuery) {
    results = miniSearch.search(cleanQuery, searchOptions);
  } else if (filters.channel || filters.user) {
    // We don't support empty query searches in this simplified test helper
    results = [];
  }

  if (phrases.length > 0) {
    results = results.filter((result) => {
      const text = result.m.toLowerCase();
      return phrases.every((phrase) => text.includes(phrase.toLowerCase()));
    });
  }

  return results;
}

describe("Search Logic", () => {
  let miniSearch: MiniSearch;

  beforeEach(() => {
    miniSearch = new MiniSearch({
      idField: "t",
      fields: ["m"],
      storeFields: ["t", "u", "m", "c"],
    });

    miniSearch.addAll([
      { t: "1", m: "hello world", u: "u1", c: "c1" },
      { t: "2", m: "hello there", u: "u2", c: "c1" },
      { t: "3", m: "testing phrases here", u: "u1", c: "c2" },
      { t: "4", m: "phrase testing", u: "u2", c: "c2" },
    ]);
  });

  it("should find results with simple query", () => {
    const results = performSearch(miniSearch, "hello");
    expect(results).toHaveLength(2);
  });

  it("should support AND search logic", () => {
    const results = performSearch(miniSearch, "hello world");
    expect(results).toHaveLength(1);
    expect(results[0].t).toBe("1");
  });

  it("should support exact phrase search with quotes", () => {
    const results = performSearch(miniSearch, '"testing phrases"');
    expect(results).toHaveLength(1);
    expect(results[0].t).toBe("3");

    const noResults = performSearch(miniSearch, '"phrases testing"');
    expect(noResults).toHaveLength(0);
  });

  it("should filter by channel", () => {
    const results = performSearch(miniSearch, "hello", { channel: "c1" });
    expect(results).toHaveLength(2);

    const noResults = performSearch(miniSearch, "hello", { channel: "c2" });
    expect(noResults).toHaveLength(0);
  });

  it("should filter by user", () => {
    const results = performSearch(miniSearch, "hello", { user: "u1" });
    expect(results).toHaveLength(1);
    expect(results[0].t).toBe("1");
  });
});
