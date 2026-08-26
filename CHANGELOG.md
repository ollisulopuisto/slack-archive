# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Calendar Versioning](https://calver.org/).

## [v26.08.27.190] - 2026-08-27

### Changed
- **node 22 instead of node 18, in both build stages.** 18 went end-of-life in
  April 2025 and takes no more security updates, and the gap mattered more than
  the age: the test job ran on 20 while the image shipped 18, and `npm run
  smoke` exists precisely to catch an ESM/CJS load failure that typechecking
  and vitest both pass. A smoke test on a runtime you do not ship cannot do
  that job. `.node-version` moves to 22 with it, so the tests run the major
  that runs in production, and this matches the only other Node image in the
  estate.
- **Dependencies install in their own layer again.** `COPY . .` before `npm ci`
  invalidated the dependency layer on every source change. The install now runs
  with `--ignore-scripts` - which is what makes the split possible at all,
  since `prepare` would otherwise run tsc before `src/` had been copied - and
  the compile is invoked explicitly afterwards. Safe here because nothing in
  this dependency tree has an install script; not a rule to copy into a project
  with a native addon.

## [v26.08.27.189] - 2026-08-27

### Fixed
- **A share of the missing days is now as uncertain as the total it came
  from.** "Who talks", the busiest channels, who reacts, the bots and every
  per-person tile swapped to their speculative figure and then sat perfectly
  still, because each was built with its low end equal to its high: a share has
  no measured spread of its own. But the workspace total it is cut from does,
  and that is the part the seasonal model actually measured - so each share now
  carries that interval scaled by the same proportion. The share itself is
  treated as exact, which understates the real uncertainty rather than
  inventing it. A test fails on any estimate whose two ends are the same
  expression.
- **`--timezone` states which clock the pages are rendered on.** Every
  timestamp is formatted in the renderer's local zone. A container has none, so
  it is UTC - and the first publish from the NAS restated ten years of message
  times three hours earlier than the same archive rendered on a laptop, with
  nothing on the page saying which clock it used. The zone is now set before
  node caches it, an unknown zone is refused instead of silently becoming UTC
  (node does not treat `Europe/Hensinki` as an error), and `scripts/publish.sh`
  passes it through and says so when it is missing.

## [v26.08.27.188] - 2026-08-27

### Fixed
- **The wobbling numbers stayed inside their boxes.** A speculative figure is
  longer than the count it replaces, and redrawing it across the full interval
  changed its width - so "1 233 250" wrapped to two lines and the layout jumped
  once a second. Only the last few digits move now, capped at the real interval
  so it can never overstate it, and the tile refuses to reflow. The shimmer is
  there to say the number will not sit still; the interval it came from is
  stated in the tooltip, which is the honest place for it.

## [v26.08.26.187] - 2026-08-26

### Changed
- **The image is Debian now, not Alpine - glibc rather than musl.** The size
  argument does not survive contact with this project: the pages are 900 MB and
  the attachments 41 GB, so thirty megabytes of base image is not worth
  optimising for. What musl costs is real - prebuilt native binaries are built
  for glibc, which is why this archive already uses a WebAssembly SQLite rather
  than a native one - and it differs at runtime too, in its allocator and its
  far smaller default thread stack, which is the kind of difference that
  segfaults instead of erroring. There is an unexplained segfault on the NAS on
  the musl image; this does not diagnose it, but it removes a variable that
  existed only for a saving nobody needed.

## [v26.08.26.186] - 2026-08-26

### Fixed
- **A crashed render no longer walks into the checks.** The render ended in
  `| grep ... || true`, which takes grep's exit status and then discards that
  too - so when node segfaulted on the NAS, the script carried on to the checks
  as though nothing had happened. This time the checks crashed as well; they
  could just as easily have passed on a stale tree and uploaded it. The
  render's status now decides whether anything else runs, and its full output
  is kept in `render.log` rather than filtered away.
- **The heap size is no longer hardcoded to 12 GB.** That was right for the
  laptop it was written on and arbitrary anywhere else. `--node-memory` sets
  it; unset, node sizes its own heap for the machine it is on.
- **`--render-workers` passes through**, so a machine that struggles can render
  on fewer cores.

## [v26.08.26.185] - 2026-08-26

### Fixed
- **The publish now refuses at the start when ssh cannot run, instead of after
  the render.** A container running as a host uid has no `/etc/passwd` entry
  for it, and ssh calls `getpwuid()` on startup and dies with "No user exists
  for uid 1026" - which the first successful NAS render reached after five and
  a half minutes of work, at the upload. The check now runs before anything is
  staged and names the remedy: mount the host's passwd file read-only.

## [v26.08.26.184] - 2026-08-26

### Fixed
- **The publish script needed python, and the image it ships in does not have
  it.** Staging and the six checks were shell heredocs calling `python3` -
  which worked on the machine they were written on and could never have worked
  in the container, where the first NAS run died at `python3: command not
  found`. They are node now, in two files rather than heredocs:
  `scripts/stage-public-channels.mjs` and `scripts/verify-publish.mjs`. The
  image already has node; it is what renders the archive.

## [v26.08.26.183] - 2026-08-26

### Fixed
- **A link to a message that is not on the page now repairs itself.** Pages are
  cut newest-first in blocks of a thousand, so one new message pushes one off
  the end of every page after it - which means a link built from an older index
  points at a page that no longer holds its message. Nothing failed: the reader
  landed at the top of roughly the right era, with no error and no explanation.
  A miss now hands the timestamp back to the front page, which resolves it
  against the page index shipped with THIS render and sends the reader on. One
  hop only; a second miss lands honestly rather than looping.

  This makes the whole class of drift benign - for the bot's links, for links
  people paste to each other, and for anything bookmarked before a render.

## [v26.08.26.182] - 2026-08-26

### Added
- **Channel pages count their own reactions.** Each one now has its emoji
  ranking, who reacts in it, how much of it is the workspace's own emoji, its
  files and its thread replies - measured for that channel rather than
  inherited from the workspace. #offtopic and #financephalograph do not react
  with the same things.
