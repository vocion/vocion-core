/**
 * A proposed email as a person reads one — To, Cc, Subject, the body with
 * its line breaks — read off the action payload.
 *
 * The review sheet used to show the payload as JSON under "Show details",
 * with the body as one escaped `\n\n` string. Chris, 2026-09-18, on an email
 * proposal: "there's not enough info to tell me if I should approve or not.
 * The email body should be visible." Approving a send without reading the
 * email is the one decision the review queue exists to prevent, so the email
 * renders as an email, and the JSON stays a detail for engineers.
 */

export type EmailPreviewModel = {
  to: string;
  cc: string | null;
  subject: string;
  /** Body with real line breaks; never HTML. */
  body: string;
  /** True when approving writes a Gmail draft rather than sending. */
  draft: boolean;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * The email in a proposed action, or null when the action is not an email.
 * @param actionId - The registered action id (`gmail.send`).
 * @param input - The action payload as proposed.
 */
export function emailPreviewFrom(actionId: string, input: Record<string, unknown>): EmailPreviewModel | null {
  if (actionId !== 'gmail.send') {
    return null;
  }
  const to = str(input.to);
  const body = str(input.body);
  if (!to || !body) {
    return null;
  }
  return {
    to,
    cc: str(input.cc),
    subject: str(input.subject) ?? '(no subject)',
    body: body.replace(/\r\n/g, '\n').trim(),
    draft: input.draft === true,
  };
}
