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
/**
 * The words of a message with its markdown taken off: images gone, links
 * reduced to their text, emphasis and code marks dropped. A title is prose.
 */
export function plainWords(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~#>]+/g, '')
    .split(/\s+/).filter(Boolean).join(' ');
}

export function firstMessageTitle(content: string, maxLen = 60): string {
  const s = plainWords(content);
  if (s.length <= maxLen) {
    return s || DEFAULT_THREAD_TITLE;
  }
  return `${s.slice(0, maxLen - 1)}…`;
}
