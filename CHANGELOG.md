# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [v26.08.25.132] - 2026-08-25

### Fixed
- **`npx github:ollisulopuisto/slack-archive` aborted with `Invalid Version:
  26.06.14.124` for anyone who had ever run it before.** package.json carried a
  four-number CalVer, which is not semver. npm does not warn about that - when
  it finds an already-installed copy of a package it is about to replace, it
  compares the two with `semver.lt`, and an unparseable version throws. The
  npx cache holds exactly such a copy after the first run, so the second run
  onward failed, on every new commit to main, for that user, permanently. A
  first-time user saw nothing wrong.

  package.json's version is now `26.8.25+132`: the same CalVer mapped into
  semver, month and day without their leading zeros (illegal in a semver
  number) and the build number as build metadata, which is the only place
  semver has for a fourth component. `src/version.test.ts` checks both that it
  parses and that it still says what the CHANGELOG says - the field had sat at
  26.06.14.124 through six releases, and nothing noticed.

  **A poisoned npx cache does not heal itself.** The bad version is in the
  *installed* copy, so npm throws while reading it, before it can replace it.
  Anyone who hit this needs to delete the cache entry once:

      rm -rf ~/.npm/_npx/cf8fe5454af0d9a2

  (the hash npm names in the error path, one per package spec) - or
  `npm cache clean --force` to clear all of them. After that `npx` works and
  keeps working.

## [v26.08.25.131] - 2026-08-25

### Changed
- **The search database is SQLite compiled to WebAssembly (`node-sqlite3-wasm`),
  not the `sqlite3` native addon.**

  `npx github:ollisulopuisto/slack-archive` was dead on Node 26:

      Error: Could not locate the bindings file. Tried:
       -> .../node_modules/sqlite3/lib/binding/node-v147-darwin-arm64/node_sqlite3.node

  That is not a bug in this repo's code, and it is not fixable by pinning a
  version. `sqlite3` is built by node-gyp and shipped as prebuilt binaries per
  (ABI x platform x arch). Every new Node release invents an ABI that has no
  prebuilt binary until someone publishes one, and when the download misses,
  the fallback is compiling from source - so the tool works only on machines
  that happen to be behind the prebuilds, or that have a compiler. A user who
  upgrades Node loses a tool that was working.

  A `.wasm` build has no ABI to match: one file, byte-identical on every
  platform and architecture, nothing to download per-platform and nothing to
  compile. It also settles a question Node's own `node:sqlite` does not:
  official Node binaries are built WITHOUT FTS5, and full-text search is the
  entire point of this database.

  Cost, measured on the real 1,077,096-message archive: the rebuild takes about
  100 seconds and produces the same 369 MB index; a bot query answers in
  ~160 ms. The existing `search.db` is unchanged in format and does not need
  rebuilding.

- **The container image no longer installs python3, make and g++.** They were
  there for exactly one reason - no musl prebuilt for `sqlite3`, so node-gyp
  compiled it inside the image. Nothing compiles now.

### Added
- **A test job in CI, and tests for it to run.** `src/search-db.test.ts` builds
  a real database and queries it: prefix matching, AND across words, quoted
  phrases, the result limit, and what happens when someone types FTS5 operators
  into a Slack message.

  The pipeline previously documented, correctly, why it had no test job:
  package.json's `test` was the npm stub, so a gate would have failed every
  build while proving nothing. `test` is `vitest run` now.

- **`npm run smoke`, run in CI after the tests.** vitest transforms the source,
  which means it cannot see a class of bug the emitted ESM in `lib/` has:
  `node-sqlite3-wasm` is CommonJS, and `import { Database } from` it typechecks
  and passes vitest, then throws `does not provide an export named 'Database'`
  the first time real Node loads it. This happened during this change. The
  smoke step loads `lib/search-db.js` under plain `node`.

- **The `channels` table records what a conversation IS** - `kind` (`public` /
  `private` / `mpim` / `im`) and `is_archived` - so a reader can withhold what
  it should not hand out. `bot.ts` today has no access control whatsoever: it
  FTS-matches all 1,077,096 rows, DMs and private channels included, and will
  DM the results to whoever asks. Nothing in the database let it do otherwise.

  In this archive 44 of 72 conversations are DMs or group DMs, so that is the
  majority of what the bot answers from, not an edge case.

  `channelKind()` in `channels.ts` resolves the flags in one place and in one
  order - im, then mpim, then private - because Slack sets `is_private: true`
  on DMs and group DMs as well. Private-first would mislabel all 14 group DMs
  here as private channels. A channel supplied without a kind stores NULL
  rather than `public`: public is the one value a reader may hand to anybody,
  so it is not the value to guess.

### Fixed
- Search queries are now quoted before they reach FTS5, so a message
  containing `*`, `^`, `(` or `NOT` is searched for as words rather than
  parsed as query syntax.
- **`tsconfig.json` now pins `rootDir` and `include`.** With neither set, tsc
  infers the input root from the common parent of every `.ts` file it finds.
  Adding `vitest.config.ts` at the repo root moved that parent from `src/` to
  `.`, which relocated the whole build from `lib/*.js` to `lib/src/*.js` -
  exit code 0, no warning. `bin/slack-archive.js` does
  `import('../lib/cli.js')`, so a clean checkout - which is what the image
  builds from - would have produced a container that failed at startup. Spotted
  as `npm run compile` quietly not updating `lib/`, then confirmed by
  `npm run smoke`, which is the step that would have failed the build in CI
  rather than shipping it.

## [v26.08.22.130] - 2026-08-22

### Changed
- **The version number comes from this file now, not from `git rev-list --count HEAD`.**
  A count is derived, and a derived number cannot be authoritative: a squash
  merge moves it by an amount unrelated to what shipped, a rebase changes it
  wholesale, and two branches developed in parallel produce the same count - so
  two machines committing at once can genuinely claim one number.

  Running both schemes at once is worse than either. paikallislehti did, they
  drifted four apart, and two sessions concluded the live site had to be rolled
  BACK when the two numbers were the same build. Across the estate on
  2026-08-22, five of eight repos keeping both were drifting: -3 to +5. This one
  was behind its count.

  `scripts/release_version.sh` reads the top heading here and exits non-zero
  rather than inventing a name. Numbers may be skipped; the file is the source
  of truth, not a count of anything.

  **This entry's number is deliberately past the old count**, so no tag the
  previous scheme published is ever reissued or gone backwards over. It is a
  one-time correction: from here the file is alone, and nothing consults the
  count again.

## [26.06.14.124] - 2026-06-14

### Added
- Added DM (Direct Message) search support to the Slackbot. You can now message the bot directly in an IM channel to search the archive without needing to mention it with `@botname`.

## [26.06.14.123] - 2026-06-14

### Added
- Added a standalone script `src/build-db.ts` to build only the SQLite database from existing data without running the HTML rendering or full archive generation process. This prevents Out Of Memory (OOM) crashes on small VPS instances.

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
