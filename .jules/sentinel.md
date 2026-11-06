# Sentinel's Journal - Critical Security Learnings

## 2026-11-01 - Path Traversal in Channel Upload File Paths
**Vulnerability:** `getChannelUploadFilePath(channelId, fileName)` constructed upload destination paths via direct `path.join(FILES_DIR, channelId, fileName)` without sanitization, allowing arbitrary file write / path traversal outside `FILES_DIR` via malicious `channelId` or `fileName` values.
**Learning:** Functions generating file storage paths in `src/config.ts` must consistently use `sanitizePathSegment` and verify that the resolved path starts with the expected base directory.
**Prevention:** Apply `sanitizePathSegment` and enforce root directory prefix containment checks (`path.resolve(target).startsWith(baseDir)`) across all file path generator functions.

## 2026-11-06 - Unvalidated URL Schemes in External File Links
**Vulnerability:** `externalFileUrl(file)` in `src/archived-files.ts` only filtered out Slack-hosted URLs, returning any other `file.url_private` unmodified. This allowed dangerous schemes like `javascript:` or `data:text/html` from untrusted Slack messages to be rendered directly into `<a href="...">` elements in `create-html.tsx`, opening the door to Cross-Site Scripting (XSS).
**Learning:** Even if HTML strings undergo escaping or markdown parsing, raw URL fields from message attachments/files can bypass markdown escaping when passed directly into JSX link attributes.
**Prevention:** Always validate URL schemes explicitly using standard `URL` parsing to only permit safe protocols (`http:`, `https:`) before using external URLs in anchor `href` attributes.
