/**
 * A Content-Security-Policy for a static archive page.
 *
 * Scripts must be files. Inline script is how stored XSS in a message becomes
 * a session of whoever opens the page. Styles stay `unsafe-inline` because the
 * bar charts set width as a style; that is not an XSS path. Forms may only
 * submit to this origin: the one form is the sidebar's search box.
 */
export function contentSecurityPolicy(options: {
  filesBaseUrl?: string;
}): string {
  const filesOrigin = originOf(options.filesBaseUrl || "");
  const extra = filesOrigin ? ` ${filesOrigin}` : "";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${extra}`,
    `media-src 'self'${extra}`,
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "child-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // The sidebar search box is a GET form to search.html on every page.
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function originOf(url: string): string {
  const trimmed = url.trim();

  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}
