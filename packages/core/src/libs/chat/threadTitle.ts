/**
 * The fallback name of a thread, shared by the server that stores it and the
 * browser that shows it before the server has answered — so the header reads
 * the same words the row will hold, with no flash between two versions.
 *
 * A thread is named by its first message, cut to sixty characters, the moment
 * it is sent. After the first reply a cheap model may replace that with a
 * short name (`services/chat/conversationTitle.ts`); this stays the answer
 * whenever it does not.
 */

/**
 * Who wrote a thread's title (`conversation.title_source`): `auto` — cut from
 * the first message; `generated` — named by a model after the first reply;
 * `person` — somebody chose it. Only `auto` is ever replaced.
 */
export type ConversationTitleSource = 'auto' | 'generated' | 'person';

/** What a thread is called before anybody has said anything in it. */
export const DEFAULT_THREAD_TITLE = 'New conversation';

/**
 * The first message, whitespace collapsed and cut to `maxLen` with an ellipsis.
 * @param content - The first message as sent.
 * @param maxLen - The longest the title may be.
 */
export function firstMessageTitle(content: string, maxLen = 60): string {
  const s = plainText(content).split(/\s+/).filter(Boolean).join(' ');
  if (s.length <= maxLen) {
    return s || DEFAULT_THREAD_TITLE;
  }
  return `${s.slice(0, maxLen - 1)}…`;
}

/**
 * A message's text without its markdown, for a title: images dropped, links
 * kept as their words, emphasis, code ticks and heading or quote marks taken
 * off (2026-10-23: the history list showed `![](…) **Pro…`). Formatting only;
 * the words are left as written.
 * @param text - The message as typed or written.
 */
export function plainText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[\s([{])\*\*([^*\n]+)\*\*/gm, '$1$2')
    .replace(/(^|[\s([{])__([^_\n]+)__/gm, '$1$2')
    .replace(/(^|[\s([{])\*([^*\s][^*\n]*)\*/gm, '$1$2')
    .replace(/(^|[\s([{])_([^_\s][^_\n]*)_(?=$|[\s)\]}.,!?:;])/gm, '$1$2')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .trim();
}
