# Changelog

All notable changes to this project will be documented in this file.

## [v26.09.12.249] - 2026-09-12

### Fixed
- **Fixed `SQLite: disk I/O error` caused by runaway joins and accumulated session bytes**:
  - **Eliminated `messages` table join in FTS queries**: Stored `user_id`, `timestamp`, and `parent_timestamp` as `UNINDEXED` columns directly inside the FTS virtual tables in `src/search-db.ts`. Queries now select directly from FTS without performing random B-tree seeks into `messages`, reducing touched pages by over 98%.
  - **Added `messages_recent_fts` virtual table**: Dedicated FTS index holding only recent messages (~73k messages) populated automatically in `src/search-db.ts`. Recent 12-month searches query `messages_recent_fts` without touching the older 95% of the archive.
  - **FTS segment optimization & VACUUM**: Ran `INSERT INTO ftstable(ftstable) VALUES ('optimize')` on both FTS tables during database build to merge fragmented B-tree segments into a single contiguous tree, and ran `VACUUM` to compact page layouts.
  - **Per-query byte counter resets**: Reset `worker.worker.bytesRead = 0` before each query in `src/search-app.tsx` so `MAX_BYTES` enforces a per-query safety limit instead of bricking the search page after a few queries in a session.
  - **Removed automatic background escalation**: Disabled background all-time search escalation in `src/search-app.tsx` that was saturating the worker thread and inflating byte counts.

## [v26.09.12.248] - 2026-09-12

### Fixed
- **Blank search page caused by undeclared `timeRange` in `App.render()`**: In `src/search-app.tsx`, `timeRange` was accessed in `render()` to evaluate `isRecentOnly` and configure time range UI controls without being destructured from `this.state`, causing an unhandled `ReferenceError` that crashed React at mount time. Added `timeRange` to state destructuring and added regression tests in `src/search-page.test.ts` executing the compiled search app across multiple render states.

## [v26.09.12.247] - 2026-09-12

### Changed
- **Search progressive escalation and query gating**:
  - **FTS channel filtering**: Updated `buildSearchSql` in `src/search-sql.ts` to filter `f.channel_id = ?` directly inside FTS5 when a text query is present.
  - **Automatic background escalation**: If a recent-window search returns fewer than 5 matches, automatically queries the full archive in the background to populate older results seamlessly.
  - **Minimum query length gate**: Unfiltered text searches require at least 3 characters before querying, avoiding expensive 1-2 character wildcard scans across the entire corpus.
  - **Progressive client-side MiniSearch**: In `src/search-app.tsx`, `loadJsIndex` now indexes recent messages first for instant startup and indexes older messages in background idle chunks without blocking the UI.
  - **Rebuilt production search database**: Regenerated `search.db` (552 MB) with FTS5 prefix index, unindexed `channel_id`, and `pages_channel_ts` index.

## [v26.09.12.246] - 2026-09-12

### Changed
- **Search performance optimizations**:
  - **32 KB HTTP range requests**: Bumped `CHUNK` from 4 KB to 32 KB in `src/search-app.tsx` to dramatically cut round-trips over `sql.js-httpvfs`.
  - **Eliminated correlated page subquery**: Removed the unindexed `PAGE_OF_MESSAGE` subquery from `src/search-sql.ts` as `messageLink` resolves message locations using client chunk indices, and added index on `pages(channel_id, oldest_ts)` in `src/search-db.ts`.
  - **Preloaded metadata**: Preloaded searchable channel and user directories directly into `search-indexes.js` (`window.SEARCH_METADATA`), removing startup SQLite database queries on page load.
  - **FTS5 prefix index and channel scoping**: Added `prefix='2 3'` and unindexed `channel_id` to `messages_fts` in `src/search-db.ts` to accelerate wildcard queries and channel-scoped searches.
  - **Default 12-month time range**: Added a "Past 12 months" default search scope with a 1-click "Search all time" expansion and quick dropdown filter, avoiding scanning the entire multi-year archive on initial queries.
  - **Debounce & input tuning**: Increased search input debounce from 250ms to 350ms in `src/search-app.tsx`.

## [v26.09.08.245] - 2026-09-08

