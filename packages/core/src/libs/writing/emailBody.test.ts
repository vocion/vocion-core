/**
 * One field, two shapes: an agent's prose and a reviewer's HTML.
 *
 * These pin the boundary rules, because everything downstream reads a body
 * through them: the voice rules lint the TEXT (a banned phrase must not be
 * able to hide behind a tag), HubSpot gets HTML either way, and nothing that
 * arrives over RPC is trusted enough to render.
 */
import { describe, expect, it } from 'vitest';
import { emailBodyHtml, emailBodyText, isHtmlBody, textToParagraphs } from './emailBody';

describe('which shape a body is', () => {
  it('reads an agent\'s prose as text', () => {
    expect(isHtmlBody('Rowan, saw the hires.\n\nWorth twenty minutes?')).toBe(false);
  });

  it('reads a reviewer\'s composed body as HTML', () => {
    expect(isHtmlBody('<p>Rowan, saw the <strong>hires</strong>.</p>')).toBe(true);
  });

  it('does not mistake a drafted angle bracket for markup', () => {
    // "< 20 minutes" is prose, and treating it as HTML would strip it.
    expect(isHtmlBody('Worth < 20 minutes of your time?')).toBe(false);
  });
});

describe('what HubSpot receives', () => {
  it('wraps prose into paragraphs, breaking single newlines', () => {
    expect(emailBodyHtml('One.\nStill one.\n\nTwo.')).toBe('<p>One.<br>Still one.</p><p>Two.</p>');
  });

  it('passes a reviewer\'s formatting through', () => {
    const html = '<p>Rowan, saw the <strong>hires</strong>.</p><ul><li>One</li><li>Two</li></ul>';

    expect(emailBodyHtml(html)).toBe(html);
  });

  it('keeps a link and its href', () => {
    expect(emailBodyHtml('<p>The <a href="https://example.test/guide">guide</a>.</p>'))
      .toBe('<p>The <a href="https://example.test/guide">guide</a>.</p>');
  });

  it('collapses runs of blank lines rather than emitting empty paragraphs', () => {
    expect(emailBodyHtml('one\n\n\n\ntwo\n\n')).toBe('<p>one</p><p>two</p>');
  });

  it('escapes every markup character a draft can carry', () => {
    expect(emailBodyHtml('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('escapes a drafted angle bracket rather than emitting markup', () => {
    expect(emailBodyHtml('Worth < 20 minutes?')).toBe('<p>Worth &lt; 20 minutes?</p>');
  });
});

describe('nothing that arrives is trusted', () => {
  it('drops a script outright', () => {
    expect(emailBodyHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('drops an event handler while keeping the text', () => {
    expect(emailBodyHtml('<p onclick="steal()">Hi</p>')).toBe('<p>Hi</p>');
  });

  it('drops a javascript: href, keeping the words', () => {
    expect(emailBodyHtml('<p><a href="javascript:alert(1)">click</a></p>')).toBe('<p><a>click</a></p>');
  });

  it('drops an image, a style and a table — none of them survive a send anyway', () => {
    expect(emailBodyHtml('<p>Hi</p><img src="x"><style>p{}</style><table><tr><td>x</td></tr></table>'))
      .toBe('<p>Hi</p>x');
  });

  it('normalises b and i to the tags an email template expects', () => {
    expect(emailBodyHtml('<p><b>Bold</b> and <i>italic</i></p>')).toBe('<p><strong>Bold</strong> and <em>italic</em></p>');
  });
});

describe('what the voice rules read', () => {
  it('returns prose unchanged', () => {
    expect(emailBodyText('Rowan, saw the hires.')).toBe('Rowan, saw the hires.');
  });

  it('reads the words out of a formatted body', () => {
    expect(emailBodyText('<p>Rowan, saw the <strong>hires</strong>.</p><p>Worth twenty minutes?</p>'))
      .toBe('Rowan, saw the hires.\n\nWorth twenty minutes?');
  });

  it('closes the gap a tag in the middle of a phrase would open', () => {
    // The whole reason linting reads text: a banned phrase split across a tag
    // walks straight through a regex over markup.
    expect(emailBodyText('<p>A <strong>game</strong> changer.</p>')).toContain('game changer');
  });

  it('keeps a list readable as lines', () => {
    expect(emailBodyText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n\n• Two');
  });

  it('turns a line break into a newline', () => {
    expect(emailBodyText('<p>One.<br>Two.</p>')).toBe('One.\nTwo.');
  });

  it('brings an escaped bracket back as the character it was', () => {
    expect(emailBodyText(textToParagraphs('Worth < 20 minutes?'))).toBe('Worth < 20 minutes?');
  });
});

describe('the gate the text view exists for', () => {
  it('catches a banned phrase a tag splits in half', async () => {
    // The whole point, end to end: `lintSends` reads the text view, so the
    // formatting a reviewer applied cannot smuggle a phrase past the gate.
    const { lintSends, mergeVoiceRules, PLATFORM_DEFAULT_VOICE_RULES } = await import('./voiceRules');
    const rules = mergeVoiceRules(PLATFORM_DEFAULT_VOICE_RULES, { never: [{ pattern: 'game changer', reason: 'Chris does not say it' }] });

    const plain = lintSends([{ step: 1, subject: 'Hi', body: 'A game changer.' }], rules);
    const formatted = lintSends([{ step: 1, subject: 'Hi', body: '<p>A <strong>game</strong> changer.</p>' }], rules);

    expect(plain.ok).toBe(false);
    expect(formatted.ok).toBe(false);
    expect(formatted.report).toContain('game changer');
  });
});
