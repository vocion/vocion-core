/**
 * ONE READ PER DROPPED FILE: what records it holds, field by field, with how
 * sure the reader is of each value and where on the file it was printed.
 *
 * A badge photo, a business card, a page of notes, a spreadsheet export — the
 * file goes to the extractor model once, as an image block when it is an
 * image and as its text when it is a document (the text the upload extracted,
 * `services/chat/attachments.ts`). No tools are bound: the reader is looking
 * at something a stranger handed over, and it has nothing to call. The answer
 * is a typed envelope, validated here, with one corrective retry for a
 * malformed one — the same contract the sync-time candidate extractor keeps
 * (`libs/processors/candidateExtractor/model.ts`), without its sync budget.
 *
 * Every call is charged and traced; a file the model cannot read is an
 * answer ("unreadable", with the reason), not an error.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { IntakeField } from './fields';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { asRootRun } from '@/libs/agents/rootRun';

/** A file as the reader receives it. */
export type IntakeSource = {
  artifactId: number;
  title: string;
  contentType: string;
  /** A document's extracted text. */
  text?: string;
  /** An image's bytes as a data URL. */
  imageDataUrl?: string;
};

/** One value as read, with where it came from. */
export type ReadValue = {
  value: unknown;
  /** 0..1, the reader's own. */
  confidence: number;
  /** The page of a multi-page file, from 1. */
  page?: number;
  /** The row of a table or spreadsheet, from 1, header excluded. */
  row?: number;
  /** The words as printed, when they differ from the value. */
  quote?: string;
};

/** One record as read off one file. */
export type ReadRecord = {
  fields: Record<string, ReadValue>;
  /** 0..1 — how sure the reader is that this is one whole, real record. */
  confidence: number;
  note?: string;
};

export type ReadOutcome
  = | { status: 'read'; records: ReadRecord[] }
    | { status: 'unreadable'; reason: string };

/** How much of a document's text one read sees. */
export const READ_TEXT_CAP = 60_000;
/** How many records one file may yield; a longer sheet is read in part and says so. */
export const READ_RECORD_CAP = 150;

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

const answerSchema = z.object({
  readable: z.boolean(),
  reason: z.string().optional(),
  records: z.array(z.object({
    fields: z.array(z.object({
      name: z.string(),
      value: valueSchema,
      confidence: z.number().min(0).max(1),
      page: z.number().int().positive().optional(),
      row: z.number().int().positive().optional(),
      quote: z.string().optional(),
    })),
    confidence: z.number().min(0).max(1),
    note: z.string().optional(),
  })).default([]),
});

type Answer = z.infer<typeof answerSchema>;

/**
 * The instructions: what the type holds, and how to answer. Pure.
 * @param opts - What is being read for.
 * @param opts.typeLabel - The type's name ("Lead").
 * @param opts.fields - Its fields.
 * @param opts.hint - What the agent knows about the files ("badges scanned at Northwind Expo 2026").
 */
export function readInstructions(opts: { typeLabel: string; fields: readonly IntakeField[]; hint?: string }): string {
  const lines = opts.fields.map((f) => {
    const kind = f.enum ? `one of ${f.enum.join(' | ')}` : f.type === 'array' ? 'a list of strings' : f.format ? `${f.type} (${f.format})` : f.type;
    return `- ${f.name}: ${kind}${f.description ? ` — ${f.description}` : ''}`;
  });
  return [
    `You read ONE file a person dropped into a conversation — a photo of a badge, a business card, a page of notes, a spreadsheet export — and return every ${opts.typeLabel} record it holds.`,
    opts.hint ? `What the person said about these files: ${opts.hint}` : null,
    `A ${opts.typeLabel} has these fields:`,
    ...lines,
    'Rules:',
    '- Only what is on the file. A value you cannot read is left out, never guessed; a field the file does not show is left out.',
    '- Each value carries your confidence from 0 to 1: 0.9+ printed clearly, 0.6–0.9 partly legible or inferred from layout, under 0.6 a guess you should probably have left out.',
    '- Say where each value is: `page` for a multi-page document, `row` for a table (the first data row is 1). Add `quote` when the printed words differ from the value (a nickname, an abbreviation).',
    '- One record per person or thing. A table is one record per row. A record you are unsure is whole or real gets a low record confidence and a short `note`.',
    '- If nothing on the file is legible (blurred, cut off, blank), answer readable false with the reason in a few words.',
    `- At most ${READ_RECORD_CAP} records.`,
    'Answer with ONLY a JSON object, no prose and no code fences:',
    '{"readable": true, "records": [{"fields": [{"name": "<field>", "value": <value>, "confidence": 0.95, "page": 1}], "confidence": 0.9, "note": "<optional>"}]}',
    'or {"readable": false, "reason": "<why>", "records": []}.',
  ].filter((l): l is string => l !== null).join('\n');
}

/**
 * The model's text, whichever shape the provider returned.
 * @param content - `res.content`.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(c => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

/**
 * The JSON object in an answer, tolerating fences and a sentence before it.
 * @param raw - The model's text.
 */
