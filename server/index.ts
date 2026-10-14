import 'dotenv/config';
import path from 'node:path';
import { WebClient, type ChatPostMessageArguments } from '@slack/web-api';
import express from 'express';
import { THREAD_FOLLOW_UP, buildFormattedMessage, buildPlainMessage } from '../shared/format';

// Tolerate inline comments and stray whitespace, e.g. `SLACK_USERGROUP_ID=S0123 #@my-group`.
const env = (name: string) => process.env[name]?.replace(/\s+#.*$/, '').trim() || undefined;

// Either a bot token (xoxb-, posts as the app) or a user token (xoxp-, posts as you).
const SLACK_BOT_TOKEN = env('SLACK_BOT_TOKEN');
const SLACK_CHANNEL_ID = env('SLACK_CHANNEL_ID');
const SLACK_USERGROUP_ID = env('SLACK_USERGROUP_ID');
const PORT = Number(env('PORT')) || 3000;

const missing = Object.entries({ SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_USERGROUP_ID })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing environment variable(s): ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}

const channel = SLACK_CHANNEL_ID!;
const usergroupId = SLACK_USERGROUP_ID!;
const slack = new WebClient(SLACK_BOT_TOKEN, { retryConfig: { retries: 3 } });

/**
 * Names shown in the UI. Looking them up needs the optional
 * `usergroups:read` / `channels:read` scopes; without them we fall back to IDs.
 */
async function lookupNames() {
  const [group, chan] = await Promise.allSettled([
    slack.usergroups.list().then((r) => r.usergroups?.find((g) => g.id === usergroupId)?.handle),
    slack.conversations.info({ channel }).then((r) => r.channel?.name),
  ]);
  return {
    usergroup: (group.status === 'fulfilled' && group.value) || usergroupId,
    channel: (chan.status === 'fulfilled' && chan.value) || channel,
  };
}
const names = lookupNames();

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', async (_req, res) => {
  const fallback = new Promise<{ usergroup: string; channel: string }>((resolve) =>
    setTimeout(() => resolve({ usergroup: usergroupId, channel }), 3000),
  );
  res.json({ usergroupId, ...(await Promise.race([names, fallback])) });
});

app.post('/api/send', async (req, res) => {
  const { text, formatted = true } = req.body ?? {};
  if (typeof text !== 'string' || text.trim() === '') {
    res.status(400).json({ ok: false, error: 'Write something first.' });
    return;
  }

  try {
    const payload = formatted ? buildFormattedMessage(text, { usergroupId }) : buildPlainMessage(text);
    const base = { channel, unfurl_links: false, unfurl_media: false } as const;

    const posted = await slack.chat.postMessage({ ...base, ...payload } as ChatPostMessageArguments);
    if (formatted) {
      await slack.chat.postMessage({ ...base, text: THREAD_FOLLOW_UP });
    }

    let permalink: string | undefined;
    try {
      permalink = (await slack.chat.getPermalink({ channel, message_ts: posted.ts! })).permalink;
    } catch {
      // Not important enough to fail the request over.
    }

    res.json({ ok: true, permalink });
  } catch (error) {
    console.error('Sending to Slack failed:', error);
    const err = error as { data?: { error?: string }; message?: string };
    res.status(500).json({ ok: false, error: err.data?.error || err.message || 'Unknown error.' });
  }
});

const dist = path.resolve(import.meta.dirname, '../dist');
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