- **The speculative toggle is on every page that has a speculative number**,
  which now includes the front page and the bots page - bots kept posting
  during the missing days too. A test holds the line, because the front page
  shipped one render with a speculative number and no way to reveal it: the
  worst of both, a number that cannot be shown and never changes, so nobody
  learns it exists.

## [v26.08.26.181] - 2026-08-26

### Added
- **`--exclude-user-files`**: whose attachments are never downloaded. A bot
  that shares an archived image back into a channel makes a real message with a
  real file, so every share would permanently store a second copy of a picture
  the archive already has. Not fetching it beats sweeping it up later - a sweep
  needs write access to a store that ought to be read-only, has to keep working
  forever, and one that silently stops looks exactly like one with nothing to
  do. The renderer knows about the rule, so those messages say their attachment
  was not archived rather than showing a broken image.
- **The estimates refuse to sit still.** With the toggle on, every speculative
  number is redrawn once a second from inside its own interval - digits
  shuffle, the dotted line moves within its band, the hollow caps breathe. A
  static number with an error bar reads as "the answer, plus a decoration"; a
  number that will not settle reads as what it is. The draw favours the middle,
  one draw per gap is jittered per point so a run reads as uncertainty rather
  than noise, and only numbers whose range was actually computed take part -
  inventing a wobble for a number with no measured spread would be inventing a
  claim. Reduced-motion gets the estimate without the movement.

## [v26.08.26.180] - 2026-08-26

### Added
- **"What we could have had" changes every number that can be estimated**, on
  the stats page, on every channel page and on every profile: the tiles, the
  per-person totals, the per-channel totals, the reaction counts. A page where
  the headline includes the missing days but the bars beneath it do not is
  worse than either page alone, because the parts stop adding up and nothing
  says why.
- **And it says so loudly.** The speculative numbers count up to themselves,
  change to a serif italic, glow, and the bars go hatched - because these are
  not the same kind of number as the ones the page shows by default and should
  not be mistakable for them in a screenshot. Reduced-motion is honoured: the
  numbers still change, they just stop moving.

### Changed
- **`--search-exclude-users` carries the warning it needs.** Excluding a bot
  from the index is what stops an archive filling with copies of itself when
  something can post archived content back into the workspace: the re-post is
  archived but never indexed, so it cannot be found and posted again. Indexing
  it "to be thorough" opens that loop, and the symptom shows up in a different
  system from the change. Found by koodi-2b while building image sharing.

## [v26.08.26.179] - 2026-08-26

### Changed
- **The estimate is in the tooltip and in the numbers.** Hovering a year says
  what was archived, what is estimated missing, the total that implies and the
  range around it; hovering a gap on the month chart says how many messages
  probably sat in it. The Numbers table beside every chart gains an estimate
  column - the same information for anybody who would rather read than hover,
  which includes anybody without a mouse.

## [v26.08.26.178] - 2026-08-26

### Added
- **The bar charts carry the estimate too**: a hollow dashed cap for what the
  archive is missing from that year, on the same scale as the solid bar, with
  a whisker for the range the surrounding years disagree over.
- **Speculative totals, behind a toggle that defaults to off.** "Count what is
  missing too" swaps Messages and Reactions to the estimated figures, marks the
  tiles as speculative while it is on, and is off again on every load - a page
  should open by saying what it knows. Reactions are estimated at the archive's
  own rate, which is a weaker claim than the message estimate and is labelled
  as one.
- **Channel pages get all of it**, computed from their own seasons rather than
  the workspace's: #offtopic in July is not #rekry in July. They also gain a
  messages-per-month chart, and channels now count their own reactions.

### Fixed
- **Everything the archive writes is readable by whoever reads it next.** With
  a umask of 0077 - which is what a container can easily have - files came out
  mode 600, and the failure showed up not at write time but as a publish that
  stopped the next day saying it could not read `search.js` to check it. Modes
  are now set explicitly rather than inherited, for files and for the
  directories created along the way, with an opt-out for anything that is a
  secret. What is inherited is not guaranteed, and what is not guaranteed will
  differ on somebody's machine.

## [v26.08.26.177] - 2026-08-26

### Fixed
- **The publish lock claimed a busy publish when it could not write a lock.**
  It created the lock beside the work directory, which in a container is often
  `/` owned by root while the process is not - so `mkdir` failed with a
  permission error and the script reported "another publish is already using
  this", inventing a specific cause for a generic failure. The lock now lives
  inside the work directory, existence and permission are separate questions,
  and a permission error says so.

## [v26.08.26.176] - 2026-08-26

### Added
- **The charts draw what was probably there.** Across the five gaps the message
  chart fell to zero, which reads as a workspace that went quiet for eight
  months - it did not; nobody was archiving. A dotted line now shows the
  estimate and a band shows how uncertain it is, and **none of it is added to
  any total**: an estimate in a total stops being an estimate and becomes a
  claim.

  The model is seasonal, because a flat rate is wrong in the way the eye
  notices: a month is estimated as its own season - its size relative to its
  year, averaged over every year that has it - times the level interpolated
  between the deseasonalised months either side of the gap. July is reliably
  small here, so a missing July is estimated small. The band is how much the
  years disagree about that month, which is the honest source of uncertainty
  rather than a made-up percentage. Years with fewer than six months of data
  say nothing about seasons and are left out of it.
- **Empty months are drawn struck through** in the channel calendar instead of
  being left out, because an absent chip cannot say whether the channel was
  quiet or the archiver was not running. Hovering says which.

## [v26.08.26.175] - 2026-08-26

### Added
- **Dark mode**, from the system setting. Every colour in the stylesheet is a
  token now and the dark scheme redefines the tokens rather than adding a
  second set of rules, so the two cannot drift apart. Tests hold the line: no
  token may be defined as itself, every token used must be defined, and the
  dark block may only contain `:root`.
- **A calendar instead of a dropdown.** Getting around #offtopic meant a
  `<select>` with 714 options, each labelled "694 - 03/27/2017, 3:38 PM to
  03/21/2017, 10:22 PM". Now: Newer/Older, where you are, and "Jump to a
  month" - years as rows, months as chips, each landing on the page where that
  month begins. It also shows the archive's gaps for free: a month with no
  messages simply has no chip.

