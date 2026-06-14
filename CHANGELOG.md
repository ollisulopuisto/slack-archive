# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [26.06.14.122] - 2026-06-14

### Added
- Added fallback logic to the search file and database builders. If individual channel message files (like `CXXXXX.json`) are missing on the host running the archiver (e.g. on a VPS where only `search.js` was copied), it will fall back to using messages from the existing `search.js` instead of overwriting the search page and database with empty arrays.

## [26.06.14.121] - 2026-06-14

### Fixed
- Fixed an asynchronous race condition in `createSearchDatabase` where `getMessages` was awaited inside `db.serialize()`. This caused messages to be queued after the database connection was already closed, resulting in an empty database index (0 messages). We now await `getMessages` before entering the serialization block and use a dummy query to resolve the channel indexing promise when all inserts are completed.

## [26.06.14.120] - 2026-06-14

### Added
- Added database statistics logging on Slackbot startup to show how many messages are in the SQLite index. This helps verify that the database contains the archived messages.

## [26.06.14.119] - 2026-06-14

### Added
- Added a global debug middleware to the Slackbot to log all incoming payload events received via Socket Mode. This helps diagnose why the bot might not be receiving or responding to mentions in Slack.

### Removed
- Removed the experimental `ALLOWED_CHANNELS` and `ALLOWED_USERS` access control restrictions to keep the bot focus on core functionality.

## [26.06.14.117] - 2026-06-14

### Added
- Added SQLite support for the Slackbot search. The bot now indexes archive messages into a SQLite database (`search.db`) and queries it using FTS5 (Full-Text Search). This resolves out-of-memory (OOM) crashes and VPS hangs caused by loading and indexing 100MB+ JSON files with `MiniSearch` in-memory.

## [26.06.14.116] - 2026-06-14

### Fixed

- Fixed `MiniSearch: duplicate ID` crash on the search page and bot by using a composite `channelId-timestamp` as unique ID instead of just the timestamp, which can collide across channels.

## [26.06.14.115] - 2026-06-14

### Fixed

- Fixed `ENOENT: no such file or directory, open '.../lib/search-query.ts'` crash by reading the compiled `search-query.js` instead of the TypeScript source, which doesn't exist in `lib/`.

## [26.06.14.114] - 2026-06-14

### Fixed

- Fixed `node-fetch#buffer` deprecation warning by using `response.arrayBuffer()` instead of `response.buffer()` in [download-files.ts](file:///Users/dst/Documents/koodi/slack-archive/src/download-files.ts).
- Fixed React warning `Use the defaultValue or value props on <select> instead of setting selected on <option>` in [create-html.tsx](file:///Users/dst/Documents/koodi/slack-archive/src/create-html.tsx).

## [26.06.14.113] - 2026-06-14

### Fixed

- Fixed `ReferenceError: __dirname is not defined` crash in [search.ts](file:///Users/dst/Documents/koodi/slack-archive/src/search.ts) when running under Node.js ES modules.

## [26.06.14.112] - 2026-06-14

### Fixed

- Fixed `react-dom/server` import path in [create-html.tsx](file:///Users/dst/Documents/koodi/slack-archive/src/create-html.tsx) by removing the `.js` extension, resolving the `ERR_PACKAGE_PATH_NOT_EXPORTED` error when running via `npx`.
