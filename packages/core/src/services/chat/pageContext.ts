/**
 * Where the person is in the app when they ask (ticket 058).
 *
 * Off a record page the dock is the everything-scoped conversation, but the
 * person is still looking at something: the review queue, the personalization
 * list, an agent's page. The client sends that as `page_context` with each
 * turn and the model reads it as a note under the message, so an unqualified
 * question ("what is waiting?") is answered about the page rather than about
 * the whole workspace. The persisted transcript keeps the raw message; the
 * note is for the model only, and a scoped dock (a lead page) never sends one.
 */

export type PageContext = { path: string; title: string };

const MAX = 200;

/**
 * Validate the client's `page_context`: two short strings, or nothing.
 * Anything else (missing, wrong shape, empty, oversized) reads as no context,
 * never as an error, because the message itself is still fine to answer.
 * @param raw - `body.page_context` as posted.
 */
export function readPageContext(raw: unknown): PageContext | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { path, title } = raw as Record<string, unknown>;
  if (typeof path !== 'string' || typeof title !== 'string') {
    return null;
  }
  const p = path.trim().slice(0, MAX);
  const t = title.trim().slice(0, MAX);
  if (!p) {
    return null;
  }
  return { path: p, title: t };
}

/**
 * The message as the model sees it: the person's words, then where they are.
 * @param message - What the person typed.
 * @param ctx - The page they are on, or null for a scoped or full-page chat.
 */
export function withPageContext(message: string, ctx: PageContext | null): string {
  if (!ctx) {
    return message;
  }
  const where = ctx.title ? `"${ctx.title}" (${ctx.path})` : ctx.path;
  return `${message}\n\n--- where I am ---\nI am looking at ${where} in the app. Unless I say otherwise, take my question to be about what that page shows.`;
}