### Changed
- **The channel list is set like Slack's**: the `#` in its own column so names
  align, rows indented under their section.
- **The header folds down on a phone.** It was taking a third of the screen
  before the first message: the creation line, the topic and the long page
  range are hidden below 600px.

### Fixed
- **`--surface: var(--surface)`.** A find-and-replace turned an earlier token
  block into self-references, which are guaranteed-invalid: the tokens became
  undefined and everything that used them fell back to transparent. The only
  symptom was a sticky header you could see through.
- **`--text-muted` never existed.** Four rules used `var(--text-muted, #616061)`
  and the fallback was doing all the work.
- **Sidebar labels vanished in dark mode**: white text that had been written as
  `#fff` became `var(--surface)`, which inverts. Ink that sits on the sidebar
  or on an accent fill now says so.
- Removed the channel-at-a-time render path, dead since page-level rendering
  landed - about two hundred lines that nothing called and nothing tested.

## [v26.08.26.174] - 2026-08-26

### Added
- **`--start-channel`** - which channel the front page offers to open. Every
  workspace has one room that is the workspace; no default can know its name,
  so it is a setting. Unset, the front page offers the busiest published
  channel, which is a better guess than whichever one happens to sort first,
  and a name that matches nothing published falls back rather than linking to a
  page this site did not write. `scripts/publish.sh` passes it through.

## [v26.08.26.173] - 2026-08-26

### Changed
- **A page, not a channel, is the unit of rendering work.** Giving each worker
  a whole channel cannot balance an archive where one channel holds 65% of the
  messages: nine workers finished in seconds and the tenth rendered seven
  hundred pages alone. Elements of a JSON array are contiguous, so a page is
  one byte range - `big-json` now records where every element sits while it
  reads, and a worker rendering page 431 reads about a megabyte instead of a
  third of a gigabyte. Channel pages went from 46s to 13s on this archive, and
  peak memory per worker from "the biggest channel" to "one page".
- **The image can publish.** It carries `scripts/`, bash, rsync and
  openssh-client now - about five megabytes - so the NAS runs the same publish
  the laptop does, with `--ssh-key` for a mounted identity, instead of needing
  node and the repo on the host.

### Fixed
- **A reply sent with "also send to channel" was rendered twice**, with the
  same `id` on both copies - invalid HTML, and an ambiguous permalink. 953 of
  them on forty pages of one channel. The copy in the thread is kept, matching
  what the search index chose in .162; a broadcast whose parent is on another
  page is left alone, because dropping it there would lose the message rather
  than de-duplicate it.
- **The channel file is opened once per worker, not once per page** - 714 opens
  for one channel.

## [v26.08.26.172] - 2026-08-26

### Added
- **`scripts/publish.sh`** - rendering the public half of an archive and
  putting it on a web host, in the repository rather than on one machine. There
  were two copies of this job, one on a laptop and one on the NAS, and they
  drifted into the same blind spot: every check read the rendered HTML, neither
  read the data directory, and the data directory held ten years of direct
  messages one rsync flag away from a web root. It stages only the channels the
  site publishes, runs six checks before uploading anything, and then reads the
  WEB ROOT ITSELF to assert that `data/` holds `search.js` and nothing else -
  because every other check reads the tree we built, which is the thing that
  might be wrong.
- **The search page has the sidebar** and a way back into the archive. It is a
  template with a browser-side app in it, so the render writes the channel list
  once and the search page picks it up - which also means the build says so if
  it is missing rather than shipping the one page with no way home.

## [v26.08.26.171] - 2026-08-26

### Added
- **The render uses more than one core, and says where its time goes.** Every
  run now prints its split - `Rendered in 1m01s: reading and counting 10s,
  channel pages 51s` - which is how this was sized in the first place: the
  channel pages were 2m32s of a 3m11s run and everything else was seconds.
  They are now rendered by a pool of workers, one bucket of channels each,
  balanced by message count rather than by channel count because one channel
  here holds 65% of the archive. 3m11s to 1m27s on ten cores.

  `--render-workers 1` renders in this process exactly as before, and
  `--render-workers N` pins the number. Nothing about a page depends on any
  other page - which only became true when the render context stopped being
  fifteen mutable globals.

## [v26.08.26.170] - 2026-08-26

### Fixed
- **The channel header read as one run-together sentence.** It floated two
  pieces of metadata to the right of an inline heading, which works in a wide
  frame and nowhere else: "offtopic Created by Professor Plum on Wednesday …
  a workspace that has genuinely used "Analprint scan" as a Ten years of this
  channel display name 10v PIKKIKSET PERJANTAINA". It is a stack now, and
  nothing in a message can push the page sideways - not a long URL, not a
  pasted table.

## [v26.08.26.169] - 2026-08-26

### Changed
- **Every page stands on its own.** The archive was a frameset: one page,
  `index.html`, holding every conversation in an iframe. So no page had a URL -
  sharing a message meant sharing the front page plus a query string, the back
  button moved the frame rather than the page, and a page opened directly had
  no sidebar. The channel list is now rendered into all 1 143 pages, about five
  kilobytes each on pages that are already the better part of a megabyte, and
  `index.html` is a front page: what this archive is, in numbers, and the way
  in. It still answers the old `?c=…&ts=…` links - they are pasted around Slack
  and the bot generates them - by sending them on to the page that now exists.
- **One render context instead of fifteen mutable globals.** Whether a page
  came out right depended on the order the render happened to call things in,
  and when it was wrong nothing failed: the page simply came out worse. Two of
  today's bugs were exactly that. Counting now returns what it learned -
  `{ stats, gaps, profileIds }` - and `buildRenderContext` assembles the one
  object a page cannot be rendered without.

### Fixed
- **`scroll.js` never worked.** `getElementById(window.location.hash)` - the
  hash carries its own `#`, so it never matched anything, and a message id that
  is not on this page threw, taking the rest of the page's scripts with it.
- **A channel nobody ever posted in linked to a numbers page that is not
  written for it.**
- **Emoji rendered as `:shortcode:` in everything published from this laptop.**
  The renderer links an emoji only if it can see the file, and the publish
  script staged the emoji directory after the render rather than before. 385
  images were on disk and 137 shortcodes on a single page.

