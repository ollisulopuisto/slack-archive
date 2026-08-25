# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [v26.08.25.137] - 2026-08-25

### Added
- **Nickname history now covers all ten years, not just 2016-2018.** The
  pipe-form mention `<@U2H06BCQZ|jaricurry>` that .136 mines dried up when Slack
  changed what it sends, around 2018, so the recovered history stopped there -
  30 names for 13 users, nearly all of them from the first two years. This
  workspace has had far more than that.

  Sharing a Slack message quotes it as an attachment, and the attachment keeps
  `author_id` beside `author_name`: the author's **display name** as it was the
  day it was shared. That never stopped, so it spans the whole archive. Mining
  it takes the recovered history from 30 names to **103, for 16 users**, and the
  date ranges come out contiguous and non-overlapping, which is what a rename
  history looks like:

      Info Sota -> Minna Amaranth -> Sakari Puisto -> Jonathan Haidt ->
      Matteo Salvini -> Junes Locke -> John Stuart Mill -> John Stuart Bill ->
      Jari Sarasvuo -> Keyser Soze -> Theodore J. Kaczynski

  An attachment with no `author_id` is a link unfurl - "Helsingin Sanomat" is a
  newspaper, not a member - so the id is what qualifies a name as somebody's.

  Two things deliberately NOT read, both found by checking the output against
  the real archive rather than trusting the shape:

  A message's `name` field is the **channel's** name. Reading it as a person's
  put `offtopic`, `hodl` and `twitter` in the history, 361 of them.

  A file's `name` and `title` sit next to the uploader's `user` id, which makes
  them look like a name for that person. They are `IMG_1234.jpg`. That pattern
  matched 30,118 pairs, and every one of them was wrong.

  One attachment in the archive does name somebody `EjKLSbdWsAEhOVA.png`. It is
  left in: a filter for filename-shaped nicknames would eventually eat a real
  one in a workspace whose members have called themselves "Analprint scan".

  A name that is itself a user id is dropped, because that is what `getName()`
  prints when it knows nothing, and recording it would teach the history that
  somebody is called `U2GV75QA2`.

## [v26.08.25.136] - 2026-08-25

### Added
- **The archive now remembers what people used to be called.** Slack has no
  rename history: `users.info` answers with whoever somebody is today, and every
  name before that is gone. In a workspace where changing your handle is a
  running joke this makes old messages unreadable - one member here has been
  juusokarhu, kuningaslitmanen, reijotossavainen, hevosenkuerpae, ullaappelsin,
  natsiblondi and lahtari, all within eleven months, and is called something
  else again today.

  Two sources, written to `data/user-names.json` as `{ nick, first, last,
  sources }` per user, oldest first:

  **Retroactively**, out of the messages already archived. Slack used to encode
  a mention as `<@U2H06BCQZ|jaricurry>` - the name as it was the day that
  message was posted. Mined across 1,129,109 messages here, that yields 30
  names for 13 users, dated back to September 2016. It is the only record of a
  past nickname that exists anywhere, and it was sitting in the message text the
  whole time. Bot and legacy messages carrying a `username` field are read the
  same way.

  **Going forward**, a snapshot of every profile on every run, which is what
  closes the gap: the pipe form is rare in modern messages, so from here the
  record is kept rather than recovered.

  The pass runs over every selected channel rather than inside the download
  loop, because a channel marked `fullyDownloaded` never enters that loop, and
  an archived channel is exactly where the oldest names are.

- **The member list is fetched whole.** Users used to be discovered one at a
  time - `users.info` for the author of each downloaded message - so anyone who
  never posted in an archived channel was simply absent, and `getName` falls
  back to printing the raw id, putting `U2GV75QA2` in the HTML where a person
  belongs. One paginated `users.list` now answers for everybody, the
  deactivated included, who are precisely the people no other lookup can still
  resolve. A token without `users:read` fails this step and archives as before.

## [v26.08.25.135] - 2026-08-25

