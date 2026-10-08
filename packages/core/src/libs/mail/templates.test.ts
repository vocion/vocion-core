/**
 * The one shape of a transactional mail (`renderMail`): every text field
 * escaped, one button and only to an http(s) address, a plain-text part that
 * says everything the HTML does, and a preheader the reader never sees in the
 * body.
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMail } from './templates';

const MAIL = {
  subject: 'Join Northwind on Vocion',
  preheader: 'Sam invited you to join Northwind.',
  heading: 'Join Northwind on Vocion',
  paragraphs: ['Sam invited you to join Northwind on Vocion as a member.', 'Accept with this email address.'],
  action: { label: 'Join Northwind', url: 'https://app.northwind.example/sign-up?invite=tok-dana' },
  footnote: 'This invite works once.',
};

describe('renderMail', () => {
  it('writes the plain-text part: heading, paragraphs, the action as "Label: url", the footnote', () => {
    const { subject, text } = renderMail(MAIL);

    expect(subject).toBe('Join Northwind on Vocion');
    expect(text).toBe([
      'Join Northwind on Vocion',
      '',
      'Sam invited you to join Northwind on Vocion as a member.',
      '',
      'Accept with this email address.',
      '',
      'Join Northwind: https://app.northwind.example/sign-up?invite=tok-dana',
      '',
      'This invite works once.',
    ].join('\n'));
  });

  it('renders one button to the action, and hides the preheader', () => {
    const { html } = renderMail(MAIL);

    expect(html.match(/display:inline-block/g)).toHaveLength(1);
    expect(html).toContain('href="https://app.northwind.example/sign-up?invite=tok-dana"');
    expect(html).toContain('<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Sam invited you to join Northwind.</div>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('escapes every text field', () => {
    const evil = '<img src=x onerror="alert(1)">&\'';
    const { html } = renderMail({
      subject: evil,
      preheader: evil,
      heading: evil,
      paragraphs: [evil],
      action: { label: evil, url: 'https://app.northwind.example/?a="b"&c=<d>' },
      footnote: evil,
    });

    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
    expect(html.match(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;/g)?.length).toBe(6);
  });

  it('renders no button for an address that is not http(s)', () => {
    const { html, text } = renderMail({ ...MAIL, action: { label: 'Click', url: 'javascript:alert(1)' } });

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('display:inline-block');
    expect(text).not.toContain('Click:');
  });

  it('leaves out what a mail does not have', () => {
    const { html, text } = renderMail({ subject: 'Hi', heading: 'Hi', paragraphs: ['One line.'] });

    expect(html).not.toContain('display:none');
    expect(html).not.toContain('<a ');
    expect(text).toBe('Hi\n\nOne line.');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter in content and attributes', () => {
    expect(escapeHtml('<a href="x">\'&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