## [v26.08.26.168] - 2026-08-26

### Added
- **A search box in the sidebar, on every page.** The index itself is 124 MB
  and cannot be in every page; the box can, and hands its query to the search
  page through the URL, which now reads it and runs it as soon as the index has
  loaded.

### Fixed
- **Quoted messages are quotes again.** Slack escapes message text, so a quote
  arrives as `&gt; the thing somebody said`: the markdown renderer looks for
  `>`, does not find it, and the browser draws the entity back as a stray angle
  bracket in front of the sentence. Ten years of quoted articles looked like
  that; 10 056 of them are blockquotes now. The marker is recognised in its
  escaped form and stripped - unescaping the text first would have fixed the
  quotes and handed every message in the archive whatever HTML somebody typed
  into Slack ten years ago.

## [v26.08.26.167] - 2026-08-26

### Changed
- **The archive works on a phone.** It was built as a desktop frameset: a fixed
  250px sidebar beside an iframe sized `calc(100vw - 250px)`, which on a phone
  is a sidebar taking most of the screen and a conversation squeezed into what
  is left. The sidebar is now a drawer under a button on narrow screens - a
  checkbox rather than a script, so it still works in a copy of this archive
  opened from a disk years from now - and closes itself when you pick a
  channel. Messages, charts and tables all fit the width they are given.
- **The search page reads as a list.** It centred everything, so every result
  was its own shrink-to-fit box on the middle line: a hundred results, a
  hundred widths, no two first words in the same place. Results are now a
  left-aligned column of even cards, the channel and time in a quiet line above
  the message, with the search box and filters sticky at the top.

## [v26.08.26.166] - 2026-08-26

### Added
- **Every page has its own name.** A thousand pages were all called `Slack` -
  which is what a browser tab shows, what a bookmark keeps, what a history
  entry says, and what any preview of a shared link would read. A channel page
  is now `#offtopic · 12.4.2019 - 5.5.2019`, a profile is `tsippadai · in the
  archive`, and each carries a one-line description of what is on it.
- **Open Graph tags on every page**, saying the same thing. Slack's own crawler
  cannot see them - the site answers it with 401, which is the entire point of
  the gate - but a bot unfurling on the workspace's behalf can, and that is the
  only way a link into a private archive should ever preview.

## [v26.08.26.165] - 2026-08-26

### Added
- **Slack permalinks in the messages now open the archive.** People quote each
  other constantly and a quote is a permalink; Slack keeps about ninety days,
  so by the time anybody follows one it usually leads to a message Slack threw
  away, in a workspace not every reader can open. 3 135 of them now point at
  this archive instead, at the message itself. Only this workspace's links,
  only channels this site publishes, only files the archive really has -
  everything else is left as somebody wrote it.
- **Every message is a link you can paste into Slack.** The timestamp opens the
  archive at that message with the sidebar and the conversation around it,
  rather than moving a frame nobody can share.
- **`html/pages.js`** - which timestamps start which page, a few hundred of
  them, so a permalink finds its message even as a channel grows and is
  re-chunked. `search.js` knew this and is 124 MB.
- **Google Docs link to the document.** 25 attachments here are Drive links
  that Slack lists as files: nothing was ever downloadable, and the page linked
  a file that cannot exist. It now links the document.

### Fixed
- **A render pass wiped the archive's own identity.** `--no-slack-connect` has
  no auth to report, and writing that absence deleted the workspace URL from
  `slack-archive.json` - which is exactly what tells the renderer that a link
  to morttisenmaansiirto.slack.com is a link to this archive. The write is now
  guarded like every other, and the auth field is kept when a run has nothing
  newer to say.
- **Document previews were only fetched for PDFs**, while the pages show a
  preview for every non-image attachment, so a `.docx` with a preview linked a
  `.png` nobody had downloaded. Slack makes those previews for Office files
  too; all of them are fetched now.

## [v26.08.26.164] - 2026-08-26

### Fixed
- **The pages asked for attachments by a name nothing had saved them under.**
  The downloader names a file after the extension in Slack's URL; the pages
  built `${id}.${filetype}` instead. For most files those agree. For 988 of
  them they do not - a `.jpeg` saved and a `.jpg` linked, a `.png` saved and a
  `.jpg` linked, an `.md` saved and a `.markdown` linked, a file with no
  extension linked as `.docs` - and every one was a broken image on the site,
  indistinguishable from a file that was never downloaded. Both now use one
  function.
- **551 links to `F0123ABC.undefined`.** Slack's free plan hides everything
  past the storage limit and returns the id with no URL, no name and no type;
  the archive has 1 104 of them. There is nothing to download and nothing to
  link, so the page now says the file is one Slack no longer has, instead of
  linking a filename built out of the word "undefined".

## [v26.08.26.163] - 2026-08-26

### Added
- **Every page says when it was made** - "Archive generated 3 days ago", worked
  out in the reader's browser from the exact moment in the markup. A static
  archive looks identical whether it was written last night or stopped
  updating in March, and this one is nightly, so that difference is the
  difference between an archive and a broken one. Without JavaScript the date
  itself still renders.

### Fixed
- **A render pass no longer writes to the archive at all.** With
  `--no-slack-connect` nothing was fetched, so every data file it rewrote could
  only be rewritten with what it had just read - and the nightly render, which
  runs exactly that way over the same data directory as a different user, died
  twice today on `EACCES`. Writes now go through one guard that infers this
  from the argument that decides it, rather than a flag somebody has to
  remember at eight call sites.

## [v26.08.26.162] - 2026-08-26

### Fixed
- **Search on the website was dead, and had been since replies were indexed.**
  A reply sent with "also send to channel" comes back from Slack twice - as a
  top-level message and inside its parent's `replies` - so flattening threads
  produced two rows with one timestamp, 7 598 of them in the busiest channel
  alone. MiniSearch throws on the first duplicate id it is handed, which killed
  the search page before it could show a single result. The flattener now keeps
  one row per timestamp, preferring the copy that knows which thread it belongs
  to.

## [v26.08.26.161] - 2026-08-26

