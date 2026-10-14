/**
 * Turns the textarea contents into Slack messages.
 *
 * Shared between the server (which builds the real payload) and the browser
 * (which renders a live preview from the exact same tokens).
 *
 * Why this exists: inside a Block Kit `rich_text` block, a `text` element is
 * literal. `:wave:` stays the characters ":wave:" and `https://…` is not
 * clickable. Slack wants dedicated `emoji`, `link`, `user`, `usergroup`,
 * `channel` and `broadcast` elements instead, so we tokenize every line.
 * https://docs.slack.dev/reference/block-kit/blocks/rich-text-block
 * https://docs.slack.dev/reference/block-kit/block-elements/emoji-element
 * https://docs.slack.dev/reference/block-kit/block-elements/link-element
 */

export type Style = { bold?: true; italic?: true; strike?: true; code?: true };

export type Token =
  | { type: 'text'; text: string; style?: Style }
  | { type: 'link'; url: string; text?: string; style?: Style }
  | { type: 'emoji'; name: string }
  | { type: 'user'; id: string }
  | { type: 'usergroup'; id: string }
  | { type: 'channel'; id: string }
  | { type: 'broadcast'; range: 'here' | 'channel' | 'everyone' };

export type Item = { level: number; tokens: Token[] };

/** Slack renders nested lists up to this indent. */
export const MAX_INDENT = 5;

// ---------------------------------------------------------------------------
// Lines → list items
// ---------------------------------------------------------------------------

const BULLET_PREFIX = /^(?:[-*•]|\d+[.)])\s+/;

/**
 * Every non-empty line becomes a list item. Indentation decides nesting:
 * a tab or two spaces is one level. A line can be at most one level deeper
 * than the line above it, so sloppy indentation never produces gaps.
 * A leading "- ", "* ", "• " or "1. " is stripped, since we render bullets.
 */
export function parseLines(raw: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  let prev = -1;

  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') continue;

    const ws = line.match(/^[ \t]*/)![0];
    let width = 0;
    for (const ch of ws) width += ch === '\t' ? 2 : 1;

    const level = Math.min(Math.floor(width / 2), prev + 1, MAX_INDENT);
    const text = line.trim().replace(BULLET_PREFIX, '');
    if (text === '') continue;

    out.push({ level, text });
    prev = level;
  }

  return out;
}

export function parseItems(raw: string): Item[] {
  return parseLines(raw).map(({ level, text }) => ({ level, tokens: tokenize(text) }));
}

// ---------------------------------------------------------------------------
// Inline tokenizer
// ---------------------------------------------------------------------------