### Fixed
- **Uploaded media unreadable on the storage box**: `sync_media` in `nas-archive.sh` rsynced attachments to the Hetzner storage box with no explicit permissions. Run by hand at a terminal (the original 41 GB backfill) that came out `0775`; run from `nas-archive.sh`'s cron-launched shell it came out `0000` - every attachment archived since incremental sync went live (v26.09.05.243) uploaded unreadable, a 404 on the public proxy indistinguishable from a file that was never downloaded at all.
  - Added `--chmod=Da+rx,Fa+r` to the `sync_media` rsync so the mode no longer depends on whichever umask happened to be in effect when it ran.
  - Also missed an entire night: the 2026-09-06 scheduled run never started (no `START` line in the NAS log between 09-05 04:20 and 09-07 04:00), so that day's attachments were only archived - and uploaded unreadable - on the 09-07 run. Cause not identified; flagging in case it recurs.

## [v26.09.05.244] - 2026-09-05

### Fixed
- **Support skin tone modifiers on standard emojis**: Standard emojis with skin tone modifiers (such as `:male-police-officer::skin-tone-4:` or `:+1::skin-tone-2:`) were failing to display in reactions and message text because `getUnicodeEmoji` only indexed base `short_name` keys and omitted `skin_variations` from `emoji-datasource`.
  - Indexed all skin tone modifier variations in `getUnicodeEmoji` using Slack's `::skin-tone-N` syntax (including combined modifiers).
  - Added `cleanEmojiName` helper to normalize shortcode names by trimming colons, whitespace, and lowercasing.
  - Indexed aliases from `emoji.short_names` (e.g. `thumbsup` alongside `+1`).
  - Updated `SHORTCODE_SOURCE` regex in `emoji-render.ts` to recognize shortcodes with skin-tone modifiers (`(?:::skin-tone-[2-6])*`) and properly match back-to-back emoji shortcodes (`:tada::tada:`) in message text and search results.

## [v26.09.05.243] - 2026-09-05

### Fixed
- **Incremental media upload in `nas-archive.sh`**: Added `sync_media` step to sync downloaded attachments from `$ARCHIVE/html/files` to the remote storage box (Hetzner Storage Box) before site publishing. Previously, the initial 41 GB seeding in `upload-media.sh` had not been wired into the nightly automated archiver run, causing newly archived attachments to 404 on the public proxy.
- **Uploaded missing media files**: Pushed 246 attachments archived since 2026-08-25 to the storage box, resolving 404s on recent messages.

## [v26.09.04.242] - 2026-09-04

### Changed
- **Redesigned compact channel header**: Streamlined the sticky channel header from a ~140px, 5-row stacked column into a tight ~50px, 2-row CSS grid layout, saving over 60% vertical space while retaining all functionality:
  - Row 1 combines the channel name, stats link badge ("Ten years of this channel"), and pagination/calendar controls on a single baseline.
  - Row 2 displays the channel topic on the left (truncated with ellipsis, expandable on hover) and creator metadata on the right.
  - Channels without topics collapse cleanly to a single-row header.
  - The "Jump to a month" calendar dropdown now opens as an overlay popover with a custom caret rather than expanding the sticky header and reflowing messages. Clicking outside or clicking a month link automatically dismisses the calendar.
  - Adjusted `scroll-padding-top` on `html` and `scroll-margin-top` on `.message-gutter` from 120px to 64px (96px on mobile), and made the reading line in `static/channel.js` dynamically measure the sticky header's bottom edge.

## [v26.09.04.241] - 2026-09-04