### Changed
- **The gap notice says the messages are gone, because they are.** The
  workspace keeps about 90 days of history: probing `conversations.history`
  inside the gaps returns nothing, and - the part that makes the probe mean
  something - control dates outside the gaps, where the archive does hold
  messages, return them. So the 521 missing days are not a fetch waiting to
  happen, and for everything older than about 90 days this archive is not a
  copy of the workspace, it is the only one.

## [v26.08.26.160] - 2026-08-26

### Added
- **The archive says what it is missing.** 521 days in five stretches - the
  longest 1.2.2022 to 10.9.2022 - have no messages in them, because nothing was
  run then. Stats, bots, names, every channel page and every profile now carry
  a notice saying which days are absent, and a channel's message pages print
  the gap in place, between the last message before it and the first message
  after. A chart that does not say this is simply wrong about those months.
  The stretches are found in the data (`findGaps`), not configured, so they
  correct themselves if the gaps are ever backfilled.
- **Handles, display names and real names are told apart.** They were recorded
  in one pile, so `infosota` (the account's handle), `tsippadai` (the display
  name) and `Jimmie Åkesson` (the real-name field) read as three nicknames. Each
  sighting now records which field it came from, and the names pages label
  them. `nameAt`, which signs old messages, prefers what somebody was actually
  called and falls back to the real-name field only when nothing else covers
  that date.
- **Profile titles are kept, next to the statuses.** In this workspace the
  title field is used exactly like the status line - "value creator", "Euroopan
  viimeinen uusliberalisti" - and nothing was reading it. It is snapshotted
  with the statuses, kept apart from them in the record, and shown in the same
  pile on the profile page.

  The search database keeps both distinctions too, so the bot answers "who was
  John Stuart Bill in 2021" with a name somebody actually went by rather than
  with whatever was in the real-name field.

### Fixed
- **A run that cannot reach Slack no longer rewrites the emoji list with
  nothing.** The nightly render pass runs `--no-slack-connect` over the same
  data directory as a different user and died twice on
  `EACCES: .../data/emojis.json` while carrying no new information at all.

## [v26.08.26.159] - 2026-08-26

### Added
- **Custom emoji are downloaded, all of them, once per run.** The archiver
  scanned each run's messages for the emoji used in their *reactions* and
  downloaded those. An emoji only ever typed in message text was never fetched;
  neither was one used in a channel that had no new messages that night. The
  whole workspace list is a few hundred small files and `downloadURL` skips
  what is already on disk, so the run after the first is nearly free. Aliases
  are stored under their own name, because `:salut-2:` is what the page asks
  for.
- **Every message links to itself.** The timestamp is now the permalink to the
  anchor each message already had, and the linked message is highlighted when
  you arrive at it.
- **The avatar and the name on a message link to that person's profile page.**
  Both pages existed; nothing connected them.
- **A search link in the sidebar.** `search.html` was built, published and
  reachable only by typing the URL.

### Fixed
- **Custom emoji rendered as an empty box.** The `<img>` src was the absolute
  filesystem path of the machine that rendered the page - a broken image
  everywhere else, and the archive is published to a website. It is now
  relative, like avatars. An emoji that was never downloaded now shows its
  shortcode instead of nothing.
- **Seven dead profile links per channel page.** Two places decided who has a
  profile page: the renderer wrote one for everyone with a message in a
  published channel, bots excluded, while the links were offered to anyone with
  a user id - Slackbot, channel members who never posted, accounts that only
  ever reacted. One function, `profilePageIds`, now answers that question for
  the pages and for every link to them, and the profiles are rendered before
  the channel pages so the links know. Verified against the rendered tree:
  every profile link has a page, every page has a link.
- **Bots are off the names page.** They never renamed themselves, the names
  mined for them come from their own message signatures, and every row linked
  to a profile page that is not written for bots.

## [v26.08.26.158] - 2026-08-26

### Fixed
- **`search.js` carried private-channel message text to the website.** One
  flag, `--search-exclude-kinds`, fed two consumers that need different
  answers. `search.db` is read by a bot that gates per user and may hold
  private channels; `search.js` is downloaded whole by every visitor's browser
  and can gate nothing. Dropping `private` from that flag - correct for the bot
  - put `salahommat` and `metavursti`, names and messages, into a file served
  to every logged-in member, including people who were never in them.

  The browser file now excludes everything **either** consumer excludes: the
  site's kinds plus the index's. A channel kept out of either is kept out of it.

  The HTML side was never affected - `--html-exclude-kinds` did its job and no
  private channel page was ever rendered. Found by koodi-2b on the served copy,
  which is the only place the two flags' divergence was visible.

- **Reactions are back in the index.** They were dropped in .145 when the two
  builders were unified into one mapping: `files` was carried across and
  `reactions` was not, so every index built since had an empty reactions table
  beside an archive holding 144,840 of them.

## [v26.08.26.157] - 2026-08-26

### Fixed
- **`search.js` named channels the file itself excludes.** Its page index was
  built by merging every channel ever paginated - including runs from before
  any exclusion existed - so a file containing only public channels still
  carried 46 page-index entries, among them both private channels and a direct
  message. Ids and page-boundary timestamps, no names and no message text, but
  enough to say those conversations exist and roughly how busy they were. Found
  while publishing that file to a website that contains none of them.

  The page index is now built from the channels the file actually describes, so
  a channel cannot appear in one and not the other. It also makes a reader's
  links fail closed: a link into a channel that was never published would
  otherwise resolve to a page nobody can open.

- **A render no longer claims to be an archive.** `--no-slack-connect` fetches
  nothing, but still stamped `.last-successful-run` - so the publish render,
  which runs that way by design, rewrote the "last successful archive" marker
  every time it built a website out of yesterday's data. The marker now moves
  only when something was actually archived.

## [v26.08.26.156] - 2026-08-26

### Fixed
- **Stop asking Slack for the avatars it has already refused.** A third of the
  older profile-picture URLs in this archive are gone - Slack answers 403 - and
  every run asked for all 71 again, was refused again, and reported the same
  number. That is 71 requests a night to re-learn a settled answer.

  A refusal is now recorded on the avatar itself and those are not requested
  again. `downloadURL` distinguishes them from failures that might not repeat:
  a 4xx is the server's settled answer, a 5xx or a timeout is not, so a network
  blip does not permanently mark a picture as gone. Deleting the `refused`
  field makes a run try once more.

  The summary line says what happened to each: downloaded, refused, failed,
  already here, and known-gone and not asked for.

