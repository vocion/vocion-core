/**
 * A conversation's name, written after its first reply.
 *
 * A thread is titled the moment the person sends their first message: the
 * message itself, cut to sixty characters (`ConversationService.deriveTitle`).
 * That reads as the question, not as a name for it — "hey can you look at the
 * northwind renewal and tell me whether…". Once the first answer has landed,
 * the question AND the answer say what the thread is about, so the classifier
 * model — the cheapest role the registry has, never the chat model — names it
 * in at most six words.
 *
 * Three rules, all structural rather than prompted:
 *
 *   - **Only an `auto` title is replaced.** The write is conditional on
 *     `title_source = 'auto'` in the same statement, so a rename that lands
 *     while the model is thinking wins, and a name a person gave (a rename,
 *     an email subject) is never overwritten.
 *   - **Only after the first reply.** Later turns never re-title a thread;
 *     a name that changes under you is not a name.
 *   - **The cut is the fallback.** No key, a slow model, a refusal, a reply
 *     that is not a title: the first-message title stays and nothing is said.
 *
 * Never on the stream's path: callers fire `scheduleConversationTitle` after
 * the turn is persisted and do not await it.
 */

import process from 'node:process';
import { and, asc, eq, sql } from 'drizzle-orm';
import { plainWords } from '@/libs/chat/threadTitle';
import { db } from '@/libs/DB';
import { conversationMessageSchema, conversationSchema } from '@/models/Schema';

/** The most words a generated title may have. */
export const TITLE_MAX_WORDS = 6;
const TITLE_MAX_CHARS = 60;
const TIMEOUT_MS = 8_000;
/** How much of each side the model reads: enough for the gist, never the payload. */
const EXCERPT_MAX = 1_200;

const SYSTEM = [
  'You name a conversation between a person and a workspace assistant, for a list of past conversations.',
  `Reply with the title only: at most ${TITLE_MAX_WORDS} words, sentence case, no quotes, no trailing period, no emoji.`,
  'Name the subject, not the act of asking ("Northwind renewal risk", not "Question about a renewal").',
  'Keep proper nouns as written. Never include ids, email addresses or secrets.',
].join(' ');

/** Test seam: the model call. Returns the reply text, and the raw response for charging. */
export type TitleModel = (system: string, user: string) => Promise<{ text: string; response?: unknown }>;

/**
 * Turn whatever the model said into a title, or null when it is not one.
 *
 * Deterministic post-processing, so the shape is guaranteed whatever the
 * model does: first line only, a `Title:` label and wrapping quotes or
 * markdown dropped, trailing punctuation cut, at most `TITLE_MAX_WORDS`
 * words, first letter capitalised (the rest left alone — proper nouns).
 * @param raw - The model's reply.
 * @returns The cleaned title, or null when nothing usable is left.
 */
