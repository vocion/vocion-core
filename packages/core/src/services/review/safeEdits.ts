import type { ReviewContentEdit } from '@/libs/actions/types';
import { emailBodyHtml, isHtmlBody } from '@/libs/writing/emailBody';

/**
 * The boundary for copy a reviewer composed.
 *
 * A send's body may now be HTML (`libs/writing/emailBody.ts`), and HTML that
 * arrives over RPC is rendered back to a person and pushed to HubSpot. The
 * editor constrains what it can produce, but a schema in a browser is a
 * convenience, never the guarantee: anything reaching the database goes
 * through here first.
 *
 * Prose is left exactly as it was. Wrapping an agent's plain-text draft into
 * paragraphs at this point would rewrite copy nobody edited, change the hash
 * a check is drawn from, and take an approval back for no reason.
 */

/**
 * One body, safe to store.
 * @param body - As posted: prose from an agent, HTML from the editor.
 */
export function safeBody(body: string): string {
  return isHtmlBody(body) ? emailBodyHtml(body) : body;
}

/**
 * The reviewer's content edits, with every body sanitized.
 * @param edits - As posted.
 */
export function safeContentEdits(edits: readonly ReviewContentEdit[]): ReviewContentEdit[] {
  return edits.map(e => (e.body === undefined ? e : { ...e, body: safeBody(e.body) }));
}
