export function parseSearchQuery(query: string) {
  const phrases: string[] = [];
  const regex = /"([^"]+)"/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    phrases.push(match[1]);
  }

  return {
    cleanQuery: query.replace(/"/g, " ").trim(),
    phrases,
  };
}

/**
 * Returns distinct search terms and quoted phrases ordered longest to shortest.
 * Used for highlight tokenization in search results.
 */
export function getSearchTerms(query: string): string[] {
  if (!query || typeof query !== "string") return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { phrases } = parseSearchQuery(trimmed);
  const withoutQuotes = trimmed.replace(/"([^"]*)"/g, " ");
  const words = withoutQuotes
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const term of [...phrases, ...words]) {
    const lower = term.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      terms.push(term);
    }
  }

  return terms.sort((a, b) => b.length - a.length);
}

export function getSearchFilter({
  channel,
  user,
  threads = "all",
}: {
  channel?: string;
  user?: string;
  threads?: "all" | "roots" | "replies";
}) {
  if (!channel && !user && (!threads || threads === "all")) return undefined;

  return (result: any) => {
    if (channel && result.c !== channel) return false;
    if (user && result.u !== user) return false;
    if (threads === "roots" && result.p) return false;
    if (threads === "replies" && !result.p) return false;
    return true;
  };
}

export function filterResultsByPhrases<T extends { m?: string }>(
  results: T[],
  phrases: string[],
) {
  if (phrases.length === 0) return results;

  return results.filter((result) => {
    const message = typeof result.m === "string" ? result.m.toLowerCase() : "";
    return phrases.every((phrase) => message.includes(phrase.toLowerCase()));
  });
}

export function sortSearchResults<T extends { t?: string }>(
  results: T[],
  sort?: string,
  hasCleanQuery?: boolean,
): T[] {
  if (sort === "newest") {
    return [...results].sort((a, b) => {
      const ta = a.t || "";
      const tb = b.t || "";
      return tb < ta ? -1 : tb > ta ? 1 : 0;
    });
  }
  if (sort === "oldest") {
    return [...results].sort((a, b) => {
      const ta = a.t || "";
      const tb = b.t || "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }
  if (!hasCleanQuery) {
    return [...results].sort((a, b) => {
      const ta = a.t || "";
      const tb = b.t || "";
      return tb < ta ? -1 : tb > ta ? 1 : 0;
    });
  }
  return results;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

export function extractHighlightTerms(query: string): string[] {
  if (!query || !query.trim()) return [];

  const phrases: string[] = [];
  const rest = query.replace(/"([^"]*)"/g, (_whole, phrase: string) => {
    if (phrase.trim()) phrases.push(phrase.trim());
    return " ";
  });
  const words = rest.split(/\s+/).filter((w) => w.length > 0);

  const seen = new Set<string>();
  const terms: string[] = [];

  for (const item of [...phrases, ...words]) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      terms.push(trimmed);
    }
  }

  return terms.sort((a, b) => b.length - a.length);
}

export function splitSearchHighlight(
  text: string,
  query: string,
): HighlightSegment[] {
  if (!text) return [];
  if (!query || !query.trim()) {
    return [{ text, match: false }];
  }

  const terms = extractHighlightTerms(query);
  if (terms.length === 0) {
    return [{ text, match: false }];
  }

  const escaped = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");

  const parts = text.split(regex);
  const segments: HighlightSegment[] = [];

  for (const part of parts) {
    if (!part) continue;
    const isMatch = terms.some(
      (term) => term.toLowerCase() === part.toLowerCase(),
    );
    segments.push({ text: part, match: isMatch });
  }

  return segments.length > 0 ? segments : [{ text, match: false }];
}

