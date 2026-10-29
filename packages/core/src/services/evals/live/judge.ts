/**
 * THE SAMPLED HALF OF LIVE SCORING (ADR 0010): a small model reads a few of
 * yesterday's live turns and grades them on the eval's dimensions that need
 * judgement — was every specific in the answer backed by a tool result or
 * the person's own words, were the arguments the ones the person gave, did
 * it decline something it looked able to do, and did it do what was asked.
 *
 * The per-turn signals (`turnSignals.ts`) are on every turn and cost
 * nothing; this costs a classifier call per turn, so it samples, spread
 * across agents and levels, and writes its verdict onto the turn's row
 * (`agent_turn_signal.judge`). Run nightly by the `agent-evals-nightly` job.
 *
 * It is a judge, not a ground truth: it reads the turn against itself, as
 * AgentCore's online evaluators do, and has no expected answer.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentTurnSignalSchema, conversationMessageSchema } from '@/models/Schema';

/** What the judge reads of one turn. */
export type JudgedTurn = {
  question: string;
  tools: Array<{ name: string; input?: Record<string, unknown>; output?: string; failed?: boolean }>;
  answer: string;
};

/** Its verdict. Null where a dimension does not apply to the turn. */
export type JudgeVerdict = {
  /** Every specific in the answer (number, date, name, status) is backed by a tool result or the question. */
  grounded: boolean | null;
  /** The tool calls carried the values the person gave or an earlier result returned. */
  argsCorrect: boolean | null;
  /** Declined something it appeared able to do. */
  unjustifiedRefusal: boolean;
  /** Did what was asked, or asked the one question it needed to. */
  completed: boolean;
  /** One line on the worst problem, for whoever opens the turn. */
  note: string | null;
};

export const JUDGE_SYSTEM = [
  'You grade one turn of a business assistant that works through tools. You see the person\'s message, every tool call it made with its result, and its final answer.',
  'Grade only from what is shown. Reply with one JSON object and nothing else:',
  '{"grounded": true|false|null, "argsCorrect": true|false|null, "unjustifiedRefusal": true|false, "completed": true|false, "note": "..."}',
  '- grounded: every specific in the answer (numbers, dates, names, statuses) appears in a tool result or the person\'s message. null when the answer states no specifics. false when the answer repeats a guess from the message that a tool result contradicts.',
  '- argsCorrect: each tool call carried the values the person gave or an earlier result returned (ids, dates, amounts). null when no call needed such a value.',
  '- unjustifiedRefusal: the answer says it cannot do something, though the request is the kind of thing its tools do or it never tried.',
  '- completed: it did what was asked, or asked the one question it needed to before acting.',
  '- note: one short line naming the worst problem, or null.',
].join('\n');

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The judge's user message: the turn, clipped so a long one stays a small call.
 * @param turn - The turn.
 */
export function judgePrompt(turn: JudgedTurn): string {
  const tools = turn.tools.length
    ? turn.tools.slice(0, 12).map((t, i) => `${i + 1}. ${t.name}${t.failed ? ' (FAILED)' : ''}\n   input: ${clip(JSON.stringify(t.input ?? {}), 400)}\n   result: ${clip(t.output ?? '', 800)}`).join('\n')
    : '(no tool calls)';
  return `PERSON:\n${clip(turn.question, 1500)}\n\nTOOL CALLS:\n${tools}\n\nANSWER:\n${clip(turn.answer, 2500)}`;
}

/**
 * The verdict from the model's reply; null when the reply is not one.
 * @param raw - The model's reply.
 */
export function parseVerdict(raw: string): JudgeVerdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const v = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const triple = (x: unknown) => (typeof x === 'boolean' ? x : null);
    if (typeof v.completed !== 'boolean' || typeof v.unjustifiedRefusal !== 'boolean') {
      return null;
    }
    return {
      grounded: triple(v.grounded),
      argsCorrect: triple(v.argsCorrect),
      unjustifiedRefusal: v.unjustifiedRefusal,
      completed: v.completed,
      note: typeof v.note === 'string' && v.note.trim() ? v.note.trim().slice(0, 200) : null,
    };
  } catch {
    return null;
  }
}

/** Test seam: one small-model call. */
export type JudgeModel = (system: string, user: string) => Promise<{ text: string; response?: unknown }>;

