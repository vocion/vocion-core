/**
 * THE JUDGE — the second half of a handoff gate (libs/gates/handoffGate.ts).
 *
 * The deterministic half refuses a record that is missing things. This half
 * reads a record that has everything and asks the one question the seat is
 * judged by — the seat's own one-page rubric, with the reference cases as
 * the calibration — and says PASS, RETURN or ESCALATE:
 *
 *  - pass:     the record keeps its new state; `gate.judged` says so.
 *  - return:   the transition is undone, the record reads Returned to the
 *              seat that produced it, with a reason code and one concrete
 *              example. Nobody is interrupted; the seat fixes the work.
 *  - escalate: a person decides — an ask in Review naming the rubric line
 *              in doubt. Used when the judge's own confidence is under the
 *              bar, or a field the gate names always goes to a person
 *              (`alwaysEscalate`, e.g. riskClass schema/billing/auth/infra).
 *
 * Best-effort and asynchronous: the write that crossed the gate has already
 * landed; a judge that cannot run leaves the record as it is and says so in
 * the log. Sampling (`sampleRate`) is how earned autonomy lowers the cost —
 * one small model call per crossing at most.
 *
 * Everything with a side effect is injectable, so the decision logic is
 * tested without a model or a database.
 */
import type { HandoffGate } from '@/libs/gates/handoffGate';
import { seatLabel } from '@/libs/gates/handoffGate';

export type GateJudge = NonNullable<HandoffGate['judge']>;
export type JudgeVerdict = { verdict: 'pass' | 'return' | 'escalate'; confidence: number; reasonCode: string; example: string; note: string };

export type JudgeDeps = {
  /** The model call: system + human in, JSON verdict out. */
  compose: (input: { system: string; human: string }) => Promise<string>;
  /** The seat's rubric, as markdown. */
  rubric: (slug: string) => Promise<string | null>;
  /** The reference cases, as (input, ideal) pairs. */
  cases: (slug: string) => Promise<Array<{ input: string; expectedOutput?: string }>>;
  /** Stamp the record's gate result (pass) — merge into metadata. */
  stamp: (patch: Record<string, unknown>) => Promise<void>;
  /** Undo the transition and mark the return. */
  revert: (patch: Record<string, unknown>) => Promise<void>;
  /** Put the decision in front of a person. */
  escalate: (ask: { title: string; body: string }) => Promise<void>;
  random?: () => number;
  now?: () => Date;
};

export type JudgeInput = {
  typeLabel: string;
  gate: HandoffGate;
  judge: GateJudge;
  recordId: number;
  title: string;
  /** The transition's field value before the write, to revert to. */
  previous: unknown;
  /** The record's metadata after the write. */
  after: Record<string, unknown>;
};

/** The reason codes a return may carry — a closed list, so they can be counted. */
export const RETURN_REASONS = ['unfaithful-to-asker', 'untestable-criteria', 'unsupported-recommendation', 'missing-evidence', 'wrong-record', 'missing-state', 'scope-invented', 'other'] as const;

/**
 * Parse the model's verdict; anything unreadable is an escalation with the
 * raw text as the note — the judge never guesses on the person's behalf.
 * @param raw - The model's output.
 */
export function parseVerdict(raw: string): JudgeVerdict {
  const m = /\{[\s\S]*\}/.exec(raw);
  try {
    const j = JSON.parse(m ? m[0] : raw) as Partial<JudgeVerdict>;
    const verdict = j.verdict === 'pass' || j.verdict === 'return' || j.verdict === 'escalate' ? j.verdict : 'escalate';
    const confidence = typeof j.confidence === 'number' && Number.isFinite(j.confidence) ? Math.min(1, Math.max(0, j.confidence)) : 0;
    return {
      verdict,
      confidence,
      reasonCode: (RETURN_REASONS as readonly string[]).includes(String(j.reasonCode)) ? String(j.reasonCode) : 'other',
      example: typeof j.example === 'string' ? j.example.slice(0, 500) : '',
      note: typeof j.note === 'string' ? j.note.slice(0, 500) : '',
    };
  } catch {
    return { verdict: 'escalate', confidence: 0, reasonCode: 'other', example: '', note: `The judge's answer could not be read: ${raw.slice(0, 200)}` };
  }
}

/**
 * The outcome, after the workspace's dials: a verdict under the confidence
 * bar escalates; a field the gate always escalates on escalates.
 * @param v - The parsed verdict.
 * @param judge - The gate's judge config.
 * @param after - The record after the write.
 */
export function finalOutcome(v: JudgeVerdict, judge: GateJudge, after: Record<string, unknown>): JudgeVerdict['verdict'] {
  for (const [field, values] of Object.entries(judge.alwaysEscalate ?? {})) {
    const value = after[field];
    if (typeof value === 'string' && values.includes(value)) {
      return 'escalate';
    }
  }
  if (v.verdict !== 'pass' && v.confidence < judge.escalateBelow) {
    return 'escalate';
  }
  if (v.verdict === 'pass' && v.confidence < judge.escalateBelow) {
    return 'escalate';
  }
  return v.verdict;
}

/**
 * The instruction, built from the seat's own rubric and the cases.
 * @param input
 * @param rubric
 * @param cases
 */
