import { describe, expect, it } from "vitest";

import { buildSearchSql, toMatchExpression } from "./search-sql.js";

describe("the FTS match expression", () => {
  it("ands the words together and matches on prefix", () => {
    // What the old client-side index did: every word must appear, and a word
    // may be the start of a longer one, so "kokou" finds "kokouspullaa".
    expect(toMatchExpression("kokous pulla")).toBe('"kokous"* AND "pulla"*');
  });

  it("keeps a quoted phrase as a phrase", () => {
    expect(toMatchExpression('"iso juttu" kokous')).toBe(
      '"iso juttu" AND "kokous"*',
    );
  });

  it("quotes what would otherwise be FTS syntax", () => {
    // A colon, a hyphen or a bracket is an operator to FTS5 and a normal
    // character to a person typing a search. Quoting every term means the
    // query is read the way it was typed.
    expect(toMatchExpression("foo:bar -baz (x)")).toBe(
      '"foo:bar"* AND "-baz"* AND "(x)"*',
    );
  });

  it("survives a quote inside a term", () => {
    // Doubling is how a quote is escaped inside an FTS5 string; getting this
    // wrong is a syntax error thrown at the person searching.
    expect(toMatchExpression('sano "hei" nyt')).toBe(
      '"hei" AND "sano"* AND "nyt"*',
    );
    expect(toMatchExpression('it"s')).toBe('"it""s"*');
  });

  it("is nothing at all when there is nothing to match on", () => {
    expect(toMatchExpression("   ")).toBeUndefined();
    expect(toMatchExpression('""')).toBeUndefined();
  });
});

describe("the search query", () => {
  it("searches the text when there is text", () => {
    const { sql, params } = buildSearchSql({ query: "kokous" })!;

    expect(sql).toContain("messages_fts match ?");
    expect(sql).toContain("order by rank");
    expect(params[0]).toBe('"kokous"*');
  });

  it("filters by channel and by person", () => {
    const { sql, params } = buildSearchSql({
      query: "kokous",
      channel: "C1",
      user: "U1",
    })!;

    expect(sql).toContain("m.channel_id = ?");
    expect(sql).toContain("m.user_id = ?");
    expect(params).toEqual(['"kokous"*', "C1", "U1", 50]);
  });

  it("lists newest first when only the filters are set", () => {
    // The old page called this the wildcard search: no text, just "everything
    // this person said". Relevance means nothing without a query, so it is
    // ordered by time instead.
    const { sql, params } = buildSearchSql({ query: "", user: "U1" })!;

    expect(sql).not.toContain("messages_fts");
    expect(sql).toContain("order by m.timestamp desc");
    expect(params).toEqual(["U1", 50]);
  });

  it("is nothing at all with neither text nor filter", () => {
    expect(buildSearchSql({ query: "" })).toBeUndefined();
  });

  it("finds the page a result is on, and a reply's parent's page", () => {
    // The page index holds top-level timestamps only, so a reply's own
    // timestamp would land on whatever page range contains it rather than on
    // the page its thread is rendered in.
    const { sql } = buildSearchSql({ query: "kokous" })!;

    expect(sql).toContain("min(p.page)");
    expect(sql).toContain("coalesce(m.parent_timestamp, m.timestamp)");
  });

  it("asks for one page of results and no more", () => {
    const { sql, params } = buildSearchSql({ query: "kokous", limit: 25 })!;

    expect(sql).toContain("limit ?");
    expect(params[params.length - 1]).toBe(25);
  });
});

describe("the date range", () => {
  // Epoch seconds, because that is what a Slack timestamp is. The page turns
  // the two date pickers into these; converting a date to a moment needs a
  // timezone, and the only defensible one is the reader's own - the same
  // clock the timestamps beside the results are printed on.
  const AFTER = 1735686000; // 2025-01-01 00:00 +02:00
  const BEFORE = 1738364400; // 2025-02-01 00:00 +02:00

  it("bounds the search at both ends", () => {
    const { sql, params } = buildSearchSql({
      query: "kokous",
      after: AFTER,
      before: BEFORE,
    })!;

    expect(sql).toContain("m.timestamp >= ?");
    expect(sql).toContain("m.timestamp < ?");
    expect(params).toEqual(['"kokous"*', "1735686000", "1738364400", 50]);
  });

  it("compares as text, so the index on the column can answer", () => {
    // `cast(m.timestamp as real) >= ?` reads correctly and then scans the
    // whole table, because the index is on the text column. Over range
    // requests a scan means downloading the corpus, which is the one thing
    // this page must never do.
    const { sql, params } = buildSearchSql({ query: "", after: AFTER })!;

    expect(sql).not.toContain("cast(m.timestamp");
    expect(params[0]).toBe("1735686000");
    expect(typeof params[0]).toBe("string");
  });

  it("takes one end without the other", () => {
    expect(buildSearchSql({ query: "", after: AFTER })!.sql).not.toContain(
      "m.timestamp < ?",
    );
    expect(buildSearchSql({ query: "", before: BEFORE })!.sql).not.toContain(
      "m.timestamp >= ?",
    );
  });

  it("is a search on its own, with nothing else set", () => {
    // "What was said that week" is a real question, and before this the page
    // had no way to ask it.
    const query = buildSearchSql({ query: "", after: AFTER, before: BEFORE });

    expect(query).toBeDefined();
    expect(query!.sql).toContain("order by m.timestamp desc");
  });
});

describe("search result sorting", () => {
  it("defaults to relevance when searching text", () => {
    const { sql } = buildSearchSql({ query: "kokous" })!;
    expect(sql).toContain("order by rank");
  });

  it("defaults to newest first when only filtering without text", () => {
    const { sql } = buildSearchSql({ query: "", user: "U1" })!;
    expect(sql).toContain("order by m.timestamp desc");
  });

  it("sorts by newest first when requested with text query", () => {
    const { sql } = buildSearchSql({ query: "kokous", sort: "newest" })!;
    expect(sql).toContain("order by m.timestamp desc");
    expect(sql).not.toContain("order by rank");
  });

  it("sorts by oldest first when requested with text query", () => {
    const { sql } = buildSearchSql({ query: "kokous", sort: "oldest" })!;
    expect(sql).toContain("order by m.timestamp asc");
    expect(sql).not.toContain("order by rank");
  });

  it("sorts by oldest first when requested without text query", () => {
    const { sql } = buildSearchSql({ query: "", user: "U1", sort: "oldest" })!;
    expect(sql).toContain("order by m.timestamp asc");
  });

  it("sorts by relevance when explicitly requested with score or relevance", () => {
    const byScore = buildSearchSql({ query: "kokous", sort: "score" })!;
    expect(byScore.sql).toContain("order by rank");

    const byRelevance = buildSearchSql({ query: "kokous", sort: "relevance" })!;
    expect(byRelevance.sql).toContain("order by rank");
  });
});