## [v26.08.26.155] - 2026-08-26

### Added
- **The new data reaches the pages and the index**, rather than sitting in JSON
  nothing reads.

  Channel pages show membership - a count, and the members themselves with how
  much each has posted there, linked to their profiles - under a note saying
  what the number means: membership as it stands now, because Slack cannot be
  asked who was in a channel last year.

  The search index gains `user_statuses(user_id, text, emoji, first, last)` and
  `channel_members(channel_id, user_id)`, indexed both ways. A bot can now find
  the person whose status said "kaljalla", and - the one that matters - answer
  who was in a conversation, which is what showing a private channel only to
  its members requires.

## [v26.08.26.154] - 2026-08-26

### Added
- **Statuses are recorded.** Slack keeps no history of them and, unlike names
  and profile pictures, there is nothing to mine - a status is never quoted in
  a message - so every run snapshots what everybody's status says and appends
  it to `data/user-status.json` when it changes. Profile pages list them with
  the window each was seen in.

  A cleared status is deliberately not a row: the gap between two statuses says
  the same thing, and a row per blank would bury the ones that say something.

- **Channel membership is recorded**, onto `channels.json` as `members`.
  No channel in a Slack archive has ever carried one, which means
  per-conversation access - showing a private channel or a DM only to the
  people who were in it - has nothing to be built on. `conversations.members`
  answers for today only, so every day nobody records it is a day that cannot
  be reconstructed. One call per channel, failing soft: a channel the token
  cannot read keeps the membership it already had rather than being recorded as
  empty.

  Both of these begin at the first run that has them. Neither is recoverable
  backwards, which is the whole argument for adding them before more days pass.

## [v26.08.25.153] - 2026-08-26

### Added
- **The index knows which page holds a message.** `pages(channel_id, page,
  oldest_ts)`, written from the same boundaries `create-html` records while
  paginating.

  A search result that cannot be opened in context is half an answer, and the
  page number has only ever lived in `search.js` - 110 MB of JavaScript, which
  no reasonable reader parses to place one message. Anything reading the SQLite
  index can now turn a hit into a link.

  Pages run newest first and each row records that page's OLDEST timestamp, so
  the page holding a message is the first whose oldest entry is at or below it.
  A timestamp older than every row resolves to nothing rather than to page 0:
  the index cannot say, and a caller handed a confident wrong page would link
  somebody to the wrong conversation.

## [v26.08.25.152] - 2026-08-25

### Fixed
- **The archive shipped an unfilled copy of the search template.**
  `static/search.html` is the template `createSearchHTML` fills in - script tags
  substituted for placeholder comments - and writes to the archive root. The
  wholesale copy of `static/` into `html/` also delivered the raw version, so
  every archive contained `html/search.html`: a page that looks like a second
  search page, is missing every script, and is exactly what somebody assembling
  a site would reasonably pick up. It is no longer copied; `style.css`,
  `drilldown.js`, `scroll.js` and the fonts still are.

## [v26.08.25.151] - 2026-08-25

### Removed
- **Bot mode.** `--bot`, `src/bot.ts` and the `@slack/bolt` dependency are gone,
  and the image's `CMD` is the archiver rather than a Slack client.

  The bot that reads these archives now lives in its own service, with a
  per-user access gate, image search and its own login - none of which belongs
  in a tool whose job is to turn a workspace into static files. What this
  repository provides is the interface between them: `data/search.db`, a plain
  SQLite index.

  `search-db.ts` is kept whole, `searchDatabase()` included, even though nothing
  in this repository now calls it. It is the documented way to read an index
  this tool writes, and it carries the tests asserting that a file in a direct
  message never comes back from a query. Deleting a tested access gate because
  its only caller moved out is how the property gets quietly lost when the next
  caller arrives.

## [v26.08.25.150] - 2026-08-25

### Changed
- **The README describes what the tool now does.** It documented an archive of
  channel pages and a search box; since then it has grown statistics pages for
  the workspace, each channel and each person, a year/month/day/hour
  drill-down, recovered name and profile-picture history, reaction and custom
  emoji figures, and flags for publishing an archive without its direct
  messages.

  Also corrected: the VPS section said the bot needs `search.js`, `users.json`
  and `channels.json`. It opens `search.db` and finds users and channels inside
  it. The rest of that advice was accurate when the index was a JavaScript file
  and has been wrong since it became SQLite.

## [v26.08.25.149] - 2026-08-25

### Changed
- **A message now says what its author was called when they wrote it**, instead
  of listing every name they have ever had.

  `.138` put `Also known as: <every name>` on each message. For somebody with
  37 names that is 1,338 bytes per message, repeated on every one they ever
  wrote: **62% of a rendered page was tooltip**, and the whole archive came to
  969 MB against 588 MB for the same pages without it.

  It was also the wrong answer. On a 2016 message the useful thing is not a
  catalogue - it is `Then known as katthufvud`. The name history carries dated
  windows, so the archive can simply say which name was in use at that moment,
  falling back to the most recent name already begun when a message falls
  between two sightings. The full list still lives on the profile page, one
  click away.

      one page      1,219,099 B  ->  498,942 B
      its tooltips    758,939 B  ->   38,782 B
      whole tree          969 MB ->      588 MB

## [v26.08.25.148] - 2026-08-25

### Fixed
- **Thread replies are in the search index. They never were.** `getMessages`
  returns top-level messages with their replies nested inside them, and every
  index builder mapped only the outer array - so **35,024 messages in this
  archive, about 3% of it, could not be found by search and never could.**
  Disproportionately the answers rather than the questions.

  Found by reconciling two counts that should have matched: the archiver
  counted 1,128,017 messages, the rebuilt index held 1,023,386, and the
  exclusions accounted for all but 33,543 of the difference. The residual was
  the replies.

  A reply carries `p`, its parent's timestamp, because indexing it is easy and
  *linking* it is not: the page index is built from top-level timestamps only,
  so a reply's own timestamp resolves to whichever page range contains it -
  the parent's page usually, and the wrong one whenever a thread ran on past
  the messages below it. The page now comes from the parent and the anchor
  stays the reply's own id, which is rendered inside the parent's block either
  way. The database keeps it as `parent_timestamp` and returns it, so the
  Slack bot can link a reply too.

  Exclusions apply to replies exactly as to parents - a bot's answer in a
  thread is still a bot's answer - and a parent repeated among its own replies,
  which some Slack payloads do, is indexed once.

