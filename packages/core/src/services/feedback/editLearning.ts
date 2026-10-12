/**
 * A reviewer's field corrections as evidence for a learning.
 *
 * A reviewer who corrects a field before approving has told the agent it was
 * wrong and shown it the right answer, very often without typing a word about
 * why. The comment classifier reads words only, so those corrections taught
 * nothing unless the reviewer also wrote a note.
 *
 * This reads the corrections themselves. One model call sees the record as the
 * agent proposed it, each corrected field's value before and after, and the
 * reviewer's note when there was one, and returns a learning for each
 * correction that shows a pattern the agent should follow on future records.
 * A one-off fact, or a rewording for style, returns nothing. So does a
 * correction the note already explains: the note is classified on its own,
 * and reading it twice would propose the same rule twice.
 *
 * Nothing is adopted here. Each learning becomes a pending candidate through
 * `ruleRecorder`, which folds a repeat into the rule it repeats, and a person
 * decides — the same gate every other learning goes through.
 *
 * This is the one place a learning may be proposed with no text from the
 * reviewer (compare `queueSignalForLearning` in ReviewService, where a bare
 * click proposes nothing). The difference is that an edit is a correction the
 * reviewer actually made; the model is asked whether it generalises, not to
 * invent a reason for a click.
 *
 * Two ways in, one code path: an app with its own review screen sends
 * `payload.edits` to `POST /api/v1/feedback`, and an approve with an edited
 * payload inside Vocion queues the same shape from `ReviewService.decide`.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModel } from '@/libs/llm';
import { usageMetadataOf } from '@/libs/llm/usage';
import { logger } from '@/libs/Logger';
import { chargeModelCall } from '@/services/budget/chargeModelCall';

/** One corrected field: what the agent proposed and what the reviewer approved. */
export type FieldEdit = { field: string; before: unknown; after: unknown };

/** A learning the model read out of one corrected field. */
export type EditLearning = {
  field: string;
  ruleText: string;
  memoryType?: 'preference' | 'knowledge' | 'procedure';
};

/**
 * Most corrected fields one piece of feedback may carry. A record with more
 * fields than this is not being corrected, it is being rewritten, and the
 * route refuses it rather than sending the model a wall of values.
 */
export const MAX_FIELD_EDITS = 50;
/** Longest field name accepted. Field names are keys, not prose. */
const FIELD_NAME_MAX_CHARS = 200;
/**
 * Largest corrections list accepted, serialized. The payload is stored as it
 * arrives, and a list this size is already far more than the model reads.
 */
const MAX_EDITS_BYTES = 64_000;
/**
 * Most learnings one decision may propose. Each one costs a duplicate check
 * against the step's rules, in a worker that drains one job at a time, so a
 * wholesale rewrite must not hold the queue (the same reason voice learning
 * caps its phrases per decision).
 */
const MAX_LEARNINGS_PER_DECISION = 5;
/** How much of each side of a correction the model reads, and so how much is kept. */
const VALUE_MAX_CHARS = 500;
/** How much of the proposed record the model reads for context. */
const QUOTE_MAX_CHARS = 1_500;
/** How much of the reviewer's note the model reads. */
const NOTE_MAX_CHARS = 2_000;

const LearningsZ = z.object({
  learnings: z.array(z.object({
    field: z.string(),
    rule_text: z.string(),
    // A memory type the model made up costs the learning its type, not the
    // learning itself.
    memory_type: z.enum(['preference', 'knowledge', 'procedure']).optional().catch(undefined),
  })),
});

const SYSTEM = `A reviewer corrected fields on a record an AI agent proposed, then approved it. For each corrected field, decide whether the correction teaches the agent something it should do differently on FUTURE records.

Propose a learning only when the correction shows a pattern: how to read a kind of source, which of several values to choose, how a field should be filled, or a fact about the business that will come up again. Write it as a standalone instruction the agent can follow without seeing this record. Name the pattern (the kind of source, the kind of record, the condition), not only this record's values.

Propose nothing for a field when:
  - the correction fixes a one-off fact the agent could not have known from what it was given;
  - the change is a rewording, trim or reformat with no rule behind it;
  - the reviewer's note already explains this correction, or the rule already proposed from the note covers it. That rule is recorded separately, and restating it would file it twice.

Most corrections teach nothing reusable. No learnings is the common, correct answer.

For each learning also set memory_type: "knowledge" (a fact about the business, a place or a source), "procedure" (how the work should be done) or "preference" (one person's taste).

Return STRICT JSON:
{"learnings": [{"field": "<the corrected field's name, exactly as given>", "rule_text": "...", "memory_type": "knowledge|procedure|preference"}]}

At most one learning per field. Return {"learnings": []} when nothing generalises.`;

/**
 * Read `payload.edits` as the list of corrections it claims to be.
 *
 * The route calls this to refuse a malformed list with a 400, and the worker
 * calls it again on what it claimed from the queue, so a job written by some
 * other path is held to the same shape. A missing `before` or `after` reads as
 * empty, which is what JSON leaves behind when a value was `undefined`.
 * @param value - Whatever arrived as `payload.edits`.
 * @returns The corrections, or the reason they were refused.
 */
