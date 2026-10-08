/**
 * The one shape of a transactional mail — an invite, a password reset, a
 * sign-in link: a heading, a few short paragraphs, at most one button, and a
 * line saying what to do if it was not expected. Every such mail goes through
 * {@link renderMail}, so they read alike, carry a plain-text part, and escape
 * whatever a person typed (an Org's name, an inviter's name) the same way.
 *
 * Plain, inline-styled HTML on purpose: mail clients ignore stylesheets and
 * strip most of CSS, and a table-free single column survives all of them.
 * Pure, so Storybook renders the exact HTML a person receives
 * (`features/auth/TransactionalMail.stories.tsx`).
 */

/** What a transactional mail says. Every string is plain text; this escapes it. */
export type TransactionalMail = {
  subject: string;
  /** The first line a mail client previews beside the subject. */
  preheader?: string;
  heading: string;
  paragraphs: readonly string[];
  /** The one thing to do. */
  action?: { label: string; url: string };
  /** Small print under the button: expiry, and what to do if this was unexpected. */
  footnote?: string;
};

export type RenderedMail = { subject: string; html: string; text: string };

/**
 * Escape text for HTML element content and attribute values.
 * @param value - Untrusted text.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whether a URL may be a button's target: http(s) only, so a value that
 * reached a template by mistake cannot become `javascript:`.
 * @param url - The candidate.
 */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const FONT = '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif';

/**
 * The HTML and plain-text parts of a transactional mail.
 * @param mail - What it says.
 */
export function renderMail(mail: TransactionalMail): RenderedMail {
  const url = mail.action ? safeUrl(mail.action.url) : null;
  const paragraphs = mail.paragraphs
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#27272a;">${escapeHtml(p)}</p>`)
    .join('');
  const button = mail.action && url
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(mail.action.label)}</a></p>`
    + `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#71717a;">Or paste this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#52525b;word-break:break-all;">${escapeHtml(url)}</a></p>`
    : '';
  const footnote = mail.footnote
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-size:13px;line-height:1.5;color:#71717a;">${escapeHtml(mail.footnote)}</p>`
    : '';
  const preheader = mail.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(mail.preheader)}</div>`
    : '';
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(mail.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};">`,
    preheader,
    '<div style="max-width:520px;margin:0 auto;padding:32px 16px;">',
    '<div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px 28px;">',
    `<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;font-weight:600;color:#18181b;">${escapeHtml(mail.heading)}</h1>`,
    paragraphs,
    button,
    footnote,
    '</div></div></body></html>',
  ].join('');
  const text = [
    mail.heading,
    '',
    ...mail.paragraphs.flatMap(p => [p, '']),
    ...(mail.action && url ? [`${mail.action.label}: ${url}`, ''] : []),
    ...(mail.footnote ? [mail.footnote] : []),
  ].join('\n').trimEnd();
  return { subject: mail.subject, html, text };
}
