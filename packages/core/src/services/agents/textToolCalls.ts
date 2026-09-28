/**
 * A TOOL CALL WRITTEN AS TEXT IS STILL THE CALL.
 *
 * Conversation 355 (2026-09-28): the product manager wrote its two cards out
 * as text — `<recommend_action> {"action_id": "objects.update_meta", …}
 * </recommend_action>` — and both reached the transcript as raw JSON between
 * paragraphs, with nothing to press. The model meant the call; it wrote it in
 * the wrong channel.
 *
 * So the channel is fixed in code, the way `<scratch>` is: the live stream
 * never shows a `<recommend_action>` or `<propose_action>` block
 * (`AnswerStreamer` holds it back), and each block is executed as the real
 * tool it names — the same tool the model would have called, through the
 * same validation, trust ladder and card path. A block that does not parse,
 * or that its tool refuses, is not a card: it becomes one line under the
 * answer saying so (`noteLine`), never raw JSON.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import { noteLine, shapeRecommendCall } from './cardBackstop';

/** The tools a model has been seen writing as text. */
export const TEXT_CALL_TAGS = ['recommend_action', 'propose_action'] as const;
export type TextCallTag = (typeof TEXT_CALL_TAGS)[number];

/** One block the model wrote, as the streamer or the final pass found it. */
export type TextCall = { tag: TextCallTag; body: string };

/** A block read: the call to make, or why there is none. */
export type ParsedTextCall
  = | { ok: true; tag: TextCallTag; args: Record<string, unknown>; label: string }
    | { ok: false; tag: TextCallTag; label: string; reason: string };

const BLOCK = new RegExp(`<(${TEXT_CALL_TAGS.join('|')})>([\\s\\S]*?)</\\1>`, 'g');
const UNCLOSED = new RegExp(`<(${TEXT_CALL_TAGS.join('|')})>([\\s\\S]*)$`);

/**
 * The label a block names, read even when its JSON does not parse.
 * @param body - The block's text.
 */
function labelOf(body: string): string {
  return (/"label"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? 'A recommendation written as text').slice(0, 120);
}

/**
 * Read one block: JSON (optionally in a code fence) holding the tool's arguments.
 * @param call - The block.
 */
export function parseTextCall(call: TextCall): ParsedTextCall {
  const label = labelOf(call.body);
  const text = call.body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, tag: call.tag, label, reason: 'it was written as text and its JSON does not parse' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, tag: call.tag, label, reason: 'it was written as text and is not an object of arguments' };
  }
  const args = raw as Record<string, unknown>;
  if (typeof args.action_id !== 'string' || !args.action_id.trim()) {
    return { ok: false, tag: call.tag, label, reason: 'it was written as text and names no action' };
  }
  return { ok: true, tag: call.tag, args, label: typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 120) : label };
}

/**
 * Take every block out of a finished answer. What is left is the answer; the
 * blocks are the calls. A block still open at the end is taken to the end.
 * @param text - The answer as it stands.
 */
export function extractTextCalls(text: string): { text: string; calls: TextCall[] } {
  const calls: TextCall[] = [];
  let out = text.replace(BLOCK, (_m, tag: string, body: string) => {
    calls.push({ tag: tag as TextCallTag, body });
    return '';
  });
  const open = UNCLOSED.exec(out);
  if (open) {
    calls.push({ tag: open[1] as TextCallTag, body: open[2] ?? '' });
    out = out.slice(0, open.index);
  }
  return { text: calls.length > 0 ? tidy(out) : text, calls };
}

/**
 * The answer with a block's hole closed: no run of blank lines where it was.
 * @param text - The answer with blocks removed.
 */
export function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** What one executed block did. */
export type TextCallOutcome = { tag: TextCallTag; label: string; input: Record<string, unknown>; output: string; ok: boolean };

/**
 * Is a tool's answer a refusal? recommend_action answers `{ok:false, error}`;
 * propose_action answers a sentence.
 * @param output - The tool's answer.
 */
function refusalOf(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { ok?: boolean; error?: string };
    if (parsed && parsed.ok === false) {
      return parsed.error ?? 'its tool refused it';
    }
  } catch {}
  const m = /^\s*(?:Proposal (?:failed|refused)|Not proposed):/.exec(output);
  return m ? output.slice(m[0].length).trim() : null;
}

/**
 * Execute each block as its real tool. Never throws: a block that cannot run
 * is a line for under the answer.
 * @param calls - The blocks, in the order they were written.
 * @param tools - The turn's tools, as the registry built them (wrapped, so each call is recorded).
 * @returns What ran, and the lines to add under the answer.
 */
export async function runTextCalls(calls: readonly TextCall[], tools: readonly StructuredToolInterface[]): Promise<{ outcomes: TextCallOutcome[]; notes: string[] }> {
  const outcomes: TextCallOutcome[] = [];
  const notes: string[] = [];
  for (const call of calls) {
    const parsed = parseTextCall(call);
    if (!parsed.ok) {
      notes.push(noteLine(parsed.label, parsed.reason));
      continue;
    }
    const tool = tools.find(t => t.name === call.tag);
    if (!tool) {
      notes.push(noteLine(parsed.label, `this agent does not hold ${call.tag}`));
      continue;
    }
    const args = call.tag === 'recommend_action' ? shapeRecommendCall(parsed.args) : parsed.args;
    const output = await tool.invoke(args as never).then(
      r => (typeof r === 'string' ? r : String((r as { content?: unknown })?.content ?? '')),
      (err: Error) => JSON.stringify({ ok: false, error: err.message.replace(/\s+/g, ' ').slice(0, 300) }),
    );
    const refused = refusalOf(output);
    outcomes.push({ tag: call.tag, label: parsed.label, input: args, output, ok: refused === null });
    if (refused !== null) {
      notes.push(noteLine(parsed.label, refused));
    }
  }
  return { outcomes, notes };
}