export function readFieldEdits(value: unknown): { edits: FieldEdit[] } | { error: string } {
  if (value === undefined || value === null) {
    return { edits: [] };
  }
  if (!Array.isArray(value)) {
    return { error: 'payload.edits must be an array of { field, before, after }' };
  }
  if (value.length > MAX_FIELD_EDITS) {
    return { error: `payload.edits carries ${value.length} corrections; the most accepted is ${MAX_FIELD_EDITS}` };
  }
  if (JSON.stringify(value).length > MAX_EDITS_BYTES) {
    return { error: `payload.edits is larger than ${MAX_EDITS_BYTES} characters; send each value as the reviewer saw it, not whole documents` };
  }
  const edits: FieldEdit[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const field = (item as { field?: unknown } | null)?.field;
    if (typeof item !== 'object' || item === null || typeof field !== 'string' || !field.trim()) {
      return { error: `payload.edits[${index}] needs a non-empty string field` };
    }
    if (field.trim().length > FIELD_NAME_MAX_CHARS) {
      return { error: `payload.edits[${index}].field is longer than ${FIELD_NAME_MAX_CHARS} characters` };
    }
    // One field, one correction: a second entry for it would leave the model
    // two answers and the evidence only one.
    if (seen.has(field.trim())) {
      return { error: `payload.edits[${index}] repeats the field "${field.trim()}"` };
    }
    seen.add(field.trim());
    const entry = item as { before?: unknown; after?: unknown };
    edits.push({ field: field.trim(), before: entry.before ?? null, after: entry.after ?? null });
  }
  return { edits };
}

/**
 * The fields a reviewer changed, comparing what the agent proposed with what
 * the reviewer approved.
 *
 * Only fields the approved payload names are compared: a payload that never
 * mentions a field was not edited on it (the same reading `labelVerdicts` in
 * ReviewService takes). Blank, null and absent are the same empty value, and a
 * list of plain values compares as a set, so a reordered list of tags is not a
 * correction anyone made.
 *
 * Text is kept to what the model reads ({@link VALUE_MAX_CHARS} a side): the
 * edit is evidence, not a copy of the record, and a rewritten email body would
 * otherwise be stored twice over on the job.
 * @param before - The fields the agent proposed.
 * @param after - The fields the reviewer approved.
 */
export function fieldEdits(before: Record<string, unknown>, after: Record<string, unknown>): FieldEdit[] {
  const edits: FieldEdit[] = [];
  for (const [field, next] of Object.entries(after)) {
    const previous = before[field];
    if (comparableValue(previous) === comparableValue(next)) {
      continue;
    }
    edits.push({ field, before: keptValue(previous), after: keptValue(next) });
  }
  return edits;
}

/**
 * A value as a correction keeps it: text trimmed and clipped, a list item by
 * item, anything else as it was.
 * @param value - A field value.
 */
function keptValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return clip(value.trim(), VALUE_MAX_CHARS);
  }
  if (Array.isArray(value) && value.every(isPlainValue)) {
    return value.map(keptValue);
  }
  return value;
}

/**
 * A value reduced to a string two equal answers share.
 * @param value - A field value, proposed or approved.
 */
function comparableValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value) && value.every(isPlainValue)) {
    const items = Array.from(new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))).sort();
    return items.length > 0 ? JSON.stringify(items) : '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, keysInOrder);
  }
  return String(value);
}

/**
 * `JSON.stringify` replacer that writes an object's keys sorted, so the same
 * object built in a different order compares equal.
 * @param _key - The property being written (unused).
 * @param value - Its value.
 */
function keysInOrder(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
}

/**
 * Whether a value is a string, number, boolean or null rather than a structure.
 * @param value - Anything.
 */
function isPlainValue(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/**
 * A field value the way a person reads it: a quoted string, a list as its
 * items, a structure as JSON, and "empty" for nothing.
 * @param value - A field value.
 */
export function readableValue(value: unknown): string {
  const comparable = comparableValue(value);
  if (comparable === '') {
    return 'empty';
  }
  if (Array.isArray(value) && value.every(isPlainValue)) {
    return `"${clip(value.map(item => String(item ?? '').trim()).filter(Boolean).join(', '), VALUE_MAX_CHARS)}"`;
  }
  if (typeof value === 'object') {
    return clip(comparable, VALUE_MAX_CHARS);
  }
  return `"${clip(comparable, VALUE_MAX_CHARS)}"`;
}

/**
 * One correction as a sentence, kept on the candidate as its evidence.
 * @param edit - The corrected field.
 */
export function describeFieldEdit(edit: FieldEdit): string {
  return `Corrected ${edit.field}: ${readableValue(edit.before)} became ${readableValue(edit.after)}.`;
}

/**
 * The record as the agent proposed it, as the lines the model reads for
 * context: one `field: value` per field that has a value, then the agent's own
 * rationale. Bounded, since a record can carry long text.
 * @param fields - The fields the agent proposed.
 * @param rationale - Why the agent proposed it, when it said.
 */
export function describeProposedRecord(fields: Record<string, unknown>, rationale?: string): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => comparableValue(value) !== '')
    .map(([field, value]) => `${field}: ${readableValue(value)}`);
  if (rationale?.trim()) {
    lines.push(`agent rationale: ${clip(rationale.trim(), VALUE_MAX_CHARS)}`);
  }
  return clip(lines.join('\n'), QUOTE_MAX_CHARS);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * What the model is shown: the record, the note, and each correction.
 * @param opts - See {@link proposeEditLearnings}.
 */
