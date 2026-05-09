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

export function getSearchFilter({
  channel,
  user,
}: {
  channel?: string;
  user?: string;
}) {
  if (!channel && !user) return undefined;

  return (result: any) => {
    if (channel && result.c !== channel) return false;
    if (user && result.u !== user) return false;
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
