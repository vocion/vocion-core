/**
 * LINKS INTO GMAIL — one builder, because the shape Gmail accepts is narrow.
 *
 * `https://mail.google.com/mail/u/<address>/#all/<thread>` is a 404: the `u/`
 * segment takes an account INDEX (`u/0`), never an address, and an encoded
 * `@` is not one (2026-10-29: every "Open thread" on a reply draft 404'd).
 * Gmail's own form for "this thread, in this account" is `?authuser=<address>`,
 * which picks the signed-in account by address whatever its index. Pure; safe
 * on the client.
 */

const GMAIL = 'https://mail.google.com/mail/';

/**
 * A place in a mailbox's Gmail.
 * @param mailbox - The account's address, when known; without it Gmail opens the default account.
 * @param where - The fragment: `#all/<thread>`, `#drafts?compose=<message>`, `#sent`.
 */
export function gmailUrl(mailbox: string | null | undefined, where: string): string {
  const hash = where.startsWith('#') ? where : `#${where}`;
  return `${GMAIL}${mailbox ? `?authuser=${encodeURIComponent(mailbox)}` : ''}${hash}`;
}

/**
 * One thread in the owner's Gmail.
 * @param mailbox - The owner's address, when known.
 * @param threadId - The Gmail thread id.
 */
export function gmailThreadUrl(mailbox: string | null | undefined, threadId: string): string {
  return gmailUrl(mailbox, `#all/${threadId}`);
}

/**
 * A stored Gmail link in the form Gmail accepts: a link filed before the
 * builder was fixed (`/mail/u/<address>/#…`) is rewritten to `?authuser=`, and
 * anything else is returned as it was.
 * @param uri - The stored link.
 */
export function canonicalGmailUrl(uri: string): string;
export function canonicalGmailUrl(uri: string | null): string | null;
export function canonicalGmailUrl(uri: string | null): string | null {
  const m = uri ? /^https:\/\/mail\.google\.com\/mail\/u\/([^/#?]+)\/?(#.*)?$/.exec(uri) : null;
  if (!m) {
    return uri;
  }
  const account = decodeURIComponent(m[1]!);
  return account.includes('@') ? gmailUrl(account, m[2] ?? '#inbox') : uri;
}
