/**
 * The arguments `propose_action` takes, as a module of its own.
 *
 * It lived inline in the tool factory, which was fine for the agent and left
 * nothing else able to read it. The workspace loader now checks every eval
 * rule that names a `propose_action` argument against this shape before a
 * dataset is applied, so a check pointing at `suggested_decison` or
 * `action_input.feilds.startDate` is refused at push instead of failing every
 * run for a reason nobody can see. Keeping the schema here, with no tool or
 * database import, is what lets the loader use it offline.
 */

import { z } from 'zod';
import { SUGGESTED_DECISIONS } from './suggestedDecision';

export const proposeActionArgsSchema = z.object({
  action_id: z.string().describe('Registered action id, e.g. "hubspot.update" or "gmail.send"'),
  action_input: z.record(z.string(), z.unknown()).describe('The action\'s input payload (e.g. for hubspot.update: { objectType: "deals", objectId: "123", properties: { dealstage: "..." } })'),
  confidence: z.number().min(0).max(1).describe('Your confidence this change is correct, 0–1 (e.g. 0.85)'),
  rationale: z.string().describe('One or two sentences: WHY this change, citing the evidence'),
  evidence: z.array(z.string()).optional().describe('Source doc uris/ids backing the proposal (e.g. gmail message ids, hubspot record uris)'),
  suggested_decision: z.enum(SUGGESTED_DECISIONS).describe('Required on every proposal. What you think the reviewer should DO, which is a different question from how confident you are: "approve" to go ahead, "reject" if you believe this should be turned down, "snooze" if it is worth another look later. Always pick the one that best fits the criteria you were given — an unsure read is still a read, and "I would lean to approving this" is worth more to a reviewer than silence. Say "reject" when that is genuinely your call: filing a record you think should be declined is how a person sees your judgement. Advisory: a person always decides, and this never makes anything run on its own.'),
  suggested_decision_reason: z.string().describe('Required on every proposal. ONE short sentence for why you recommended that, in plain words a reviewer can check: "third listing of this same show this week", "date has already passed", "venue is outside the coverage area". Keep it to roughly that length — it is read beside a badge on a card, so one clause beats two, and a paragraph is wrong however true it is. This is not the same as `rationale` — that one argues your payload is right, this one argues what should happen to it, which is the whole content of a "reject". Name the one thing that tipped it, do not restate the payload, and do not say how confident you feel.'),
  suggested_snooze_until: z.string().optional().describe('ISO timestamp for when this is worth revisiting. Only meaningful with suggested_decision "snooze".'),
});

/*
 * WHAT THE MODEL PLAINLY MEANT, ACCEPTED.
 *
 * Production, the 14 days to 2026-09-28: 15 of 172 propose_action calls
 * missed this schema, and every miss was one of three shapes —
 *
 *   1. `action_input` sent as a JSON STRING instead of an object (13 of 15),
 *      often one closing brace short of parsing (tool_call 12421: the
 *      properties object closed, the payload did not);
 *   2. the envelope fields left out, or folded into the payload;
 *   3. `evidence` as one string rather than a list of them.
 *
 * None of those is a different intent; each is the object the model had in
 * mind, written the wrong way. So the call is normalised BEFORE the schema
 * reads it. Not with `z.preprocess`: a transform cannot be converted to the
 * JSON Schema the model is sent, and one on update_object failed every turn
 * of every agent (#731, `registry.schema.test.ts`). The tool-call wrapper
 * (`services/agents/toolCallRecord.ts`) applies this to the arguments, so
 * LangChain's own validation reads the repaired call while the schema the
 * model is sent stays the one above.
 *
 * What it will not do is guess. A string that stops mid-value (conversation
 * 349: 1,588 characters ending "…Filed from chat with <person>, 2026-") is
 * left as it is, and {@link explainProposeActionMiss} tells the model so.
 */

/** Envelope fields a model sometimes nests inside `action_input`. */
const ENVELOPE_KEYS = ['confidence', 'rationale', 'evidence', 'suggested_decision', 'suggested_decision_reason', 'suggested_snooze_until'] as const;

/**
 * Envelope-only keys: no action's input uses them, so once hoisted they are
 * taken out of the payload. `confidence`, `rationale` and `evidence` are also
 * fields of some actions' own inputs (ask.file, the manual hand-off), so those
 * are copied up and left where they were.
 */
const ENVELOPE_ONLY = new Set<string>(['suggested_decision', 'suggested_decision_reason', 'suggested_snooze_until']);

export type JsonObjectRead
  = | { ok: true; value: Record<string, unknown>; repaired: boolean }
    | { ok: false; cut: boolean; length: number; tail: string };

/**
 * Read a JSON object a model wrote as a string.
 *
 * Parses it as it is; failing that, and only when the text ends OUTSIDE a
 * string and after a complete value, appends the closing brackets it is short
 * of — the one repair that cannot change what the model wrote. Text that ends
 * inside a string, or after a key, a colon or a comma, was cut off, and is
 * reported as cut.
 * @param text - The string the model sent.
 */
