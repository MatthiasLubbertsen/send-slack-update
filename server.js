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

// Vaste footer-tekst, getoond in een context block (kleiner, gedempt lettertype).
// Zie https://docs.slack.dev/reference/block-kit/blocks/context-block/
const FOOTER_TEXT =
  "I'm ooo, so I likely won't be reading reactions until I'm back from vacation • but I'll catch up on all of them once I return! • join this usergroup with `/se group join S0AK8LYJ8FR`!";

/**
 * Bouwt een enkel lijst-item (rich_text_section) voor gebruik binnen
 * een rich_text_list element.
 *
 * @param {string} text
 * @returns {object}
 */
function buildRichTextSection(text) {
  return {
    type: 'rich_text_section',
    elements: [{ type: 'text', text }],
  };
}

/**
 * Zet de boomstructuur om naar Slack Block Kit "rich_text" elementen.
 *
 * Belangrijk: mrkdwn-tekst met "-" aan het begin van een regel rendert in
 * de Slack API NIET als een echte lijst met inspringing, dit blijft
 * letterlijke tekst (zie https://docs.slack.dev/messaging/formatting-message-text/#lists
 * en https://stackoverflow.com/questions/68482844/how-do-i-post-a-bulleted-list-using-the-slack-api).
 * Om een écht gerenderde bulletlijst te krijgen, moet je een "rich_text"
 * block met "rich_text_list" elementen gebruiken.
 *
 * Nesting wordt bereikt door meerdere rich_text_list elementen achter
 * elkaar te zetten: een lijst met indent 0 voor het hoofdpunt, direct
 * gevolgd door een lijst met indent 1 voor de bijbehorende subpunten.
 * Slack rendert opeenvolgende rich_text_list elementen als één
 * doorlopende, correct geneste lijst.
 *
 * @param {Array<{ text: string, subpoints: string[] }>} mainPoints
 * @returns {object[]} elements voor een "rich_text" block
 */
function buildRichTextListElements(mainPoints) {
  const elements = [];

  for (const point of mainPoints) {
    elements.push({
      type: 'rich_text_list',
      style: 'bullet',
      indent: 0,
      elements: [buildRichTextSection(point.text)],
    });

    if (point.subpoints.length > 0) {
      elements.push({
        type: 'rich_text_list',
        style: 'bullet',
        indent: 1,
        elements: point.subpoints.map(buildRichTextSection),
      });
    }
  }

  return elements;
}

/**
 * Bouwt een platte-tekst fallback van de lijst, gebruikt als "text"
 * top-level parameter (notificaties, screen readers, linkpreviews).
 * Dit is puur een fallback: de daadwerkelijke lijst-opmaak komt uit de
 * "blocks" (rich_text), niet uit deze string.
 *
 * @param {Array<{ text: string, subpoints: string[] }>} mainPoints
 * @returns {string}
 */
function buildFallbackList(mainPoints) {
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
 * de lijst met werkzaamheden als rich_text blocks, en een context block
 * met de vaste footer tekst.
 *
 * @param {string} rawText - Ruwe input uit de textarea
 * @returns {{ text: string, blocks: object[] }}
 */
function buildSlackMessage(rawText) {
  const mainPoints = parseUpdateText(rawText);

  if (mainPoints.length === 0) {
    throw new Error('Geen werkzaamheden gevonden om te versturen.');
  }

  const header = `<!subteam^${SLACK_USERGROUP_ID}> today:`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: header },
    },
    {
      type: 'rich_text',
      elements: buildRichTextListElements(mainPoints),
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: FOOTER_TEXT }],
    },
  ];

  // Platte-tekst fallback: één newline minder na de ping (geen lege regel).
  const fallbackText = `${header}\n${buildFallbackList(mainPoints)}\n\n${FOOTER_TEXT}`;

  return { text: fallbackText, blocks };
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

    const { text: fallbackText, blocks } = buildSlackMessage(text);

    await slackApp.client.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: fallbackText,
      blocks,
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
