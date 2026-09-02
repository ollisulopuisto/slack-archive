/** A Slack token as it may be printed: recognisable, not reusable. */
export function redactToken(token: string | undefined | null): string {
  if (!token) return "(none)";

  if (token.length < 10) return "(redacted)";

  return `${token.slice(0, 5)}…${token.slice(-4)}`;
}
