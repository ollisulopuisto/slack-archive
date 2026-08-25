# Export your Slack workspace as static HTML

Alright, so you want to export all your messages on Slack. You want them in a format that you
can still enjoy in 20 years. This tool will help you do that.

- **Completely static**: The generated files are pure HTML and will still work in 50 years.
- **Everything you care about**: This tool downloads messages, files, and avatars.
- **Nothing you do not care about**: Choose exactly which channels and DMs to download.
- **All types of conversations**: We'll fetch public channels, private channels, DMs, and multi-person DMs.
- **Incremental backups**: If you already have local data, we'll extend it - no need to download existing stuff again.
- **JSON included**: All data is also stored as JSON, so you can consume it with other tools later.
- **No cloud, free**: Do all of this for free, without giving anyone your information.
- **Advanced search**: Features a fast, browser-based search with channel/user filters and exact phrase matching - thread replies included.
- **Slack Bot Integration**: Search your archive directly from Slack with a Socket Mode bot.
- **It remembers what Slack forgets**: names people used to go by, and the profile pictures they used to have. Slack keeps no history of either.
- **Statistics**: a page for the workspace, one per channel and one per person, with a year -> month -> day -> hour drill-down.
- **Publishable**: render an archive without the direct messages in it, and serve the attachments from somewhere other than the pages.

<img width="1151" alt="Screen Shot 2021-09-09 at 6 43 55 PM" src="https://user-images.githubusercontent.com/1426799/132776566-0f75a1b4-4b9a-4b53-8a39-e44e8a747a68.png">

## Using it

