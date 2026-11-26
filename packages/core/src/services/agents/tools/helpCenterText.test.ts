/**
 * The text and cap helpers decide what the model reads and how much of it, so
 * each test pins a boundary a one-off edit could move: where a cut lands, and
 * what survives stripping.
 */
import { describe, expect, it } from 'vitest';
import { capText, firstCharacters, htmlToPlainText, rowsThatFit } from './helpCenterText';

describe('htmlToPlainText', () => {
  it('removes tags and decodes the common entities', () => {
    const html = '<h2>Cancel&nbsp;a booking</h2><p>Open <a href="https://x.example/a">Settings</a> &amp; choose &quot;Cancel&quot;.</p>';

    expect(htmlToPlainText(html)).toBe('Cancel a booking Open Settings & choose "Cancel".');
  });

  it('drops script, style and comment contents instead of reading them as article text', () => {
    const html = '<style>.a{color:red}</style><p>Real text</p><script>track("secret-looking")</script><!-- hidden note -->';

    expect(htmlToPlainText(html)).toBe('Real text');
  });

  it('keeps an unclosed script, an unclosed comment and a lone angle bracket as text, as before', () => {
    expect(htmlToPlainText('<script>never closed</p> and 1 <')).toBe('never closed and 1 <');
    expect(htmlToPlainText('<p>a</p><!-- never closed')).toBe('a <!-- never closed');
  });

  it('matches script and style case-insensitively and ignores a longer tag name that merely starts with them', () => {
    expect(htmlToPlainText('<SCRIPT type="x">bad()</Script ><p>kept</p><STYLE>.a{}</style>')).toBe('kept');
    expect(htmlToPlainText('<scripted>stays</scripted>')).toBe('stays');
  });

  it('converts 4 MB of angle brackets in linear time, not the quadratic time of a tag regex', () => {
    const started = performance.now();
    const text = htmlToPlainText('<'.repeat(4_000_000));

    expect(text).toHaveLength(4_000_000);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('converts 500,000 unclosed script openers in linear time', () => {
    const started = performance.now();
    htmlToPlainText('<script>'.repeat(500_000));

    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('converts 500,000 unclosed comment openers and 500,000 style openers with no closing tag in linear time', () => {
    const started = performance.now();
    htmlToPlainText(`${'<!--'.repeat(500_000)}${'<style >'.repeat(500_000)}`);

    expect(performance.now() - started).toBeLessThan(3000);
  });

  it.each([
    ['500,000 `<script ` openers and a single `>` at the end', () => `${'<script '.repeat(500_000)}>`],
    ['571,428 `<style ` openers and a single `>` at the end', () => `${'<style '.repeat(571_428)}>`],
    ['1,000,000 `<!--` openers and a single `-->` at the end', () => `${'<!--'.repeat(1_000_000)}-->`],
    ['script openers that close with `>` but have no closing tag', () => '<script >'.repeat(450_000)],
    ['script openers and one closing tag only at the very end', () => `${'<script >'.repeat(450_000)}</script>`],
    ['a closing tag only at the very start, then script openers', () => `</script>${'<script >'.repeat(450_000)}`],
    ['mixed script, style and comment openers with no closers', () => '<script ><style ><!--'.repeat(190_000)],
    ['mixed openers with one closer of each kind at the end', () => `${'<script ><style ><!--'.repeat(190_000)}</script></style>-->`],
    ['closing-tag lookalikes (`</script` plus spaces, no `>`)', () => `<script >${'</script   '.repeat(350_000)}`],
  ])('converts %s in linear time', (_label, build) => {
    const input = build();
    const started = performance.now();
    htmlToPlainText(input);

    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('still removes a block whose closer sits after thousands of unclosed openers of the same kind', () => {
    const html = `${'<script '.repeat(2000)}>x</script>kept`;

    expect(htmlToPlainText(html)).toBe('kept');
  });

  it('decodes &amp; last, so an escaped entity stays the text the author wrote', () => {
    expect(htmlToPlainText('Use &amp;lt;b&amp;gt; and &amp;quot;x&amp;quot; and &amp;#39;')).toBe('Use &lt;b&gt; and &quot;x&quot; and &#39;');
    expect(htmlToPlainText('a &lt; b &amp; c &gt; d')).toBe('a < b & c > d');
  });

  it('answers empty text for a missing body', () => {
    expect(htmlToPlainText(null)).toBe('');
  });
});

describe('firstCharacters', () => {
  it('cuts at the limit', () => {
    expect(firstCharacters('abcdef', 3)).toBe('abc');
  });

  it('leaves a short text whole', () => {
    expect(firstCharacters('abc', 3)).toBe('abc');
  });

  it('never leaves half of an emoji at the end', () => {
    // Each emoji is two UTF-16 units; a cut at 3 would split the second one.
    const cut = firstCharacters('😀😀😀', 3);

    expect(cut).toBe('😀');
  });
});

describe('capText', () => {
  it('does not mark a text of exactly the cap as truncated', () => {
    expect(capText('x'.repeat(8000), 8000)).toMatchObject({ truncated: false, totalCharacters: 8000 });
  });

  it('cuts one character over the cap and reports the full length', () => {
    const capped = capText('x'.repeat(8001), 8000);

    expect(capped.text).toHaveLength(8000);
    expect(capped).toMatchObject({ truncated: true, totalCharacters: 8001 });
  });
});

describe('rowsThatFit', () => {
  it('keeps whole rows in order and stops at the first that would pass the cap', () => {
    const rows = [{ a: 'x'.repeat(10) }, { a: 'x'.repeat(10) }, { a: 'x'.repeat(10) }];
    const oneRow = JSON.stringify(rows[0]).length + 1;

    expect(rowsThatFit(rows, 100 + oneRow * 2, 100)).toBe(2);
  });

  it('counts the reserve, so a header cannot push the result past the cap', () => {
    expect(rowsThatFit([{ a: 1 }], 50, 50)).toBe(0);
  });
});
