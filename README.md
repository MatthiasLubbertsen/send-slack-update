# Send Slack Update

A small web app for writing your daily update and posting it to a Slack channel.

Type one task per line, indent sub-tasks, and hit **Send to Slack**. A live preview shows what the message will look like.

## What gets sent

**Daily update format** (checkbox on, the default):

```
@your-group today:
  • Fixed the login bug 🐛
      ◦ Added logging
  • Updated the dashboard 🚀
please talk in the thread below! • join this usergroup with `/se group join S…`!
```

…followed by a second message: `🧵 or don't thread`.

**Plain text** (checkbox off): only your text, exactly as written. No ping, no "today:", no footer, no follow-up.

### Formatting

Everything Slack supports works in both modes:

| You type | You get |
|---|---|
| `:rocket:` `:+1:` `:wave::skin-tone-3:` `:custom-emoji:` | emoji |
| `https://example.com`, `www.example.com` | clickable link |
| `[the docs](https://example.com)` or `<https://example.com\|the docs>` | link with a label |
| `*bold*` `_italic_` `~strike~` `` `code` `` | styling |
| `<@U123>` `<#C123>` `<!subteam^S123>` `<!here>` | mentions |

#### Why emoji and links didn't work before

The old version put each bullet into a Block Kit `rich_text` block as a single `text` element. Rich text `text` elements are *literal*: Slack does not turn `:emoji:` or URLs inside them into anything. Slack expects separate [`emoji`](https://docs.slack.dev/reference/block-kit/block-elements/emoji-element), [`link`](https://docs.slack.dev/reference/block-kit/block-elements/link-element), `user`, `usergroup`, `channel` and `broadcast` elements, plus a `style` object for bold/italic/strike/code ([text element](https://docs.slack.dev/reference/block-kit/block-elements/text-element)).

[`shared/format.ts`](shared/format.ts) now tokenizes every line into those elements. Plain-text mode sends [mrkdwn](https://docs.slack.dev/messaging/formatting-message-text) instead, escaping `&`, `<` and `>` as the docs require and converting `[label](url)` into `<url|label>`.

## Running it with Docker

On the server, next to your existing `.env`:

```bash
docker compose up -d --build
```

The app runs on port **3010** (change the left side of `ports` in `docker-compose.yml` to use another one).

### Environment variables

Same `.env` as before, nothing to change. See [`.env.example`](.env.example).

| Variable | Required | |
|---|---|---|
| `SLACK_BOT_TOKEN` | yes | `xoxb-…` bot token |
| `SLACK_CHANNEL_ID` | yes | channel to post to |
| `SLACK_USERGROUP_ID` | yes | group pinged in the daily update |
| `SLACK_APP_TOKEN` | no | no longer used (see below) and safe to leave in place |
| `PORT` | no | only used outside Docker, default `3000` |

The previous version connected over Socket Mode, but it never listened for any Slack events. It only called `chat.postMessage`, so the app now uses the Web API client directly and the app-level token isn't needed.

### Optional scopes

The bot only needs `chat:write`. If you also add `usergroups:read` and `channels:read`, the UI shows `@group-handle` and `#channel-name` instead of their IDs.

## Development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # API on :3000, Vite on :5173 (proxies /api)
npm test               # formatter tests
npm run build          # type-check, build frontend + server
npm start              # serve the production build
```

### Layout

```
shared/format.ts       text → Slack blocks / mrkdwn (used by server and preview)
server/index.ts        Express: /api/send, /api/config, serves the built frontend
src/App.tsx            the page
src/components/ui/     shadcn/ui components (added with the shadcn CLI)
src/components/slack-preview.tsx
```

UI components come from [shadcn/ui](https://ui.shadcn.com). Add more with `npx shadcn@latest add <component>`.

## Slack app setup (first time only)

1. https://api.slack.com/apps → **Create New App** → **From an app manifest** → paste [`manifest.yaml`](manifest.yaml).
2. **OAuth & Permissions** → **Install to Workspace** → copy the **Bot User OAuth Token** into `SLACK_BOT_TOKEN`.
3. In the channel, run `/invite @daily-update-bot`.

## Troubleshooting

| Error | Fix |
|---|---|
| `not_in_channel` | Invite the bot to the channel. |
| `channel_not_found` | `SLACK_CHANNEL_ID` must be the ID (`C…`), not the name. |
| `invalid_auth` / `not_authed` | Bot token is wrong or revoked. Reinstall the app and copy the new token. |
| `Missing environment variable(s)` on start | Your `.env` is missing one of the required values. |