1. Do you already have a user token for your workspace? If not, read on below on how to get a token.
2. Make sure you have [`node` and `npm`](https://nodejs.org/en/) installed (Node v20.19.0 or newer is recommended). No compiler needed - there are no native modules, so a brand-new Node release works the day it ships.
3. Run `slack-archive`, which will interactively guide you through the options.

To run this forked version (with advanced search and bot features):

```sh
npx github:ollisulopuisto/slack-archive
```

Or you can install it globally:

```sh
npm install -g github:ollisulopuisto/slack-archive
slack-archive --bot
```

### Parameters

```
--automatic:                Don't prompt and automatically fetch all messages from all channels.
--use-previous-channel-config: Fetch messages from channels selected in previous run instead of prompting.
--channel-types             Comma-separated list of channel types to fetch messages from.
                            (public_channel, private_channel, mpim, im)
--exclude-channels          Comma-separated list of channels to exclude, in automatic mode
--no-backup:                Don't create backups. Not recommended.
--keep-backups <n>          How many data_backup_* directories to keep. Default 2.
--no-search:                Don't create a search file, saving disk space.
--search-exclude-kinds      Channel kinds the search index must never hold,
                            e.g. im,mpim (public, private, mpim, im).
--search-include-bots       Keep bots in the search index. Off by default.
--search-exclude-users      Users whose messages the index must never hold,
                            by handle, display name or id. e.g. historia,backlog
--no-file-download:         Don't download files.
--files-base-url            Serve attachments from here instead of from beside
                            the HTML, e.g. https://host/media/. For archives
                            whose pages and media live in different places.
--no-slack-connect:         Don't connect to Slack, just generate HTML from local data.
--force-html-generation:    Force regeneration of HTML files. Useful after slack-archive upgrades.
--html-exclude-kinds        Channel kinds to leave out of the HTML entirely,
                            e.g. im,mpim,private. Filters the pages and the
                            statistics behind them, not just the pages.
```

## What it generates

Beyond a page per channel:

| Page                     | What is on it                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`             | every channel, and links to the pages below                                                                                                                |
| `html/stats.html`        | the whole workspace: messages per month, per year, hour of day, day of week, who talks, busiest channels, reactions                                        |
| `html/channel-<id>.html` | the same questions asked of one channel                                                                                                                    |
| `html/user-<id>.html`    | one person: their decade in numbers, when they post, a dated timeline of renames and joins, the channels they use, every name they have had, and the faces |
| `html/names.html`        | everyone, and everything they have ever been called                                                                                                        |
| `html/bots.html`         | what the bots did, kept off the pages about people                                                                                                         |

The statistics pages carry a **drill-down**: click a year for its months, a month
for its days, a day for its hours. Only one number per day and hour is stored -
every level above is summed in the browser, so the levels cannot disagree with
each other, and a decade fits in a few hundred kilobytes instead of 87,600
numbers.

Charts are inline SVG and the interaction is plain, non-module JavaScript,
because these pages get opened straight off a disk over `file://` where a CDN
script tag renders an empty box and a module script is blocked outright. Every
chart also carries its numbers as a table.

## What it recovers that Slack does not keep

Slack has no history for display names or profile pictures. `users.info`
answers with whoever somebody is today, and yesterday is gone. In a workspace
where renaming yourself is a running joke, that makes ten-year-old messages
unreadable.

Two sources put it back, and neither needs an API that exists:

- **Old mentions carry the name.** Slack used to encode a mention as
  `<@U2H06BCQZ|jaricurry>` - the handle as it was the day that message was
  posted.
- **Shared messages carry the display name and the avatar.** Quoting a message
  as an attachment keeps `author_id` beside `author_name` and `author_icon`,
  and an avatar URL has its upload date in its own path.

In one real ten-year archive that is 173 names for 32 people and 212 dated
profile pictures for 13 of them. A message's author then shows _what they were
called when they wrote it_ rather than what they are called now.

The pictures are downloaded rather than linked, because an archive that renders
somebody's 2017 face by fetching Slack is an archive of a link - and Slack now
refuses a good share of the older URLs, so what arrives is what you get.

Dates are when a name or a face was **seen**, not when it was adopted. Each row
says which source it came from, because a name mined from a mention is dated by
that message while one recovered from an older rendering of these pages is
dated only by when that page was written.

## Publishing an archive

An archive of your own workspace is not automatically a thing you are
publishing. If you do publish one, three flags matter, and they compose:

```sh
slack-archive --no-slack-connect --force-html-generation \
  --html-exclude-kinds im,mpim,private \
  --files-base-url https://example.com/media/
```

`--html-exclude-kinds` filters **the statistics as well as the pages**. Leaving
out only the page files still leaves every profile's channel list naming the DM
channels and every total including their messages - which tells anyone who
looks who talks to whom privately and how much. Not generating a page also
beats gating one: a page that was never written cannot leak through a wrong
proxy rule or a forgotten auth block.

Note that direct messages in an archive are one person's conversations with
named other people. They can publish their own half of those.

For the search index the same idea has its own flags, because an index is read
by things other than a browser: `--search-exclude-kinds`,
`--search-exclude-users`, and bots which are excluded by default
(`--search-include-bots` puts them back). Excluding at build time rather than
at query time means the index cannot answer, rather than merely choosing not
to.

## Getting a token

In order to download messages from private channels and direct messages, we will need a "user
token". Slack uses the token to identify what permissions it'll give this app. We used to be able
to just copy a token out of your Slack app, but now, we'll need to create a custom app and jump
through a few hoops.

This will be mostly painless, I promise.

### 1) Make a custom app

Head over to https://api.slack.com/apps and `Create New App`. Select `From scratch`.
Give it a name and choose the workspace you'd like to export.

Then, from the `Features` menu on the left, select `OAuth & Permission`.

As a redirect URL, enter something random that doesn't actually exist, or a domain you control. For instace:

```
https://notarealurl.com/
```

(Note that redirects will take a _very_ long time if using a domain that doesn't actually exist)

Then, add the following `User Token Scopes`:

- channels:history
- channels:read
- files:read
- groups:history
- groups:read
- im:history
- im:read
- mpim:history
- mpim:read
- remote_files:read
- users:read

Finally, head back to `Basic Information` and make a note of your app's `client
id` and `client secret`. We'll need both later.

### 2) Authorize

Make sure you have your Slack workspace `URL` (aka team name) and your app's `client id`.
Then, in a browser, open this URL - replacing `{your-team-name}` and `{your-client-id}`
with your values.

```
https://{your-team-name}.slack.com/oauth/authorize?client_id={your-client-id}&scope=client
```

Confirm everything until Slack sends you to the mentioned non-existent URL. Look at your
browser's address bar - it should contain an URL that looks like this:

```
https://notarealurl.com/?code={code}&state=
```

Copy everything between `?code=` and `&state`. This is your `code`. We'll need it in the
next step.

Next, we'll exchange your code for a token. To do so, we'll also need your `client secret`
from the first step when we created your app. In a browser, open this URL - replacing
`{your-team-name}`, `{your-client-id}`, `{your-code}` and `{your-client-secret}` with
your values.

```
https://{your-team-name}.slack.com/api/oauth.access?client_id={your-client-id}&client_secret={your-client-secret}&code={your-code}
```

Your browser should now be returning some JSON including a token. Make a note of it - that's what we'll use. Paste it in the command line, OR create a file called `.token` in the slack-archive directory (created when the command is first run) and paste it in there.

## Slack Bot Integration

You can run a Slack bot that allows users to search the archive directly from Slack. The bot uses Socket Mode, so you don't need a public URL.

### Setup

1. Create a new Slack App at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Socket Mode**.
3. Under **App-Level Tokens**, click "Generate" and create a token with `connections:write` scope (save this as `SLACK_APP_TOKEN`).
4. Under **OAuth & Permissions**, add the following **Bot Token Scopes**:
   - `app_mentions:read`
   - `chat:write`
5. Install the app to your workspace and copy the **Bot User OAuth Token** (save this as `SLACK_BOT_TOKEN`).
6. Enable **Event Subscriptions**, and under "Subscribe to bot events", add `app_mention`.

### Usage

Run the bot with the following command:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
npm run cli -- --bot
```

### Commands

- `@YourBotName query` - Search for messages containing `query`.
- `@YourBotName "exact phrase"` - Search for messages containing the exact phrase.

The bot will return the top 5 matches, including the channel, user, date, and a snippet of the message.

### Lightweight VPS Deployment

To run the bot on a VPS with limited storage you **do not need the generated
HTML files**, and you do not need the message JSON either. The bot opens one
file:

- `data/search.db` - the SQLite index, which carries the messages, users and
  channels it needs

`data/search.js` is a separate thing: it is what the browser search page loads,
and what `npm run build-db` falls back to when rebuilding an index on a machine
that has no per-channel JSON. Ship it alongside if you want that rebuild to be
possible; the bot itself never reads it.

Two things to know when copying an index onto a running host:

- **Mount the directory, not the file.** A container with the file bind-mounted
  keeps serving the old inode after the file is replaced, and nothing anywhere
  reports it - the index is updated, the bot is still answering from the
  previous one.
- **The index is built with whatever exclusions were passed to the run that
  built it.** Rebuilding it on the VPS from `search.js` reapplies only what
  that file already had, so an index rebuilt there can quietly reinstate what
  the archiving machine excluded.