### Fixed
- **Backups piled up forever on any unattended run.** Every run copies the whole
  data directory to `data_backup_<timestamp>` before touching it - about a
  gigabyte for a workspace of this size - and `deleteOlderBackups()` began with
  a check for automatic mode, printed "in automatic mode: Proceeding without
  deleting them", and returned. That is exactly backwards. Automatic mode is the
  one that runs unattended, nightly, with nobody watching the disk fill;
  interactive mode is the one with someone there to answer a question.

  Retention is now bounded in both modes and is no longer a question:
  `--keep-backups` (default 2 - the run before this one, and the one before
  that). The prompt is gone, because how many backups to keep is a decision
  worth making once rather than one that can only be answered by whoever happens
  to be watching.

  The companion half is `deleteBackup()`, which tries `trash()` and, when that
  throws, prints "Set TRASH_HARDER=1 to delete files permanently" and leaves the
  copy where it is. That is unchanged and still worth knowing: on Linux the
  `trash` package is a pure-JS freedesktop implementation, so when it *succeeds*
  it moves the directory to a hidden `.Trash-<uid>` on the same volume, which
  frees nothing. Stranded `data_backup_*` directories on two different machines
  is how both halves showed up. A scheduled run wants `TRASH_HARDER=1` set.

  Also fixed while in there: `const { isDirectory } = fs.statSync(dir)` reads the
  function rather than calling it, and a function is always truthy, so a *file*
  named `data_backup_1234` counted as a backup and would have been deleted with
  them.

## [v26.08.25.134] - 2026-08-25

### Added
- **Search finds images, including the ones nobody captioned.** The archiver
  downloaded 42,422 attachments and the index threw every one of them away:
  `buildSearchDatabase` stored `{t, u, m}` only. A picture posted without a
  caption has an empty message text, so it was not merely hard to find - it was
  not in the index at all.

  Attachments now have a `files` table (Slack's file id, the message and
  channel they belong to, name, title, filetype, mimetype, `is_image`), and
  file names and titles go into the FTS content: `messages_fts.message` is
  indexed as `${text} ${fileNames} ${fileTitles}` while `messages.message`
  keeps the text the person actually wrote. One query finds captioned and
  uncaptioned images alike, and the bot still echoes back the real message
  rather than a name it invented.

  The access gate comes along for free: files join to their message, and the
  message carries the channel, so whatever withholds direct messages from
  message search withholds their attachments too. There is a test asserting a
  file in an `im` channel never comes back.

  Image-ness comes from Slack's `mimetype`, then a `filetype` allowlist, never
  from the filename - `download-files.ts` takes the extension from the download
  URL, and some URLs carry none. Counted across all 74 channels and 1,084,375
  messages: 42,422 attachments under 41,228 distinct file ids, 40,588 images
  caught by mimetype, 0 by the filetype fallback, and 676 carrying neither
  field. Those 676 are not files - 624 `hidden_by_limit`, 51 `tombstone`, one
  `file_not_found` - and none carries a name, so `is_image = 0` is the right
  answer for all of them rather than a gap.

### Fixed
- **Hyphenated search terms matched nothing.** The query tokenizer deleted
  non-word characters inside each word, turning `kissa-katolla` into
  `kissakatolla`, while FTS5 had indexed `kissa-katolla.png` as three tokens.
  The two tokenizers have to agree; the query side now splits on runs of
  non-word characters instead of deleting them. FTS5's operators still become
  separators rather than syntax, which is what the deletion was for.

## [v26.08.25.133] - 2026-08-25

### Fixed
- **Archiving a big channel died with `RangeError: Invalid string length`.**
  Saving a channel called `JSON.stringify(messages, undefined, 2)`, and V8 will
  not make a string longer than 536,870,888 characters. `offtopic` reached
  706,371 messages - 538 MB on disk, more than that once indented - so the run
  crashed at the moment it had finished downloading, every time, and no later
  channel was ever reached.

  Reading was over the same cliff: `readFileSync(path, "utf8")` on the file
  already written throws `Cannot create a string longer than 0x1fffffe8
  characters`, so the archive was one run away from being unopenable as well as
  unwritable.

  Nothing about the data is too big for disk or for memory - only for one
  string. `src/big-json.ts` now writes the array element by element, each
  `JSON.stringify`d on its own and streamed to a temporary file that is renamed
  into place, and reads it back by slicing the file's *buffer* into elements
  and parsing those, taking the plain `readJSONSync` path only when the file is
  small enough for it. The scanner reads any valid JSON array, so archives
  written by earlier versions - the pretty-printed ones that outgrew the limit
  - open fine.

  **`search.js` was next in line and is fixed in the same pass.** It is one
  `JSON.stringify` of every message in the workspace - 1,084,375 of them,
  111 MB - written as `window.search_data = {...};` and read back by slicing 21
  characters off a string of the whole file. Both ends now stream: the object
  is written a message at a time, and reading it slices the buffer into
  channels and then into messages, taking the whole-string path only while the
  file still fits in one. Verified against the live 111 MB file: both paths
  return byte-identical data, and the rewritten file still evaluates as the JS
  the search page loads.

  Channel files written from now on are compact rather than indented, which is
  incidentally a third smaller: `offtopic` went from 538 MB to 363 MB, same
  content, same hash.

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
