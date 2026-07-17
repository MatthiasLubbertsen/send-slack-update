require('dotenv').config();

const express = require('express');
const path = require('path');
const { App } = require('@slack/bolt');

const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const SLACK_USERGROUP_ID = process.env.SLACK_USERGROUP_ID;

// --- Controleer of alle verplichte environment variables aanwezig zijn ---
const requiredEnvVars = {
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  SLACK_CHANNEL_ID,
  SLACK_USERGROUP_ID,
};

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`\u274c Ontbrekende environment variable: ${key}`);
    console.error('   Kopieer .env.example naar .env en vul alle waarden in.');
    process.exit(1);
  }
}

// --- Slack Bolt app in Socket Mode ---
// Bolt wordt hier uitsluitend gebruikt voor authenticatie en de
// Socket Mode-verbinding. Het versturen van berichten gebeurt via de
// officiële Slack Web API (app.client, ofwel de WebClient van Bolt).
const slackApp = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

/**
 * Parseert de ruwe tekst uit de textarea naar een boomstructuur.
 *
 * Regels:
 * - Een regel zonder inspringing is een hoofdpunt.
 * - Een regel die begint met minimaal twee spaties of een tab is een
 *   subpunt van het meest recente hoofdpunt.
 * - Lege regels worden genegeerd.
 * - Whitespace aan begin/einde van elke regel wordt getrimd.
 *
 * @param {string} text - Ruwe input uit de textarea
 * @returns {Array<{ text: string, subpoints: string[] }>}
 */
function parseUpdateText(text) {
  const lines = text.split('\n');
  const mainPoints = [];
  let current = null;

  for (const rawLine of lines) {
    // Lege regels negeren
    if (rawLine.trim() === '') continue;

    const isSubpoint = /^( {2,}|\t)/.test(rawLine);
    const content = rawLine.trim();

    if (isSubpoint) {
      if (!current) {
        // Er is nog geen hoofdpunt: behandel deze regel dan als hoofdpunt
        // zodat er geen data verloren gaat.
        current = { text: content, subpoints: [] };
        mainPoints.push(current);
      } else {
        current.subpoints.push(content);
      }
    } else {
      current = { text: content, subpoints: [] };
      mainPoints.push(current);
    }
  }

  return mainPoints;
}

/**
 * Zet de boomstructuur om naar Slack mrkdwn lijst-syntax.
 * Volgens de officiële Slack documentatie worden lijsten gemaakt met
 * regels die beginnen met "-", en geneste lijsten met exact twee
 * spaties vóór de "-". Er worden nooit unicode bullets gebruikt.
 *
 * @param {Array<{ text: string, subpoints: string[] }>} mainPoints
 * @returns {string}
 */
function buildSlackList(mainPoints) {
  const lines = [];

  for (const point of mainPoints) {
    lines.push(`- ${point.text}`);
    for (const sub of point.subpoints) {
      lines.push(`  - ${sub}`);
    }
  }

  return lines.join('\n');
}

/**
 * Bouwt het volledige Slack bericht: header met usergroup mention,
 * de lijst met werkzaamheden, en de vaste footer tekst.
 *
 * @param {string} rawText - Ruwe input uit de textarea
 * @returns {string}
 */
function buildSlackMessage(rawText) {
  const mainPoints = parseUpdateText(rawText);

  if (mainPoints.length === 0) {
    throw new Error('Geen werkzaamheden gevonden om te versturen.');
  }

  const list = buildSlackList(mainPoints);
  const header = `<!subteam^${SLACK_USERGROUP_ID}> today:`;
  const footer =
    "_I'm ooo, so I won't read y'alls reactions, but I will read them once my vacation is ended! - join this usergroup using '/se group join @matthias-day' - see y'all later!_";

  return `${header}\n\n${list}\n\n${footer}`;
}

// --- Express app: serveert frontend + API ---
const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.static(path.join(__dirname, 'public')));

expressApp.post('/api/send', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res
        .status(400)
        .json({ ok: false, error: 'Geen tekst ontvangen om te versturen.' });
    }

    const message = buildSlackMessage(text);

    await slackApp.client.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: message,
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Fout bij versturen naar Slack:', error);
    const errorMessage =
      error?.data?.error || error.message || 'Onbekende fout bij versturen naar Slack.';
    res.status(500).json({ ok: false, error: errorMessage });
  }
});

// --- Start Slack Bolt (Socket Mode) en daarna de Express server ---
(async () => {
  try {
    await slackApp.start();
    console.log('\u26a1\ufe0f Slack Bolt app draait in Socket Mode');

    expressApp.listen(PORT, () => {
      console.log(`\ud83d\ude80 Server draait op http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('\u274c Kon de app niet starten:', error);
    process.exit(1);
  }
})();
