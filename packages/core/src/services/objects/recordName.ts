/**
 * A RECORD'S TICKET-SIZED NAME, READ BY A MODEL (Chris, 2026-10-03: "we need
 * a better ticket-sized name for what the feature is; not a full request or
 * spec in the title").
 *
 * When a title is longer than a name (`libs/workspace/recordName.ts`,
 * `NAME_MAX`), a classifier reads it and returns a typed `{ name }` — a noun
 * phrase or an imperative a person would put on a ticket ("Sort the library
 * by name, date or last opened"). The words are never cut by code: a title
 * truncated at a character count keeps its first clause and loses its point.
 * The release name (`services/factory/releaseName.ts`) is the same read for a
 * release.
 *
 * Two callers: the typed filing tool, when it is handed a long title
 * (`services/agents/tools/fileRecord.ts`), and `nameOnRead`, which names a
 * record filed before names existed the first time a surface shows it, and
 * keeps the name on `metadata.name` so it is read once. A read that fails
 * returns null and the surface shows the title, as it did before.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { NAME_MAX, wantsName } from '@/libs/workspace/recordName';

type Model = Pick<BaseChatModel, 'bindTools'>;

export const RecordNameSchema = z.object({
  name: z.string().min(2).max(NAME_MAX).describe(`A ticket-sized name for the work: a noun phrase or an imperative of 2 to 9 words, at most ${NAME_MAX} characters, no trailing full stop, in the asker's own terms. "Sort the library by name, date or last opened", "Upload date on each library row". Not the whole ask: no "let me", no "please", no defaults or edge cases.`),
});

const SYSTEM = 'You name a piece of work the way a product team titles a ticket: short, specific, what will be different. You are given the whole ask; the name is what a person reads it by in a list. Answer only through the tool.';

/**
 * A ticket-sized name for a long title, or null when the read failed.
 * @param input - What to name.
 * @param input.orgId - The workspace (whose model and budget it uses).
 * @param input.text - The long title, or the whole ask.
 * @param input.kind - What sort of record it is, in a word ("request"), when known.
 * @param model - Injected in tests.
 */
export async function readRecordName(input: { orgId: string; text: string; kind?: string }, model?: Model): Promise<string | null> {
  const text = input.text.trim();
  if (text === '') {
    return null;
  }
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const m = model ?? await (async () => {
      const { buildChatModelForOrg } = await import('@/libs/llm');
      return buildChatModelForOrg('classifier', input.orgId, { temperature: 0, streaming: false, maxTokens: 120 }) as Promise<Model>;
    })();
    const report = tool(async () => 'recorded', { name: 'name_record', description: 'Name the work.', schema: RecordNameSchema as never });
    const bound = m.bindTools!([report], { tool_choice: 'name_record' } as never);
    const messages: unknown[] = [
      new SystemMessage(SYSTEM),
      new HumanMessage(`${input.kind ? `A ${input.kind}. ` : ''}The ask:\n${text.slice(0, 4_000)}`),
    ];
    // One more read when the first answer is not a name (most often one a few
    // characters over the limit), told what was wrong with it; then the reason
    // is logged and the surface shows the title.
    let reason = 'no name_record call';
    for (let pass = 0; pass < 2; pass++) {
      const res = await bound.invoke(messages as never) as { tool_calls?: Array<{ name: string; args: unknown }> };
      if (!model) {
        const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
        const { FEATURES } = await import('@/libs/Langfuse/features');
        await chargeModelCall({ orgId: input.orgId, feature: FEATURES.RECORD_NAME, role: 'classifier', response: res as never }).catch(() => undefined);
      }
      const call = (res.tool_calls ?? []).find(c => c.name === 'name_record');
      const parsed = call ? RecordNameSchema.safeParse(call.args) : null;
      if (parsed?.success) {
        return parsed.data.name.replace(/\s+/g, ' ').trim();
      }
      const given = call && typeof (call.args as { name?: unknown }).name === 'string' ? (call.args as { name: string }).name : null;
      reason = given === null ? 'no name_record call' : `"${given}" is ${given.length} characters`;
      messages.push(new HumanMessage(`${given === null ? 'Answer through name_record.' : `"${given}" is ${given.length} characters.`} The name must be 2 to 9 words and at most ${NAME_MAX} characters. Try again, shorter.`));
    }
    console.warn('record name: no usable name', { orgId: input.orgId, reason });
    return null;
  } catch (err) {
    console.warn('record name: the read failed', { orgId: input.orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * Keep a name on the record, unless one is there already — a person's, or an
 * earlier read's, is never replaced. One field, written in place: no version,
 * no `object.updated`, nothing downstream wakes for a name.
 * @param orgId - Tenant.
 * @param id - The record.
 * @param name - The name.
 */
export async function keepRecordName(orgId: string, id: number, name: string): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const m = businessObjectSchema.metadata;
  await db
    .update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${m}, '{}'::jsonb) || jsonb_build_object('name', ${name}::text)` })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id), sql`coalesce(${m} ->> 'name', '') = ''`));
}

/** Reads that failed recently, by record, so a page opened again does not pay for the same failure. */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60_000;

/**
 * The record's name for a surface that shows it: the stored name, else — for
 * a title longer than a name — one read now and kept, else the title.
 * @param input - The record.
 * @param input.orgId - Tenant.
 * @param input.id - Its id.
 * @param input.title - Its title.
 * @param input.meta - Its metadata.
 * @param input.kind - Its type, in a word.
 * @param deps - Injected in tests.
 * @param deps.read - The model read.
 * @param deps.keep - Where the name is kept.
 * @param deps.now - The clock.
 */
export async function nameOnRead(
  input: { orgId: string; id: number; title: string; meta: Record<string, unknown>; kind?: string },
  deps: { read?: typeof readRecordName; keep?: typeof keepRecordName; now?: () => number } = {},
): Promise<string> {
  const stored = typeof input.meta.name === 'string' ? input.meta.name.trim() : '';
  if (!wantsName(input.title, input.meta)) {
    return stored || input.title;
  }
  const key = `${input.orgId}:${input.id}`;
  const now = (deps.now ?? Date.now)();
  if (now - (failedAt.get(key) ?? -Infinity) < RETRY_AFTER_MS) {
    return input.title;
  }
  const name = await (deps.read ?? readRecordName)({ orgId: input.orgId, text: input.title, kind: input.kind });
  if (!name) {
    failedAt.set(key, now);
    return input.title;
  }
  await (deps.keep ?? keepRecordName)(input.orgId, input.id, name).catch((err: unknown) => {
    console.warn('record name: could not keep the name', { orgId: input.orgId, id: input.id, message: (err as Error).message });
  });
  return name;
}