### Fixed
- **Off-by-one active message in infinite scroll URL sync**: Corrected boundary calculation in `static/channel.js` where the scroll listener checked whether the next message's top had reached 30% of the viewport instead of checking whether the current message's bottom had scrolled past the reading line (140px, aligned with `.message-gutter`'s `scroll-margin-top`). This caused the address bar to prematurely advance to the next message's timestamp when reading or clicking a message.

## [v26.09.04.240] - 2026-09-04

### Added
- **Auto-pull image in `nas-archive.sh`**: Explicitly pull `$IMAGE` before launching containers so `:latest` tags update automatically on the NAS without manual intervention.

## [v26.09.04.239] - 2026-09-04

### Fixed
- **Infinite scroll chunk loading direction**: Corrected inverted chunk indexing logic in `static/channel.js` where `olderSentinel` attempted to load out-of-bounds negative indices and `newerSentinel` continuously appended older chunks below newer messages, hanging the "Loading…" sentinel state indefinitely.

## [v26.09.04.238] - 2026-09-04

### Fixed
- **Vendored MiniSearch file path in search page builder**: Corrected vendored file source from `minisearch/dist/umd/index.min.js` to `minisearch/dist/umd/index.js`, fixing a runtime crash when generating search HTML without `--search-index db`.
- **NAS script config location**: `nas-archive.sh` now checks for `nas.conf` in the script directory if `/root/.slack-archive/nas.conf` is not found.

## [v26.09.03.237] - 2026-09-03

### Added
- **Infinite scroll and lazy-loaded channel chunks (`channel.html`)**: Channels now feature a single entry page (`html/<channelId>.html`) that loads message history dynamically using a zero-dependency vanilla script (`static/channel.js`).
  - Messages are partitioned into pre-rendered HTML chunks (`html/<channelId>/chunk-N.json`) containing server-rendered markup, preserving emoji, link rewriting, user avatars, name history, and gap dividers without client rendering duplication.
  - Dual `IntersectionObserver` sentinels dynamically fetch and prepend/append chunks as the reader scrolls in either direction, displaying a loading indicator at the sentinel edge.
  - Channels retain full backward compatibility: static paginated HTML files (`html/<channelId>-N.html`) continue to be generated for `file://` offline browsing, search engines, and noscript environments.
- **Persistent permalink resolution**: Timestamp permalinks (`html/<channelId>.html#<timestamp>`) resolve the target chunk index from `pages.js` (`window.ARCHIVE_CHUNKS`) using raw Slack timestamp boundaries, fetch the appropriate chunk, and smoothly scroll the message into view.
- **History API synchronization & scroll restoration**: As messages scroll through the viewport, the URL hash updates seamlessly with `history.replaceState`. Back/forward browser navigation (`popstate`) re-resolves the position using `history.scrollRestoration = "manual"`.
- **Keyboard navigation**: Channel pages support Vim-style navigation: `j` / `k` step down/up by 200px, while `g` / `G` jump directly to the top or bottom of the channel.
- **Entry point routing & search deep links**: Search results now link directly to `html/<channelId>.html#<timestamp>`. Sidebar links, the front page "Start reading" link, person-page drilldowns, channel stats, `static/self-heal.js`, and `static/scroll.js` all seamlessly route to the new channel entry page.

## [v26.09.02.202] - 2026-09-02

### Fixed
- **Stored XSS in message pages**: Message HTML now escapes Slack mrkdwn and display names. A Content-Security-Policy forbids inline script.
- **Slack token logged in full**: Logs print `xoxp-…last4`. `--no-merge` no longer deletes `.token`.
- **Private Slack file URLs on published pages**: Non-image attachments link to the archived copy, not `url_private` (which can carry `?t=` tokens).
- **Bearer token sent to arbitrary download URLs**: The Slack token is sent only to Slack's file hosts, and not followed off them on redirect.
- **Published names and search users included DM-only people**: The names page and the search index name only people who appear in indexed channels.
- **Emoji filenames kept the query string**: `party.gif?cache=1` is stored as `party.gif`.
- **`--no-slack-connect` rewrote `user-avatars.json`**: Past-avatar fetching is skipped when nothing was fetched from Slack.
- **Search page compiled JSX in the browser from a CDN**: React, MiniSearch and the app are vendored files. No babel-standalone.
- **NAS job kept the Slack token and deploy internals in the public script**: Config and the token live outside the archive tree.
- **Anchor scroll padding**: Archive links with timestamps (e.g. `#1783581635.429659`) no longer hide the top of the linked message under the sticky channel header. Added `scroll-padding-top: 120px` on `html` to reserve space for the header during anchor navigation.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [v26.08.30.201] - 2026-08-30

### Added
- **Thread type filter dropdown**: Filter search results by *All Messages*, *Channel Topics Only* (excludes thread replies), or *Thread Replies Only*, supported in both the SQLite database engine and the client-side JavaScript index.
- **Reset all filters button**: Quickly clear search input, channel, user, thread, and date range filters with a single click.
- **Enhanced thread badging**: Distinguish thread replies from channel topic messages with clean visual badges.
- **Search phrase & word highlight deduplication and sorting**: Highlights multi-word quoted phrases alongside individual keywords while safely preserving custom emoji images.

## [v26.08.29.200] - 2026-08-29

### Added
- **Search keyword highlighting, result count summary, thread reply badges, URL synchronization, and keyboard shortcuts.**
  - Matched search terms and quoted phrases are highlighted in message results with `<mark>` tags without breaking custom emoji rendering.
  - Result count feedback summary is displayed above search results ("Found X messages" / "Showing top 50 messages" / "No matches found.").
  - Search filters and query parameters (`q`, `channel`, `user`, `from`, `to`, `sort`) synchronize with the browser address bar via `history.replaceState` and are parsed on initial load for shareable, bookmarkable deep links with browser history support.
  - Thread replies carry a visible `↳ Thread reply` badge so readers immediately see context.
  - Added `/` keyboard shortcut to quickly focus the search input, and `Escape` to blur.

## [v26.08.28.199] - 2026-08-28

### Fixed
- **Custom emoji in search results were shortcodes.** Searching for `:nuclear`
  returned a wall of `:nuclear-huutonaurut: :nuclear-huutonaurut:` where the
  channel pages show the picture - the same message rendered two different ways
  by the same archive, and the search page's version reads as though something
  had failed to load. It had not: the file was on disk all along. Results are
  raw message text out of the index, and the page printed it verbatim, which is
  all it had ever known how to do. Standard shortcodes were literal there too,
  so `:tada:` never became a party popper either.

  The rendered pages do this work when they are built, with the emoji
  directory and the emoji datasource at hand; the search page runs in somebody
  else's browser and has neither. So it is now handed both as data - `src/emoji-render.ts`
  splits a line into text and the emoji in it and is shared by both sides, and
  `html/emoji.js` says which shortcodes this archive can draw: every standard
  one as the character it means, every custom one this archive actually
  downloaded as the file it lives in. A shortcode with nothing behind it is
  still left exactly as typed, which is what the pages do and better than an
  empty box. A clock is still a clock: `12:30:45` contains `:30:` and stays a
  time.

## [v26.08.27.198] - 2026-08-27

### Fixed
- **`scripts/nas-archive.sh` would have taken private channels out of the
  BOT's search index.** The copy that runs on the NAS excludes `im,mpim` from
  the archive run and `im,mpim,private` from the publish, deliberately and with
  a comment saying so: no private channels on the website at all, but private
  channels ARE searchable through the Slack bot by people who are members. The
  version brought into this repo had `private` in both, which would have
  emptied the bot's index of them silently - search would simply have stopped
  finding things that were still archived. The mismatch and the reason for it
  are now in this file too.
- **And it would have lost three things the box's copy had grown**: the
  heartbeat that stops the NAS sleeping through a forty-minute render, the
  docker lookup that makes a manual `sudo sh nas-archive.sh` work at all when a
  nightly run has failed, and the exit traps that put one line in the log
  however the script dies - written after a run that produced no output at all
  and looked exactly like a machine that never woke up. Ported, with the
  incidents they record.

### Added
- **Search by date range, beside the channel and person filters.** Two pickers,
  either end optional, and a range on its own is a search: "what was said that
  week" was not a question the page could ask before. The dates are read in the
  reader's own timezone - the same clock the timestamps beside the results are
  printed on - because `new Date("2025-01-01")` is midnight UTC, which is the
  previous evening here, and a message sent at 01:30 would fall outside a range
  that visibly includes its day.
- The bounds are compared as TEXT, which is what lets the index answer them. A
  Slack timestamp is ten digits, a dot and six more, so string order and
  numeric order are the same thing - while `cast(timestamp as real) >= ?` reads
  correctly and then scans the whole table, which over range requests means
  downloading the corpus to answer one question. There is a third index for the
  case with neither channel nor person in it.
- Both search engines take the dates: the database applies them in SQL, and the
  JavaScript index filters after the search, since MiniSearch holds no
  timestamps to filter on. Verified in a browser to return identical results.
