# Changelog

All notable changes to this project will be documented in this file.

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