export function cleanTitle(raw: string): string | null {
  // Markup off first: a model that answers with a line of its own prose can
  // hand back an image or a bold span, and a title is words.
  let s = plainWords(raw.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '');
  s = s.replace(/^title\s*:\s*/i, '');
  s = s.replace(/^[#*_`>\s-]+/, '').replace(/[*_`]+$/g, '');
  s = s.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  s = s.replace(/[.。!?,;:…\s]+$/u, '').trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  s = words.slice(0, TITLE_MAX_WORDS).join(' ');
  s = s.replace(/[.,;:…\s]+$/u, '');
  if (s.length > TITLE_MAX_CHARS) {
    s = s.slice(0, TITLE_MAX_CHARS).replace(/\s+\S*$/, '') || s.slice(0, TITLE_MAX_CHARS);
  }
  if (!/[\p{L}\p{N}]/u.test(s)) {
    return null;
  }
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function excerpt(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX)}…` : flat;
}

async function defaultModel(orgId: string): Promise<TitleModel> {
  // Lazy: the LLM module validates env on import, and a test with a model seam never needs it.
  const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 40, streaming: false });
  return async (system, user) => {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }]);
    const c = response.content;
    const text = typeof c === 'string'
      ? c
      : Array.isArray(c) ? c.map(part => (part as { text?: string }).text ?? '').join('') : '';
    return { text, response };
  };
}

/**
 * Ask the model for a title. Null on any failure — the caller keeps what it has.
 * @param opts
 * @param opts.orgId - Whose key pays for the call, and whose budget it lands on.
 * @param opts.question - The person's first message.
 * @param opts.answer - The first reply.
 * @param opts.model - Test seam.
 */
export async function generateTitle(opts: { orgId: string; question: string; answer: string; model?: TitleModel }): Promise<string | null> {
  try {
    const model = opts.model ?? await defaultModel(opts.orgId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      model(SYSTEM, `Person: ${excerpt(opts.question)}\n\nAssistant: ${excerpt(opts.answer)}`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('title timed out')), TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (reply.response !== undefined) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: opts.orgId, feature: FEATURES.CHAT_TITLE, role: 'classifier', response: reply.response });
    }
    return cleanTitle(reply.text);
  } catch {
    return null;
  }
}

export type TitleOutcome
  = | { titled: true; title: string }
    | { titled: false; reason: 'not-found' | 'not-auto' | 'not-first-reply' | 'no-title' | 'changed' };

/**
 * Name a thread after its first reply, if nobody has named it.
 *
 * Reads the first person turn and the first assistant turn; runs only when
 * exactly one assistant turn with text exists (the first reply), and writes
 * only while the title is still `auto`. Returns what happened so a test — or
 * a log line — can say why a thread kept its fallback.
 * @param opts
 * @param opts.orgId - Tenant; the conversation must belong to it.
 * @param opts.conversationId - The thread.
 * @param opts.model - Test seam.
 */
export async function titleAfterFirstReply(opts: { orgId: string; conversationId: number; model?: TitleModel }): Promise<TitleOutcome> {
  const [conv] = await db
    .select({ id: conversationSchema.id, titleSource: conversationSchema.titleSource })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.conversationId)));
  if (!conv) {
    return { titled: false, reason: 'not-found' };
  }
  if (conv.titleSource !== 'auto') {
    return { titled: false, reason: 'not-auto' };
  }
  const rows = await db
    .select({ role: conversationMessageSchema.role, content: conversationMessageSchema.content })
    .from(conversationMessageSchema)
    .where(and(
      eq(conversationMessageSchema.conversationId, opts.conversationId),
      sql`length(trim(${conversationMessageSchema.content})) > 0`,
    ))
    .orderBy(asc(conversationMessageSchema.id))
    .limit(50);
  const replies = rows.filter(r => r.role === 'assistant');
  const question = rows.find(r => r.role === 'user');
  if (replies.length !== 1 || !question) {
    return { titled: false, reason: 'not-first-reply' };
  }
  const title = await generateTitle({ orgId: opts.orgId, question: question.content, answer: replies[0]!.content, model: opts.model });
  if (!title) {
    return { titled: false, reason: 'no-title' };
  }
  const updated = await db
    .update(conversationSchema)
    .set({ title, titleSource: 'generated' })
    .where(and(
      eq(conversationSchema.orgId, opts.orgId),
      eq(conversationSchema.id, opts.conversationId),
      eq(conversationSchema.titleSource, 'auto'),
    ))
    .returning({ id: conversationSchema.id });
  return updated.length > 0 ? { titled: true, title } : { titled: false, reason: 'changed' };
}

/**
 * Fire-and-forget form for the turn paths: never awaited, never throws, never
 * delays the stream. Skipped under the unit-test runner unless a model is
 * injected, so a test that persists a turn never calls out to a vendor.
 * @param opts - As {@link titleAfterFirstReply}.
 * @param opts.orgId
 * @param opts.conversationId
 * @param opts.model
 */
export function scheduleConversationTitle(opts: { orgId: string; conversationId: number; model?: TitleModel }): void {
  if (process.env.VITEST && !opts.model) {
    return;
  }
  void titleAfterFirstReply(opts).catch((error: unknown) => {
    console.warn('conversation title: could not name the thread', { conversationId: opts.conversationId }, error);
  });
}