## [v26.08.25.147] - 2026-08-25

### Fixed
- **"Downloaded 212 past profile pictures" when 141 arrived.** The counter
  counted attempts. Slack refuses a good share of older avatar URLs, those are
  correctly not written to disk, and the summary line reported them as
  downloads anyway - the same shape as a wrapper logging OK for a run that
  archived nothing. It now says what happened: how many were stored, how many
  Slack refused, how many were already there.

## [v26.08.25.146] - 2026-08-25

### Added
- **`--html-exclude-kinds`** leaves whole channel kinds out of the generated
  archive - `im,mpim,private` for one meant to be published.

  It filters the counting as well as the pages, which is the point. Excluding
  only the pages leaves every profile's channel list naming the DM channels and
  every total including them: who talks to whom privately, and how much,
  reconstructable from a site that appears to have no DMs in it. Verified on the
  real channel list: 48 channels not rendered, no DM or group-DM pages, and
  neither private channel named anywhere in the output.

  Not rendering rather than gating, for an archive that is about to be served:
  a page that was never written cannot leak through a wrong proxy rule, a
  forgotten auth block or a shared cookie. And this archive was built with one
  person's user token, so its DMs are their conversations with named other
  people - they can publish their own half of those, not the other half.

## [v26.08.25.145] - 2026-08-25

### Fixed
- **The search exclusions were computed, announced, and applied to nothing on
  the path that builds `search.js`.** `.143` and `.144` printed how many
  channels and users the index would exclude and then indexed them anyway on
  the main path - only the fallback branch, which reads the previous
  `search.js` when a channel's own JSON is missing, was filtered. `.144` fixed
  that for the database builder; the browser-search builder still had it.

  Both builders hand-rolled the same mapping, which is why fixing one left the
  other untouched. There is now one `toSearchMessages`, used by both and
  tested: it filters `bot_id` before the mapping and hidden users after it,
  and carries attachments through so an uncaptioned image stays findable.

  The **after** matters and is why the types did not catch any of this:
  `isMessageSearchable` reads `u`, an archive message calls it `user`, and
  `ArchiveMessage` has an index signature - so `.u` on a raw message is a legal
  read that is always `undefined`, and the filter returned true for everything.
  Clean `tsc`, green tests, nothing excluded. Only counting rows in a rebuilt
  index catches that, so the test now pins the mapped shape.

## [v26.08.25.144] - 2026-08-25

### Added
- **Faces over the years.** Profile pictures have no more history in Slack's API
  than names do, but an avatar URL carries its upload date in its own path, and
  a shared message quotes its author's avatar. Mined across this archive that is
  **212 dated pictures for 13 people** - one of them 81 changes deep, from 2017
  to 2026.

  The pictures are downloaded into the archive rather than hot-linked: an
  archive that renders somebody's 2017 face by fetching Slack is an archive of a
  link. Profile pages show them oldest first, and "new picture" now appears in
  the timeline beside the renames.

  **141 of the 212 arrived; Slack now refuses the rest.** The row shows the ones
  that are actually here, because a line of broken images is worse than a
  shorter line of real ones.

- **`--files-base-url`** points attachment URLs somewhere other than beside the
  HTML - e.g. a proxy in front of a storage box - for archives whose 563 MB of
  pages and 41 GB of media do not live in the same place. It normalises to
  exactly one trailing slash, with a test, because getting that wrong yields
  `https://host/mediafiles/C123/F1.png` on every image and looks fine in review.

### Fixed
- **A refused download was written to disk as the file it failed to fetch.**
  `downloadURL` never checked the response status, and Slack answers an expired
  avatar or attachment link with a 243-byte XML document. That was saved under
  the requested name - an error page called `avatar.png`, a broken image that
  looks downloaded, and which the "already have it" check then skips forever on
  every later run. Found while downloading avatars, but it applies to every
  attachment the archiver has ever fetched.

## [v26.08.25.143] - 2026-08-25

### Changed
- **Bots are out of the search index and off the people pages, by default.**
  Measured across this archive: 68,160 of 1,085,320 messages come from bots and
  apps, 6.3%, with Slackbot alone at 61,233. Those are short repetitive
  autoresponses on common words, so they land in exactly the queries people run
  - a search for "kissa" returned two identical Slackbot lines in the visible
  ten.

  This one needs no naming and no flag to configure: `users.json` marks the
  account and `bot_id` marks the message, so it is derived. `--search-include-bots`
  puts them back. That is a deliberately different default from
  `--search-exclude-kinds`, which stays empty: dropping someone's direct
  messages changes what the archive *is*, while nobody keeps a decade of Slack
  to preserve Slackbot telling them to palauta kissa.

### Added
- **`html/bots.html` - what the bots did**, kept apart rather than deleted.
  Totals, share of everything, messages per year, which bots and where they
  post. The stats page counts people only and links to it; profile pages are
  not generated for bots.

### Fixed
- **A person who once posted through an integration was reclassified as a bot,
  permanently.** `bot_id` appears on messages a *person* sent via Zapier and
  friends, and treating that as proof of what the account IS moved real members
  - and their entire ten years - onto the bots page. It showed up as a bots page
  whose headline said 281 while its own chart summed to 6,390, and as the
  profile count dropping from 17 to 7.

  What an account is comes from the workspace (`is_bot`, `is_app_user`), never
  inferred from one message. `bot_id` still counts at the message level, but
  only where no account owns the message - some bots post with no user entry at
  all, and those would otherwise be nobody's.

## [v26.08.25.142] - 2026-08-25

