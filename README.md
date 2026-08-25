# Export your Slack workspace as static HTML

Alright, so you want to export all your messages on Slack. You want them in a format that you
can still enjoy in 20 years. This tool will help you do that.

 * **Completely static**: The generated files are pure HTML and will still work in 50 years.
 * **Everything you care about**: This tool downloads messages, files, and avatars.
 * **Nothing you do not care about**: Choose exactly which channels and DMs to download.
 * **All types of conversations**: We'll fetch public channels, private channels, DMs, and multi-person DMs.
 * **Incremental backups**: If you already have local data, we'll extend it - no need to download existing stuff again.
 * **JSON included**: All data is also stored as JSON, so you can consume it with other tools later.
 * **No cloud, free**: Do all of this for free, without giving anyone your information.
 * **Advanced search**: Features a fast, browser-based search with channel/user filters and exact phrase matching.
 * **Slack Bot Integration**: Search your archive directly from Slack with a Socket Mode bot.

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
--no-slack-connect:         Don't connect to Slack, just generate HTML from local data.
--force-html-generation:    Force regeneration of HTML files. Useful after slack-archive upgrades.
```

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

 * channels:history
 * channels:read
 * files:read
 * groups:history
 * groups:read
 * im:history
 * im:read
 * mpim:history
 * mpim:read
 * remote_files:read
 * users:read

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

~~~bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
npm run cli -- --bot
~~~

### Commands

- `@YourBotName query` - Search for messages containing `query`.
- `@YourBotName "exact phrase"` - Search for messages containing the exact phrase.

The bot will return the top 5 matches, including the channel, user, date, and a snippet of the message.

### Lightweight VPS Deployment

If you want to run the bot on a VPS with limited storage, you **do not need the generated HTML files**. The bot only requires the following:

- `data/search.js` (contains the indexed messages)
- `data/users.json` and `data/channels.json`
- `data/avatars/` and `data/emojis/` (optional, for metadata)

You can safely exclude the `/html/` directory to save significant disk space.