export function judgeSystem(input: JudgeInput, rubric: string | null, cases: Array<{ input: string; expectedOutput?: string }>): string {
  const calibration = cases.slice(0, 4).map((c, i) => `Case ${i + 1}:\nRequest: ${c.input.trim().slice(0, 700)}\nIdeal: ${(c.expectedOutput ?? '').trim().slice(0, 700)}`).join('\n\n');
  return [
    `You are the gate on the "${input.gate.name}" handoff for a ${input.typeLabel.toLowerCase()}. The seat that produced this work is ${seatLabel(input.gate.producedBy)}; you judge the work, not the worker.`,
    rubric ? `THE RUBRIC (the question this seat is judged by):\n${rubric.trim().slice(0, 6000)}` : 'No rubric was mounted; judge against the reference cases and plain product sense.',
    calibration ? `REFERENCE CASES (what good looks like here):\n${calibration}` : '',
    `Answer with ONE JSON object and nothing else: {"verdict":"pass"|"return"|"escalate","confidence":0..1,"reasonCode":one of ${RETURN_REASONS.join('|')},"example":"the one concrete thing that fails, quoted from the record","note":"one sentence for the person or the seat"}. Return when the work fails the rubric in a way the seat can fix. Escalate when a person must decide, or when you are not sure. Pass only when a product owner would make the same decision with this evidence.`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Judge one crossing. Never throws.
 * @param input - The crossing.
 * @param deps - The side effects.
 */
export async function judgeHandoff(input: JudgeInput, deps: JudgeDeps): Promise<{ ran: boolean; outcome?: JudgeVerdict['verdict']; verdict?: JudgeVerdict }> {
  const rnd = deps.random ?? Math.random;
  if (input.judge.sampleRate < 1 && rnd() >= input.judge.sampleRate) {
    return { ran: false };
  }
  const now = (deps.now ?? (() => new Date()))();
  try {
    const [rubric, cases] = await Promise.all([deps.rubric(input.judge.rubric), input.judge.cases ? deps.cases(input.judge.cases) : Promise.resolve([])]);
    const human = `THE RECORD (#${input.recordId} "${input.title}") as it stands after moving ${input.gate.when.field} to "${String(input.after[input.gate.when.field])}":\n${JSON.stringify(input.after, null, 1).slice(0, 9000)}`;
    const raw = await deps.compose({ system: judgeSystem(input, rubric, cases), human });
    const verdict = parseVerdict(raw);
    const outcome = finalOutcome(verdict, input.judge, input.after);
    const judged = { name: input.gate.name, judged: outcome, confidence: verdict.confidence, reasonCode: verdict.reasonCode, example: verdict.example, note: verdict.note, at: now.toISOString() };
    if (outcome === 'pass') {
      await deps.stamp({ gate: judged });
    } else if (outcome === 'return') {
      await deps.revert({ [input.gate.when.field]: input.previous ?? null, returnedTo: input.gate.producedBy, gate: judged });
    } else {
      await deps.stamp({ gate: judged });
      await deps.escalate({
        title: `Gate "${input.gate.name}": ${input.title}`,
        body: `${verdict.note || 'The judge was not confident enough to decide.'}${verdict.example ? `\n\nThe thing in doubt: ${verdict.example}` : ''}\n\nRubric: ${input.judge.rubric}. Confidence ${verdict.confidence.toFixed(2)}.`,
      });
    }
    return { ran: true, outcome, verdict };
  } catch (err) {
    console.warn('handoff judge failed', { gate: input.gate.name, recordId: input.recordId, message: (err as Error).message });
    return { ran: false };
  }
}

/**
 * The real dependencies: the org's main model, the mounted skill, the eval
 * dataset, the record's metadata, and an ask in Review.
 * @param orgId - The org.
 * @param objectId - The record.
 * @param producedBy - The seat, for the ask.
 */
export async function realJudgeDeps(orgId: string, objectId: number, producedBy: string): Promise<JudgeDeps> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const { mountSkills } = await import('@/services/playbooks/mount');
  const { getDataset } = await import('@/services/EvalService');
  const { upsertAsk } = await import('@/services/AskService');
  const { db } = await import('@/libs/DB');
  const { and, eq } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const merge = async (patch: Record<string, unknown>) => {
    const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId))).limit(1);
    await db.update(businessObjectSchema).set({ metadata: { ...(row?.metadata ?? {}), ...patch }, updatedAt: new Date() }).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId)));
  };
  return {
    compose: async ({ system, human }) => {
      const model = await buildChatModelForOrg('main', orgId, { temperature: 0, streaming: false, maxTokens: 600 });
      const res = await model.invoke([new SystemMessage(system), new HumanMessage(human)], { signal: AbortSignal.timeout(60_000) });
      return typeof res.content === 'string' ? res.content : (res.content as Array<{ type?: string; text?: string }>).map(c => (c.type === 'text' ? c.text ?? '' : '')).join('');
    },
    rubric: async (slug) => {
      const files = await mountSkills({ orgId, skillSlugs: [slug], playbookSlugs: [] });
      return Object.entries(files).find(([path]) => path.includes(`/${slug}/`))?.[1] ?? null;
    },
    cases: async (slug) => {
      const ds = await getDataset(orgId, slug);
      return ((ds?.items ?? []) as Array<{ input: string; expectedOutput?: string }>);
    },
    stamp: merge,
    revert: merge,
    escalate: async ({ title, body }) => {
      await upsertAsk({ orgId, createdBy: 'gate', ask: { kind: 'gate', title, body, agentSlug: producedBy, risk: 'medium', objectRefs: [{ type: 'object', id: String(objectId) }] } as never });
    },
  };
}