### Added
- **Reaction stats, and custom emoji get their own billing.** The workspace has
  made 400 emoji of its own, and until now the archive counted a reaction with
  one exactly like a reaction with `:+1:`.

  The stats page gains a Reactions section: how many there were, how many
  distinct emoji, what share used the workspace's own, then a ranking of those
  own emoji drawn **as themselves** - the picture from `html/emojis/` beside the
  name, so `:backman:` is recognisable before it is read - a ranking of every
  emoji, and who reacts most. Profile pages gain reactions given alongside
  reactions received, and the emoji each person reaches for.

  Per emoji the archive now keeps first and last use, usage per year, and who
  gave it, which is what makes "when did :glitch_crab: die" answerable later.

  **`count` and `users` disagree, and the code says which one to believe.**
  Slack truncates the `users` array on a heavily-reacted message while keeping
  `count` honest, so totals come from `count` and givers from `users`, and the
  giver numbers are floors - the page says so rather than implying precision it
  does not have. There is a test for a reaction Slack reports as 40 while naming
  one user.

## [v26.08.25.141] - 2026-08-25

### Added
- **The search index can be told what not to hold.** `--search-exclude-kinds
  im,mpim` keeps direct and group messages out of it; `--search-exclude-users
  historia,backlog` keeps a bot's chatter out, by handle, display name or id,
  so nobody has to look up `U08NYQN3469`.

  Both exclude at **build time**, not query time. The channel row has carried a
  `kind` since .131 and no query has ever filtered on it, which means the index
  held every direct message in the workspace and only good manners kept them out
  of results. A database that cannot answer a question is a different thing from
  one that merely does not: the second leaks the day someone writes a new query,
  or opens the file directly - which is exactly what a bot on a VPS does.

  The fallback path is filtered too, and that is the part worth knowing about.
  When a channel yields no messages, both builders fall back to the previous
  `search.js` - a file written before any of this existed. Handing it back
  unfiltered would quietly reinstate precisely what was just withheld, for the
  channels most likely to be empty.

  Empty by default. Archiving your own workspace is not the same as publishing
  it, and silently dropping half of somebody's existing index on upgrade would
  be its own kind of surprise.

## [v26.08.25.140] - 2026-08-25

### Added
- **Drill down through time: year -> month -> day -> hour.** Click a year and it
  opens into twelve months, click a month for its days, click a day for its
  twenty-four hours, with a breadcrumb back out. On all three things the archive
  can be asked about: the whole workspace (`stats.html`), each channel
  (`channel-<id>.html`, new, linked from every channel header and from the
  rankings) and each person (`user-<id>.html`).

  Only the leaves are stored - one number per day and hour, sparsely - and every
  level above is summed in the browser. Counting each level separately would let
  them disagree, and a drill-down whose levels do not add up is worse than none;
  there is a test that the cube totals the same as the message count drawn beside
  it. It is also what keeps the payload small: a decade of hourly buckets is
  87,600 numbers if it ships dense, and a few hundred kilobytes if it ships as
  the days that actually had messages.

  The bars are `<button>`s, not SVG rects. A rect cannot take focus, and this is
  a control rather than a picture - so it works from the keyboard and reads as
  what it is. Empty buckets are drawn and disabled rather than skipped, so a
  quiet month looks quiet instead of vanishing.

  The script is plain, non-module JavaScript for a specific reason: these pages
  are opened straight off a disk over `file://`, where a module script is
  blocked by CORS and would silently do nothing. The server-rendered charts stay
  above it, so a reader with no JavaScript still gets years, hour-of-day and
  every number in a table.

## [v26.08.25.139] - 2026-08-25

### Added
- **Profile pages, one per person, and a stats page for the whole workspace.**

  `html/user-<id>.html` opens with the shape of somebody's decade in one screen
  - messages, names, channels, files, reactions received, active years - then
  messages per year and hour of day, and below that a timeline that reads as one
  dated story: renamed, joined #channel, first message, most recent. Everything
  past the overview is a `<details>`, because the thing that makes a page like
  this useless is scrolling through forty channels to reach the next section.

  `html/stats.html` is the same idea for ten years of everything: totals,
  messages per month across the whole span, per year, hour of day, day of week,
  then who talks, busiest channels and most-used reactions - each ranking
  linked to the page it describes.

  Charts are inline SVG with no library, because these pages are opened from a
  NAS over `file://` with no network and a CDN script tag would render an empty
  box. Hover text is a native `<title>`; every chart also carries its numbers as
  a collapsible table, which is the accessible reading of the same data rather
  than a fallback.

  One hue throughout (validated at >= 3:1 against the page), because every chart
  here measures the same thing - how many messages - against a different axis. A
  second colour would claim a second measure.

  Two bugs in this that only rendering it caught, both invisible in review: a
  `prefers-color-scheme: dark` block on the chart tokens alone painted white
  text onto the archive's white page, since the rest of the archive has no dark
  theme and does not change with the OS; and `preserveAspectRatio="none"`
  stretched the axis labels along with the marks, ten times over, into an
  unreadable smear.

  Counting is a `<details>`-free matter of arithmetic and lives in `src/stats.ts`
  with tests, including the one that matters for honesty: a `channel_join` is a
  message Slack wrote, not something a person said, so it does not count toward
  anybody's total - it becomes a timeline entry instead.

## [v26.08.25.138] - 2026-08-25

### Added
- **The name history is now visible, not just recorded.** .136 and .137 wrote
  `data/user-names.json` and nothing read it.

  Every message's author carries `title="Also known as: ..."`, so hovering a
  ten-year-old message signed `bentsohana` shows dst, katthufvud, Mikael
  Gabriel and the rest. The current name is left out of that list, because
  "also known as bentsohana" beside bentsohana is noise.

  `html/names.html` lists everyone with each name and the window it was seen
  in, linked from the index under People. Dates are when a name was SEEN rather
  than when it was adopted, and each row shows which source it came from -
  a mention is dated by its message, a name recovered from an older rendering
  of these pages only by when that page was written. Showing the source keeps
  that difference visible instead of implied.

  In the JSON as well: `search.js` gains `names` (user id -> every name, oldest
  first) and the database gains a `user_names` table, indexed on both the user
  and the nick, so looking up who was "John Stuart Bill" in 2021 is a query
  rather than a grep. A `search.js` written before this exists reads back with
  an empty `names`, which is what the older archives on disk will do.

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