function editLearningPrompt(opts: Parameters<typeof proposeEditLearnings>[0]): string {
  const corrections = opts.edits
    .map((edit, index) => `${index + 1}. ${edit.field}\n   before: ${readableValue(edit.before)}\n   after: ${readableValue(edit.after)}`)
    .join('\n');
  return [
    `Record: ${opts.artifactTitle ?? '(untitled)'}`,
    opts.quotedText ? `As the agent proposed it:\n"""${clip(opts.quotedText, QUOTE_MAX_CHARS)}"""` : '',
    opts.note?.trim() ? `Reviewer's note: """${clip(opts.note.trim(), NOTE_MAX_CHARS)}"""` : 'Reviewer\'s note: none',
    opts.noteRule?.trim() ? `Rule already proposed from the note: """${clip(opts.noteRule.trim(), NOTE_MAX_CHARS)}"""` : '',
    `Corrected fields:\n${corrections}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * The text of a chat model's reply, whichever shape its content came in.
 * @param content - `res.content` from a LangChain chat model.
 */
function replyText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? '').join('') : '';
}

/**
 * The learnings in the model's reply, keeping only one per field the reviewer
 * actually corrected. A reply that is not the promised JSON proposes nothing
 * and says so in the log, since every correction in it goes unread.
 * @param raw - The model's reply.
 * @param edits - The corrections it was shown.
 * @param orgId - For the log line.
 */
function readLearnings(raw: string, edits: readonly FieldEdit[], orgId: string | undefined): EditLearning[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim());
  } catch {
    logger.warn('edit learning reply was not JSON; no corrections were read', { orgId, fields: edits.length });
    return [];
  }
  const validated = LearningsZ.safeParse(parsed);
  if (!validated.success) {
    logger.warn('edit learning reply did not match its schema; no corrections were read', { orgId, fields: edits.length });
    return [];
  }
  const corrected = new Set(edits.map(edit => edit.field));
  const seen = new Set<string>();
  const learnings: EditLearning[] = [];
  for (const item of validated.data.learnings) {
    if (learnings.length >= MAX_LEARNINGS_PER_DECISION) {
      break;
    }
    const ruleText = item.rule_text.trim();
    // A field it was not shown is a field the reviewer never corrected.
    if (!ruleText || !corrected.has(item.field) || seen.has(item.field)) {
      continue;
    }
    seen.add(item.field);
    learnings.push({ field: item.field, ruleText, ...(item.memory_type ? { memoryType: item.memory_type } : {}) });
  }
  return learnings;
}

/**
 * Ask the model which corrections, if any, carry a learning.
 *
 * One call for all of a decision's corrections, on the `classifier` role
 * (Haiku), charged and never refused, the same as the comment classifier: it
 * runs in the background behind a decision somebody already made.
 * @param opts - What was corrected, and the context to read it in.
 * @param opts.edits - What the reviewer corrected.
 * @param opts.note - What the reviewer wrote, if anything.
 * @param opts.noteRule - The rule the comment classifier already proposed from the note, if any.
 * @param opts.quotedText - The record as the agent proposed it.
 * @param opts.artifactTitle - The record's name.
 * @param opts.orgId - Org to trace and charge.
 */
export async function proposeEditLearnings(opts: {
  edits: readonly FieldEdit[];
  note?: string;
  noteRule?: string;
  quotedText?: string;
  artifactTitle?: string;
  orgId?: string;
}): Promise<EditLearning[]> {
  if (opts.edits.length === 0) {
    return [];
  }
  const model = buildChatModel('classifier', { temperature: 0 });
  const user = editLearningPrompt(opts);

  const trace = traceFor({
    feature: FEATURES.FEEDBACK_EDIT_LEARNING,
    slug: 'haiku',
    orgId: opts.orgId ?? 'system',
    userId: 'worker',
    input: { artifactTitle: opts.artifactTitle, fields: opts.edits.map(edit => edit.field), hasNote: !!opts.note?.trim() },
  });
  const generation = trace.generation({ name: 'edit-learning', model: 'classifier', input: user });

  const res = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage(user)]);
  const raw = replyText(res.content);

  const usage = usageMetadataOf(res);
  generation.end({
    output: raw,
    usageDetails: usage
      ? cleanUsageDetails({
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache_read_input_tokens: usage.input_token_details?.cache_read,
        })
      : undefined,
  });
  await chargeModelCall({
    orgId: opts.orgId,
    feature: FEATURES.FEEDBACK_EDIT_LEARNING,
    role: 'classifier',
    response: res,
  });

  const learnings = readLearnings(raw, opts.edits, opts.orgId);
  trace.update({ output: { learnings } });
  return learnings;
}