async function defaultJudgeModel(orgId: string): Promise<JudgeModel> {
  const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 400, streaming: false });
  return async (system, user) => {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }]);
    const c = response.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(part => (part as { text?: string }).text ?? '').join('') : '';
    return { text, response };
  };
}

type Candidate = { id: number; agentSlug: string; level: string | null; traceId: string; conversationId: number };

/**
 * Up to `size` turns, taken in turn from each agent and level so a busy
 * agent does not crowd out a quiet one, newest first within each.
 * @param rows - Unjudged turns, newest first.
 * @param size - How many to take.
 */
export function stratifiedSample<T extends { agentSlug: string; level: string | null }>(rows: readonly T[], size: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.agentSlug}|${r.level ?? ''}`;
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  const queues = [...buckets.values()];
  const out: T[] = [];
  while (out.length < size && queues.some(q => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && out.length < size) {
        out.push(next);
      }
    }
  }
  return out;
}

/**
 * The turn as the judge reads it: the assistant row its trace wrote, and the
 * person's message before it.
 * @param c - The turn's row.
 */
async function readTurn(c: Candidate): Promise<JudgedTurn | null> {
  const m = conversationMessageSchema;
  const [assistant] = await db.select({ id: m.id, content: m.content, runsJson: m.runsJson }).from(m).where(and(eq(m.conversationId, c.conversationId), eq(m.langfuseTraceId, c.traceId), eq(m.role, 'assistant'))).limit(1);
  if (!assistant) {
    return null;
  }
  const [question] = await db.select({ content: m.content }).from(m).where(and(eq(m.conversationId, c.conversationId), eq(m.role, 'user'), lt(m.id, assistant.id))).orderBy(desc(m.id)).limit(1);
  const tools = (assistant.runsJson ?? []).flatMap(run => (run.type === 'tool' ? [{ name: run.name, input: run.input, output: run.output, failed: run.state === 'error' }] : []));
  return { question: question?.content ?? '', tools, answer: assistant.content };
}

/**
 * Judge a sample of the window's unjudged turns and write each verdict to
 * its row. A turn that cannot be read or judged is counted and left
 * unjudged, so the next night can try it again while it is in the window.
 * @param orgId - The workspace.
 * @param opts - What to judge.
 * @param opts.sample - How many turns, at most.
 * @param opts.since - Window start.
 * @param opts.model - Test seam.
 */
export async function judgeLiveTurns(orgId: string, opts: { sample: number; since: Date; model?: JudgeModel }): Promise<{ judged: number; unreadable: number; failed: number }> {
  const t = agentTurnSignalSchema;
  const rows = await db.select({ id: t.id, agentSlug: t.agentSlug, level: t.level, traceId: t.traceId, conversationId: t.conversationId }).from(t).where(and(eq(t.orgId, orgId), gte(t.createdAt, opts.since), isNull(t.judge), isNotNull(t.traceId), isNotNull(t.conversationId))).orderBy(desc(t.id), asc(t.agentSlug)).limit(2000);
  const picked = stratifiedSample(rows as Candidate[], opts.sample);
  if (picked.length === 0) {
    return { judged: 0, unreadable: 0, failed: 0 };
  }
  const model = opts.model ?? await defaultJudgeModel(orgId);
  let judged = 0;
  let unreadable = 0;
  let failed = 0;
  for (const c of picked) {
    const turn = await readTurn(c);
    if (!turn) {
      unreadable += 1;
      continue;
    }
    try {
      const reply = await model(JUDGE_SYSTEM, judgePrompt(turn));
      if (reply.response !== undefined) {
        const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
        const { FEATURES } = await import('@/libs/Langfuse/features');
        await chargeModelCall({ orgId, feature: FEATURES.EVAL_JUDGE, role: 'classifier', response: reply.response });
      }
      const verdict = parseVerdict(reply.text);
      if (!verdict) {
        failed += 1;
        continue;
      }
      await db.update(t).set({ judge: { ...verdict, at: new Date().toISOString() } }).where(eq(t.id, c.id));
      judged += 1;
    } catch (error) {
      failed += 1;
      console.warn('[evals] could not judge a live turn', { orgId, id: c.id, message: (error as Error).message });
    }
  }
  return { judged, unreadable, failed };
}
