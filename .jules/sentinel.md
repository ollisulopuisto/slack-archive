# Sentinel's Journal - Critical Security Learnings

## 2026-11-01 - Path Traversal in Channel Upload File Paths
**Vulnerability:** `getChannelUploadFilePath(channelId, fileName)` constructed upload destination paths via direct `path.join(FILES_DIR, channelId, fileName)` without sanitization, allowing arbitrary file write / path traversal outside `FILES_DIR` via malicious `channelId` or `fileName` values.
**Learning:** Functions generating file storage paths in `src/config.ts` must consistently use `sanitizePathSegment` and verify that the resolved path starts with the expected base directory.
**Prevention:** Apply `sanitizePathSegment` and enforce root directory prefix containment checks (`path.resolve(target).startsWith(baseDir)`) across all file path generator functions.