export function readJsonObjectString(text: string): JsonObjectRead {
  const trimmed = text.trim();
  const fail = (cut: boolean): JsonObjectRead => ({ ok: false, cut, length: text.length, tail: trimmed.slice(-40) });
  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!trimmed.startsWith('{')) {
    return fail(false);
  }
  try {
    const whole = asObject(JSON.parse(trimmed));
    return whole ? { ok: true, value: whole, repaired: false } : fail(false);
  } catch {}
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      open.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (open.pop() !== (ch === '}' ? '{' : '[')) {
        return fail(false);
      }
    }
  }
  const endsOpen = ':,{['.includes(trimmed.at(-1) ?? '');
  if (inString || endsOpen) {
    return fail(true);
  }
  if (open.length === 0) {
    return fail(false);
  }
  const closers = open.reverse().map(o => (o === '{' ? '}' : ']')).join('');
  try {
    const repaired = asObject(JSON.parse(`${trimmed}${closers}`));
    return repaired ? { ok: true, value: repaired, repaired: true } : fail(false);
  } catch {
    // A key with no value ("…, \"status\"") closes into invalid JSON: cut.
    return fail(true);
  }
}

/**
 * A confidence as a number: `0.85`, `"0.85"`, `"85%"`. Anything else is
 * returned unchanged for the schema to refuse.
 * @param value - What the model sent.
 */
function coerceConfidence(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const m = /^(\d+(?:\.\d+)?)\s?(%?)$/.exec(value.trim());
  if (!m) {
    return value;
  }
  const n = Number(m[1]);
  return m[2] === '%' ? n / 100 : n;
}

/**
 * The call the model meant, from the call it sent. Pure: returns a new
 * object, never throws, and leaves anything it cannot read as it was.
 * @param raw - The arguments as the model sent them.
 */
export function normalizeProposeActionArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const args: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (typeof args.action_input === 'string') {
    const read = readJsonObjectString(args.action_input);
    if (read.ok) {
      args.action_input = read.value;
    }
  }
  if (args.action_input && typeof args.action_input === 'object' && !Array.isArray(args.action_input)) {
    const payload: Record<string, unknown> = { ...(args.action_input as Record<string, unknown>) };
    for (const key of ENVELOPE_KEYS) {
      if (args[key] === undefined && payload[key] !== undefined) {
        args[key] = payload[key];
        if (ENVELOPE_ONLY.has(key)) {
          delete payload[key];
        }
      }
    }
    args.action_input = payload;
  }
  if (args.confidence !== undefined) {
    args.confidence = coerceConfidence(args.confidence);
  }
  if (typeof args.evidence === 'string') {
    if (args.evidence.trim()) {
      args.evidence = [args.evidence];
    } else {
      delete args.evidence;
    }
  }
  return args;
}

/**
 * What to tell the model when a propose_action call misses the schema even
 * after {@link normalizeProposeActionArgs} — naming exactly what is wrong, so
 * the next call can be right. Null when there is nothing more specific to say
 * than the schema's own message.
 * @param raw - The arguments as the model sent them, before normalising.
 */
export function explainProposeActionMiss(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const sent = raw as Record<string, unknown>;
  const args = normalizeProposeActionArgs(raw) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof sent.action_input === 'string' && typeof args.action_input === 'string') {
    const read = readJsonObjectString(sent.action_input);
    const chars = sent.action_input.length.toLocaleString('en-US');
    problems.push(!read.ok && read.cut
      ? `action_input was cut off after ${chars} characters (it stops mid-value at "…${read.tail}") — send it again, shorter, as an object, not a string`
      : `action_input is a string of ${chars} characters that does not read as a JSON object — send it as an object, not a string`);
  } else if (args.action_input === undefined) {
    problems.push('action_input is missing — send the action\'s payload as an object');
  } else if (typeof args.action_input !== 'object' || args.action_input === null || Array.isArray(args.action_input)) {
    problems.push('action_input must be an object');
  }
  const missing: string[] = [];
  if (typeof args.action_id !== 'string' || !args.action_id) {
    missing.push('action_id');
  }
  if (typeof args.confidence !== 'number' || Number.isNaN(args.confidence) || args.confidence < 0 || args.confidence > 1) {
    missing.push(args.confidence === undefined ? 'confidence (a number 0–1)' : `confidence as a number 0–1 (got ${JSON.stringify(args.confidence).slice(0, 40)})`);
  }
  if (typeof args.rationale !== 'string' || !args.rationale.trim()) {
    missing.push('rationale');
  }
  if (!(SUGGESTED_DECISIONS as readonly unknown[]).includes(args.suggested_decision)) {
    missing.push('suggested_decision ("approve", "reject" or "snooze")');
  }
  if (typeof args.suggested_decision_reason !== 'string' || !args.suggested_decision_reason.trim()) {
    missing.push('suggested_decision_reason');
  }
  if (args.evidence !== undefined && !(Array.isArray(args.evidence) && args.evidence.every(e => typeof e === 'string'))) {
    missing.push('evidence as a list of strings');
  }
  if (missing.length > 0) {
    const them = missing.length === 1 ? 'it' : 'them';
    problems.push(`${problems.length > 0 ? 'and ' : ''}${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or wrong — send ${them} beside action_input, not inside it`);
  }
  if (problems.length === 0) {
    return null;
  }
  return `Not recorded: invalid arguments for propose_action — ${problems.join('; ')}. Nothing ran. Fix that and call propose_action again.`;
}
