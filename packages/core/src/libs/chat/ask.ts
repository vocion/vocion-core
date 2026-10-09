/**
 * CHIPS ARE PROMPTS, NOT SHORTCUTS (founder, 2026-10-09: "This is feeling like
 * a super deterministic button city … If there's a card it should be the
 * result of system thinking"). A chip, a checklist step or a link into chat
 * that asks for something carries the person's own words; the chat sends them
 * once as a real message, and the lead answers in a turn — reasoning over the
 * workspace's live state — raising whatever cards it decides to with its
 * tools. Nothing in chat or the sidebar docks a card by itself.
 */

/** The chat page's query key for an ask sent on arrival. */
export const ASK_PARAM = 'ask';

/**
 * The chat link that sends `text` as the person's message, once, in a fresh thread.
 * @param text - Their words.
 */
export function chatAskHref(text: string): string {
  return `/dashboard/chat?${ASK_PARAM}=${encodeURIComponent(text)}`;
}

/**
 * The ask a query carries, or null. Trimmed and bounded: it is a message, not a payload.
 * @param value - The `ask` query value.
 */
export function askOf(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().slice(0, 500);
  return text.length > 0 ? text : null;
}
