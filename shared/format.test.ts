import { describe, expect, it } from 'vitest';
import {
  buildFormattedMessage,
  buildPlainMessage,
  itemsToRichTextLists,
  parseItems,
  parseLines,
  tokenize,
} from './format';

describe('parseLines', () => {
  it('nests by indentation and strips bullet markers', () => {
    expect(parseLines('Fixed bug\n  Added logging\n\tAdded tests\n\n- Dashboard\n    * Faster')).toEqual([
      { level: 0, text: 'Fixed bug' },
      { level: 1, text: 'Added logging' },
      { level: 1, text: 'Added tests' },
      { level: 0, text: 'Dashboard' },
      { level: 1, text: 'Faster' },
    ]);
  });

  it('never jumps more than one level deeper', () => {
    expect(parseLines('      deep first\n  a').map((l) => l.level)).toEqual([0, 1]);
  });
});

describe('tokenize', () => {
  it('turns :shortcodes: into emoji elements', () => {
    expect(tokenize('shipped :rocket: :+1: :wave::skin-tone-3:')).toEqual([
      { type: 'text', text: 'shipped ' },
      { type: 'emoji', name: 'rocket' },
      { type: 'text', text: ' ' },
      { type: 'emoji', name: '+1' },
      { type: 'text', text: ' ' },
      { type: 'emoji', name: 'wave::skin-tone-3' },
    ]);
  });

  it('leaves times alone', () => {
    expect(tokenize('meeting at 10:30:00')).toEqual([{ type: 'text', text: 'meeting at 10:30:00' }]);
  });

  it('links bare urls, markdown links and slack links', () => {
    expect(tokenize('see https://example.com/a_(b), [docs](https://x.dev) or <https://y.dev|y>.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', url: 'https://example.com/a_(b)' },
      { type: 'text', text: ', ' },
      { type: 'link', url: 'https://x.dev', text: 'docs' },
      { type: 'text', text: ' or ' },
      { type: 'link', url: 'https://y.dev', text: 'y' },
      { type: 'text', text: '.' },
    ]);
  });

  it('handles www. links and trailing punctuation', () => {
    expect(tokenize('go to www.example.com!')).toEqual([
      { type: 'text', text: 'go to ' },
      { type: 'link', url: 'https://www.example.com', text: 'www.example.com' },
      { type: 'text', text: '!' },
    ]);
  });

  it('parses mentions', () => {
    expect(tokenize('<@U123> <#C456|general> <!subteam^S789> <!here>')).toEqual([
      { type: 'user', id: 'U123' },
      { type: 'text', text: ' ' },
      { type: 'channel', id: 'C456' },
      { type: 'text', text: ' ' },
      { type: 'usergroup', id: 'S789' },
      { type: 'text', text: ' ' },
      { type: 'broadcast', range: 'here' },
    ]);
  });

  it('parses styles without breaking snake_case', () => {
    expect(tokenize('*bold* _it_ ~gone~ `a_b :x:` snake_case_name')).toEqual([
      { type: 'text', text: 'bold', style: { bold: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'it', style: { italic: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'gone', style: { strike: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'a_b :x:', style: { code: true } },
      { type: 'text', text: ' snake_case_name' },
    ]);
  });

  it('keeps unmatched markers as text', () => {
    expect(tokenize('2 * 3 = 6 and a < b')).toEqual([{ type: 'text', text: '2 * 3 = 6 and a < b' }]);
  });
});

describe('rich text lists', () => {
  it('groups consecutive items with the same indent', () => {
    const lists = itemsToRichTextLists(parseItems('a\nb\n  c\nd'));
    expect(lists.map((l) => [l.indent, (l.elements as unknown[]).length])).toEqual([
      [0, 2],
      [1, 1],
      [0, 1],
    ]);
  });
});

describe('buildFormattedMessage', () => {
  it('builds ping, list and footer', () => {
    const { text, blocks } = buildFormattedMessage('Fixed :bug: in https://x.dev', { usergroupId: 'S1' });
    expect(blocks).toHaveLength(3);
    expect(blocks![0]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: '<!subteam^S1> today:' } });
    expect(blocks![1]).toEqual({
      type: 'rich_text',
      elements: [
        {
          type: 'rich_text_list',
          style: 'bullet',
          indent: 0,
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'Fixed ' },
                { type: 'emoji', name: 'bug' },
                { type: 'text', text: ' in ' },
                { type: 'link', url: 'https://x.dev' },
              ],
            },
          ],
        },
      ],
    });
    expect(text).toContain('• Fixed :bug: in <https://x.dev>');
    expect(text).toContain('/se group join S1');
  });

  it('rejects empty input', () => {
    expect(() => buildFormattedMessage('  \n ', { usergroupId: 'S1' })).toThrow();
  });
});

describe('buildPlainMessage', () => {
  it('sends text only, escaped, with links converted', () => {
    expect(buildPlainMessage('  hi :wave: a<b & [site](https://x.dev)\n  sub\n')).toEqual({
      text: 'hi :wave: a&lt;b &amp; <https://x.dev|site>\n  sub',
    });
  });
});