export function jsonOf(raw: string): unknown {
  const stripped = raw.replace(/```(?:json)?/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('no JSON object in the answer');
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * An answer as the outcome, keeping only declared fields. Pure.
 * @param answer - The validated answer.
 * @param fields - The type's fields.
 */
export function outcomeOf(answer: Answer, fields: readonly IntakeField[]): ReadOutcome {
  if (!answer.readable) {
    return { status: 'unreadable', reason: answer.reason?.trim() || 'nothing on it could be read' };
  }
  const known = new Set(fields.map(f => f.name));
  const records: ReadRecord[] = [];
  for (const r of answer.records.slice(0, READ_RECORD_CAP)) {
    const out: Record<string, ReadValue> = {};
    for (const f of r.fields) {
      if (!known.has(f.name) || f.value === null || f.value === '') {
        continue;
      }
      const prior = out[f.name];
      if (prior && prior.confidence >= f.confidence) {
        continue;
      }
      out[f.name] = {
        value: f.value,
        confidence: f.confidence,
        ...(f.page ? { page: f.page } : {}),
        ...(f.row ? { row: f.row } : {}),
        ...(f.quote ? { quote: f.quote.slice(0, 200) } : {}),
      };
    }
    if (Object.keys(out).length > 0) {
      records.push({ fields: out, confidence: r.confidence, ...(r.note ? { note: r.note.slice(0, 300) } : {}) });
    }
  }
  return records.length > 0 ? { status: 'read', records } : { status: 'unreadable', reason: answer.reason?.trim() || 'no record could be read from it' };
}

export type ReadOptions = {
  orgId: string;
  /** Whose turn: charged to this agent. */
  agentSlug?: string | null;
  userId?: string | null;
  typeLabel: string;
  fields: readonly IntakeField[];
  hint?: string;
  /** Test seam: the model to call. Built for the org when absent. */
  model?: BaseChatModel;
};

/**
 * Read one file.
 * @param source - The file.
 * @param opts - What it is read for, and by whom.
 */
export async function readSource(source: IntakeSource, opts: ReadOptions): Promise<ReadOutcome> {
  if (!source.imageDataUrl && !source.text?.trim()) {
    return { status: 'unreadable', reason: source.contentType.startsWith('image/') ? 'the image could not be loaded' : 'no text could be taken from it (a scan with no text layer, or an empty file)' };
  }
  const [{ chargeModelCall }, { traceFor }, { FEATURES }, { resolvedModelId }] = await Promise.all([
    import('@/services/budget/chargeModelCall'),
    import('@/libs/Langfuse'),
    import('@/libs/Langfuse/features'),
    import('@/libs/llm'),
  ]);
  const model = opts.model ?? await (await import('@/libs/llm')).buildChatModelForOrg('extractor', opts.orgId, {
    temperature: 0,
    thinking: 'off',
    maxTokens: 16_000,
    streaming: false,
  });
  const system = readInstructions({ typeLabel: opts.typeLabel, fields: opts.fields, hint: opts.hint });
  const header = `File: ${source.title} (${source.contentType})`;
  const text = source.text ?? '';
  const human = source.imageDataUrl
    ? new HumanMessage({ content: [{ type: 'text', text: header }, { type: 'image_url', image_url: { url: source.imageDataUrl } }] })
    : new HumanMessage(`${header}${text.length > READ_TEXT_CAP ? `, first ${READ_TEXT_CAP.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters` : ''}\n\n${text.slice(0, READ_TEXT_CAP)}`);
  const trace = traceFor({
    feature: FEATURES.TOOL_EXTRACT,
    slug: opts.agentSlug ?? 'intake',
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { file: source.title, contentType: source.contentType, image: Boolean(source.imageDataUrl), chars: text.length },
  });
  const messages: Array<SystemMessage | HumanMessage | Awaited<ReturnType<BaseChatModel['invoke']>>> = [new SystemMessage(system), human];
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const generation = trace.generation({ name: attempt === 0 ? 'read' : 'read-retry', model: resolvedModelId('extractor') });
    // Its own root run: inside the agent's turn, the turn's callbacks would
    // otherwise stream this answer into the person's transcript.
    const res = await asRootRun(() => model.invoke(messages as never, { signal: AbortSignal.timeout(120_000) }));
    generation.end({ output: contentText(res.content).slice(0, 4000) });
    await chargeModelCall({ orgId: opts.orgId, agentSlug: opts.agentSlug ?? undefined, feature: FEATURES.TOOL_EXTRACT, role: 'extractor', response: res });
    try {
      return outcomeOf(answerSchema.parse(jsonOf(contentText(res.content))), opts.fields);
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 300) : String(err);
      messages.push(res, new HumanMessage(`That answer did not validate: ${lastError}. Answer again with ONLY the JSON object.`));
    }
  }
  return { status: 'unreadable', reason: `the reader's answer could not be used (${lastError})` };
}