// Slack's own syntax, e.g. <@U123>, <!subteam^S123>, <#C123|name>, <!here>,
// <https://example.com|label>. Pasting it straight from Slack keeps working.
const SLACK_ANGLE = /<([@#!]?[^<>\s|][^<>|]*)(?:\|([^<>]*))?>/y;
// Markdown link: [label](https://example.com)
const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/y;
// Bare URL. Trailing punctuation is trimmed afterwards.
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>]+/y;
// :emoji: with an optional skin tone, e.g. :wave::skin-tone-3:
const EMOJI = /:([a-z0-9_+'-]+):(?::(skin-tone-[2-6]):)?/iy;

const STYLE_MARKERS: Record<string, keyof Style> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
};

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
const isSpace = (ch: string | undefined) => !ch || /\s/.test(ch);

function matchAt(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

function trimUrl(url: string): string {
  // Drop trailing punctuation, but keep a closing paren that has a partner
  // inside the URL (Wikipedia-style links).
  while (/[.,;:!?'"*_~]$/.test(url) || (url.endsWith(')') && count(url, '(') < count(url, ')'))) {
    url = url.slice(0, -1);
  }
  return url;
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

function angleToken(body: string, label: string | undefined, style?: Style): Token | null {
  if (body.startsWith('@')) {
    const id = body.slice(1);
    return /^[UW][A-Z0-9]+$/.test(id) ? { type: 'user', id } : null;
  }
  if (body.startsWith('#')) {
    const id = body.slice(1);
    return /^[CG][A-Z0-9]+$/.test(id) ? { type: 'channel', id } : null;
  }
  if (body.startsWith('!subteam^')) {
    const id = body.slice('!subteam^'.length);
    return /^S[A-Z0-9]+$/.test(id) ? { type: 'usergroup', id } : null;
  }
  if (body === '!here' || body === '!channel' || body === '!everyone') {
    return { type: 'broadcast', range: body.slice(1) as 'here' | 'channel' | 'everyone' };
  }
  if (/^(?:https?:\/\/|mailto:)/i.test(body)) {
    return { type: 'link', url: body, ...(label ? { text: label } : {}), ...(style ? { style } : {}) };
  }
  return null;
}

/**
 * Find the closing marker for a *bold* / _italic_ / ~strike~ run that opens
 * at `start`. Follows Slack's rules: the run must hug its content (no space
 * right inside the markers) and must not be glued to surrounding words.
 */
function findClose(s: string, start: number, marker: string): number {
  if (isWordChar(s[start - 1]) || isSpace(s[start + 1])) return -1;
  for (let j = start + 2; j < s.length; j++) {
    if (s[j] === marker && !isSpace(s[j - 1]) && !isWordChar(s[j + 1])) return j;
  }
  return -1;
}

export function tokenize(s: string, style: Style = {}): Token[] {
  const tokens: Token[] = [];
  const hasStyle = Object.keys(style).length > 0;
  const st = hasStyle ? style : undefined;
  let buf = '';

  const flush = () => {
    if (buf) tokens.push(st ? { type: 'text', text: buf, style: st } : { type: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    let m: RegExpExecArray | null;

    // `code` — contents stay literal.
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        tokens.push({ type: 'text', text: s.slice(i + 1, end), style: { ...style, code: true } });
        i = end + 1;
        continue;
      }
    }

    // *bold*, _italic_, ~strike~ (nestable).
    const styleKey = STYLE_MARKERS[ch];
    if (styleKey && !style[styleKey]) {
      const end = findClose(s, i, ch);
      if (end !== -1) {
        flush();
        tokens.push(...tokenize(s.slice(i + 1, end), { ...style, [styleKey]: true }));
        i = end + 1;
        continue;
      }
    }

    if (ch === '<' && (m = matchAt(SLACK_ANGLE, s, i))) {
      const tok = angleToken(m[1], m[2], st);
      if (tok) {
        flush();
        tokens.push(tok);
        i += m[0].length;
        continue;
      }
    }

    if (ch === '[' && (m = matchAt(MD_LINK, s, i))) {
      flush();
      tokens.push({ type: 'link', url: m[2], text: m[1], ...(st ? { style: st } : {}) });
      i += m[0].length;
      continue;
    }

    if ((ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') && !isWordChar(s[i - 1]) && (m = matchAt(BARE_URL, s, i))) {
      const raw = trimUrl(m[0]);
      if (raw.length > 'www.'.length && raw.includes('.')) {
        flush();
        const url = /^www\./i.test(raw) ? `https://${raw}` : raw;
        tokens.push({ type: 'link', url, ...(raw !== url ? { text: raw } : {}), ...(st ? { style: st } : {}) });
        i += raw.length;
        continue;
      }
    }

    // :emoji: — not when glued to a word/number, so "10:30:00" stays text.
    if (ch === ':' && !isWordChar(s[i - 1]) && (m = matchAt(EMOJI, s, i))) {
      flush();
      const name = m[1].toLowerCase();
      tokens.push({ type: 'emoji', name: m[2] ? `${name}::${m[2].toLowerCase()}` : name });
      i += m[0].length;
      continue;
    }

    buf += ch;
    i++;
  }

  flush();
  return mergeText(tokens);
}

function sameStyle(a?: Style, b?: Style) {
  const ka = Object.keys(a ?? {}).sort().join();
  const kb = Object.keys(b ?? {}).sort().join();
  return ka === kb;
}

function mergeText(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (t.type === 'text' && last?.type === 'text' && sameStyle(last.style, t.style)) {
      out[out.length - 1] = { ...last, text: last.text + t.text };
    } else {
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokens → Block Kit rich_text elements
// ---------------------------------------------------------------------------

type RichElement = Record<string, unknown>;

export function tokenToRichElement(t: Token): RichElement {
  switch (t.type) {
    case 'text':
      return t.style ? { type: 'text', text: t.text, style: t.style } : { type: 'text', text: t.text };
    case 'link':
      return {
        type: 'link',
        url: t.url,
        ...(t.text ? { text: t.text } : {}),
        ...(t.style ? { style: t.style } : {}),
      };
    case 'emoji':
      return { type: 'emoji', name: t.name };
    case 'user':
      return { type: 'user', user_id: t.id };
    case 'usergroup':
      return { type: 'usergroup', usergroup_id: t.id };
    case 'channel':
      return { type: 'channel', channel_id: t.id };
    case 'broadcast':
      return { type: 'broadcast', range: t.range };
  }
}

/**
 * Consecutive `rich_text_list` elements with different `indent` values are
 * rendered by Slack as one nested bullet list.
 */
export function itemsToRichTextLists(items: Item[]): RichElement[] {
  const lists: RichElement[] = [];
  let current: { indent: number; elements: RichElement[] } | null = null;

  for (const item of items) {
    if (!current || current.indent !== item.level) {
      current = { indent: item.level, elements: [] };
      lists.push({ type: 'rich_text_list', style: 'bullet', indent: current.indent, elements: current.elements });
    }
    current.elements.push({
      type: 'rich_text_section',
      elements: item.tokens.length ? item.tokens.map(tokenToRichElement) : [{ type: 'text', text: ' ' }],
    });
  }

  return lists;
}

// ---------------------------------------------------------------------------
// Tokens → mrkdwn (top-level `text` field)
// ---------------------------------------------------------------------------

/** & < > must be escaped in mrkdwn text. */
export const escapeMrkdwn = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STYLE_WRAP: [keyof Style, string][] = [
  ['code', '`'],
  ['strike', '~'],
  ['italic', '_'],
  ['bold', '*'],
];

function wrap(text: string, style?: Style) {
  if (!style) return text;
  for (const [key, mark] of STYLE_WRAP) if (style[key]) text = `${mark}${text}${mark}`;
  return text;
}

export function tokenToMrkdwn(t: Token): string {
  switch (t.type) {
    case 'text':
      return wrap(escapeMrkdwn(t.text), t.style);
    case 'link':
      return wrap(t.text ? `<${t.url}|${escapeMrkdwn(t.text)}>` : `<${t.url}>`, t.style);
    case 'emoji':
      return `:${t.name}:`;
    case 'user':
      return `<@${t.id}>`;
    case 'usergroup':
      return `<!subteam^${t.id}>`;
    case 'channel':
      return `<#${t.id}>`;
    case 'broadcast':
      return `<!${t.range}>`;
  }
}

export const tokensToMrkdwn = (tokens: Token[]) => tokens.map(tokenToMrkdwn).join('');

/**
 * Plain mode: keep the text exactly as typed (line breaks and indentation
 * included), but make emoji, links and mentions work in mrkdwn.
 */
export function toPlainMrkdwn(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => {
      const indent = line.match(/^[ \t]*/)![0];
      return indent + tokensToMrkdwn(tokenize(line.slice(indent.length)));
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Full message payloads
// ---------------------------------------------------------------------------

export type MessageOptions = { usergroupId: string };

export const footerText = (usergroupId: string) =>
  `please talk in the thread below! • join this usergroup with \`/se group join ${usergroupId}\`!`;

export const THREAD_FOLLOW_UP = ":thread: or don't thread";

export type SlackPayload = { text: string; blocks?: RichElement[] };

/** The daily update: ping + "today:", bullet list, footer. */
export function buildFormattedMessage(raw: string, { usergroupId }: MessageOptions): SlackPayload {
  const items = parseItems(raw);
  if (items.length === 0) throw new Error('Nothing to send.');

  const header = `<!subteam^${usergroupId}> today:`;
  const footer = footerText(usergroupId);

  const blocks: RichElement[] = [
    { type: 'section', text: { type: 'mrkdwn', text: header } },
    { type: 'rich_text', elements: itemsToRichTextLists(items) },
    { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
  ];

  // Used for notifications and clients that can't render blocks.
  const list = items.map((it) => `${'    '.repeat(it.level)}• ${tokensToMrkdwn(it.tokens)}`).join('\n');
  const text = `${header}\n${list}\n\n${footer}`;

  return { text, blocks };
}

/** Plain mode: just the text, no ping, no footer, no blocks. */
export function buildPlainMessage(raw: string): SlackPayload {
  const text = toPlainMrkdwn(raw);
  if (text === '') throw new Error('Nothing to send.');
  return { text };
}
