/**
 * What the search page asks the database, shared with the browser.
 *
 * The page used to ship every message to the reader and index them there: a
 * hundred megabytes of JavaScript, a million objects, and a MiniSearch index
 * built on the main thread. Desktops survived it. An iPhone did not - Safari
 * killed the tab before the first query, on the same WiFi that served the
 * pages fine.
 *
 * So the index stays a database and the browser reads the parts of it that a
 * query touches, over HTTP range requests. These are the queries it sends, in
 * a module rather than in the page, because a query that decides which
 * messages a reader may see is worth testing.
 */

export interface SearchRequest {
  query: string;
  channel?: string;
  user?: string;
  /** Epoch seconds; messages at or after this moment. */
  after?: number;
  /** Epoch seconds; messages strictly before this moment. */
  before?: number;
  limit?: number;
  sort?: "score" | "relevance" | "newest" | "oldest" | string;
  threads?: "all" | "roots" | "replies";
}

export interface SearchSql {
  sql: string;
  params: Array<string | number>;
}

/** Every quoted "phrase" in the query, and what is left once they are gone. */
function splitPhrases(query: string) {
  const phrases: string[] = [];
  const rest = query.replace(/"([^"]*)"/g, (_whole, phrase: string) => {
    if (phrase.trim()) phrases.push(phrase.trim());
    return " ";
  });

  return { phrases, rest };
}

/** An FTS5 string literal: the only escape it has is a doubled quote. */
function quoted(term: string) {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * The query as FTS5 reads it.
 *
 * Every term is quoted, because a colon, a hyphen or a bracket is an operator
 * to FTS5 and an ordinary character to somebody typing a search - unquoted,
 * `foo:bar` is a column filter and `-baz` is a syntax error thrown in the
 * reader's face. Words match on prefix and are ANDed, which is what the old
 * client-side index did; a quoted phrase stays a phrase.
 */
export function toMatchExpression(query: string): string | undefined {
  const { phrases, rest } = splitPhrases(query);
  const words = rest.split(/\s+/).filter((word) => word.trim().length > 0);
  const terms = [
    ...phrases.map((phrase) => quoted(phrase)),
    ...words.map((word) => `${quoted(word)}*`),
  ];

  return terms.length > 0 ? terms.join(" AND ") : undefined;
}

/**
 * An epoch second as the archive writes it: ten digits, no fraction.
 *
 * Padded because the comparison is lexicographic - a nine-digit bound would
 * sort above every real timestamp and quietly match nothing.
 */
function bound(seconds: number) {
  return String(Math.floor(seconds)).padStart(10, "0");
}

/** Which page of the archive a message is rendered on. */
const PAGE_OF_MESSAGE = `(select min(p.page) from pages p
       where p.channel_id = m.channel_id
          and p.oldest_ts < coalesce(m.parent_timestamp, m.timestamp))`;

const COLUMNS = `m.id id, m.channel_id c, m.user_id u, m.timestamp t,
      m.parent_timestamp p, m.message m_text, ${PAGE_OF_MESSAGE} page`;

/**
 * The query for one search, or nothing when there is nothing to ask.
 *
 * With text and default sort, the full-text index answers and orders by relevance.
 * With only filters set - everything this person said, everything in this channel -
 * there is no relevance to order by, so it is newest first.
 * If explicitly requested, results can be sorted newest first or oldest first.
 */
export function buildSearchSql(request: SearchRequest): SearchSql | undefined {
  const {
    channel,
    user,
    after,
    before,
    sort,
    threads = "all",
    limit = 50,
  } = request;
  const match = toMatchExpression(request.query || "");
  const hasFilter = Boolean(
    channel || user || after || before || (threads && threads !== "all"),
  );

  if (!match && !hasFilter) {
    return undefined;
  }

  const params: Array<string | number> = [];
  const where: string[] = [];
  let from = "from messages m";

  if (match) {
    from = `from messages_fts f join messages m on m.id = f.id`;
    where.push("f.messages_fts match ?");
    params.push(match);
  }

  if (channel) {
    where.push("m.channel_id = ?");
    params.push(channel);
  }

  if (user) {
    where.push("m.user_id = ?");
    params.push(user);
  }

  if (threads === "roots") {
    where.push("m.parent_timestamp is null");
  } else if (threads === "replies") {
    where.push("m.parent_timestamp is not null");
  }

  // Compared as TEXT, deliberately. A Slack timestamp is ten digits, a dot and
  // six more, so the string order and the numeric order are the same thing -
  // and the index is on the text column, which `cast(timestamp as real)` would
  // walk straight past. Over range requests, a scan is a download of the whole
  // corpus, which is the one thing this page exists to avoid.
  if (after) {
    where.push("m.timestamp >= ?");
    params.push(bound(after));
  }

  if (before) {
    where.push("m.timestamp < ?");
    params.push(bound(before));
  }

  let orderBy = match ? "rank" : "m.timestamp desc";
  if (sort === "newest") {
    orderBy = "m.timestamp desc";
  } else if (sort === "oldest") {
    orderBy = "m.timestamp asc";
  } else if (sort === "score" || sort === "relevance") {
    orderBy = match ? "rank" : "m.timestamp desc";
  }

  params.push(limit);

  return {
    sql: `select ${COLUMNS}
    ${from}
   where ${where.join(" and ")}
   order by ${orderBy}
   limit ?`,
    params,
  };
}
