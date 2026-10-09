/**
 * EFFORT — how hard one turn works, set as a shape rather than a count.
 *
 * On 2026-10-09 "What sales emails do I need to answer" took 35 steps and
 * 3m20s (trace c126f3ca). Nothing told the agent how much the question was
 * worth, so it worked as if every question were research: twenty searches,
 * a full consult, extended thinking on every step. The founder's correction
 * (same day): limits on depth, parallelism and rounds "should not be hard
 * fixed… driven by llm inference of the request (so I can see quick or deep)
 * and the specific rounds/depth/parallel is llm-driven also based on
 * feel/intent".
 *
 * So a turn runs at one of three levels — Quick, Standard, Deep — chosen by
 * the person (the composer's gauge), by the agent's or workspace's default,
 * or, by default, read from the request by a small model (`inferEffort`,
 * Auto). A level sets an ENVELOPE, never a step count:
 *
 *   - how strong a model leads and how much it thinks (`strength`, `thinking`);
 *   - whether it may consult teammates (`consults`) and how wide to fan out;
 *   - a soft time target the agent is told, so it stops when it has enough;
 *   - two outer CEILINGS — wall clock and spend — the only hard limits.
 *
 * Inside the envelope the agent decides rounds, depth and parallelism by
 * itself (`effortNote`). Reaching a ceiling does not kill the turn: the next
 * model call is made with tools off and told to answer with what it has
 * (`createEffortMiddleware`), and the turn offers "Dig deeper", which runs the
 * same question again one level up.
 */
import type { EffortChoice, EffortLevel, ModelStrength, ThinkingEffort } from '@/libs/llm/modelPrefs';
import { createMiddleware } from 'langchain';
import { EFFORT_LEVELS } from '@/libs/llm/modelPrefs';

export type { EffortChoice, EffortLevel };

export type EffortEnvelope = {
  level: EffortLevel;
  /** The lead's model: `fast` is the vendor's small model, `balanced` the agent's own. */
  strength: ModelStrength;
  /** Extended thinking for the turn; `agent` leaves the agent's own setting alone. */
  thinking: ThinkingEffort | 'agent';
  /** Teammates: none, at most one, or several side by side. */
  consults: 'none' | 'one' | 'parallel';
  /** Independent lookups worth issuing together in one step. */
  fanOut: number;
  /** What the agent aims for, in seconds. Advice, not a limit. */
  targetSeconds: number;
  /** Wall clock after which the turn answers with what it has. */
  ceilingSeconds: number;
  /** Spend after which the turn answers with what it has, in cents. */
  ceilingCents: number;
};

/** The built-in envelopes. A workspace or agent may move the ceilings (`harness.turnCeilings`). */
export const ENVELOPES: Record<EffortLevel, EffortEnvelope> = {
  quick: { level: 'quick', strength: 'fast', thinking: 'off', consults: 'none', fanOut: 3, targetSeconds: 8, ceilingSeconds: 40, ceilingCents: 15 },
  standard: { level: 'standard', strength: 'balanced', thinking: 'agent', consults: 'one', fanOut: 5, targetSeconds: 20, ceilingSeconds: 90, ceilingCents: 75 },
  deep: { level: 'deep', strength: 'balanced', thinking: 'high', consults: 'parallel', fanOut: 8, targetSeconds: 150, ceilingSeconds: 600, ceilingCents: 500 },
};

/**
 * The level "Dig deeper" re-runs at, or null at the top.
 * @param level
 */
export function nextLevel(level: EffortLevel): EffortLevel | null {
  return level === 'quick' ? 'standard' : level === 'standard' ? 'deep' : null;
}

export type TurnCeilings = Partial<Record<EffortLevel, { seconds?: number; cents?: number }>>;

/**
 * The envelope for a level, with an agent's or workspace's ceilings applied.
 * Ceilings may move either way: a seat that does long research raises Deep's,
 * a cost-sensitive workspace lowers Standard's.
 * @param level - The level the turn runs at.
 * @param ceilings - `harness.turnCeilings`, when set.
 */
export function envelopeFor(level: EffortLevel, ceilings?: TurnCeilings): EffortEnvelope {
  const base = ENVELOPES[level];
  const own = ceilings?.[level];
  return {
    ...base,
    ...(own?.seconds && own.seconds > 0 ? { ceilingSeconds: own.seconds } : {}),
    ...(own?.cents && own.cents > 0 ? { ceilingCents: own.cents } : {}),
  };
}

/** How the level was chosen, for the turn's line and the trace. */
export type EffortDecision = {
  level: EffortLevel;
  /** `person` = the gauge; `agent` = the agent's or workspace's default; `auto` = read from the request. */
  chosenBy: 'person' | 'agent' | 'auto';
  /** Why Auto picked it, in a few words. */
  reason?: string;
};

export const INFER_SYSTEM = [
  'You set how much effort an assistant spends answering one request from a person at work. Pick one level:',
  'quick — a lookup or a short factual answer from one place: what is on my calendar, what is the status of X, find an email address, a yes/no, a greeting.',
  'standard — gather from a few places and synthesise: what do I owe replies to, prepare me for this meeting, what changed on this deal, draft a reply.',
  'deep — research or analysis across many sources or a long period, a plan, a document, a comparison: research everything on an account since July, audit the pipeline, write a proposal.',
  'When unsure between two, pick the lower one: the person can always ask to dig deeper.',
  'Answer with a JSON object only: {"level": "quick" | "standard" | "deep", "reason": "<at most 8 words>"}.',
].join(' ');

/** Test seam: one small-model call returning its text. */
export type EffortModel = (system: string, user: string) => Promise<{ text: string; response?: unknown }>;

/**
 * Parse the model's answer, or null.
 * @param raw - The reply text.
 */
export function parseEffort(raw: string): { level: EffortLevel; reason: string } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { level?: unknown; reason?: unknown };
    if (!EFFORT_LEVELS.includes(parsed.level as EffortLevel)) {
      return null;
    }
    return { level: parsed.level as EffortLevel, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 80) : '' };
  } catch {
    return null;
  }
}

/** How long Auto may take before the turn starts at Standard instead. */
const INFER_TIMEOUT_MS = 2_500;

/**
 * Read the level a request is worth (Auto). Never throws: no model, a slow
 * model or a reply that is not a level all start the turn at Standard, and
 * say so.
 * @param opts - The request.
 * @param opts.orgId - Whose key pays, and whose budget it lands on.
 * @param opts.message - The person's message.
 * @param opts.previous - The last exchange, when the message only makes sense with it ("and the other one?").
 * @param opts.model - Test seam.
 */
export async function inferEffort(opts: { orgId: string; message: string; previous?: string; model?: EffortModel }): Promise<{ level: EffortLevel; reason: string }> {
  try {
    const model = opts.model ?? await defaultModel(opts.orgId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const user = `${opts.previous ? `Earlier in the conversation: ${opts.previous.slice(0, 600)}\n\n` : ''}Request: ${opts.message.slice(0, 2_000)}`;
    const reply = await Promise.race([
      model(INFER_SYSTEM, user),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('effort inference timed out')), INFER_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (reply.response !== undefined) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: opts.orgId, feature: FEATURES.CHAT_ROUTE, role: 'classifier', response: reply.response });
    }
    return parseEffort(reply.text) ?? { level: 'standard', reason: 'could not read the request; started at standard' };
  } catch {
    return { level: 'standard', reason: 'no quick read of the request; started at standard' };
  }
}

async function defaultModel(orgId: string): Promise<EffortModel> {
  const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 60, streaming: false });
  return async (system, user) => {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }]);
    const c = response.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(part => (part as { text?: string }).text ?? '').join('') : '';
    return { text, response };
  };
}

/**
 * Decide the level: the person's choice wins, then the agent's (or its
 * workspace's) default, then Auto.
 * @param opts - What each party said.
 * @param opts.person - The gauge, for this message.
 * @param opts.agent - `harness.turnEffort`.
 * @param opts.auto - Runs Auto when nothing else chose.
 */
export async function decideEffort(opts: { person?: EffortChoice; agent?: EffortChoice; auto: () => Promise<{ level: EffortLevel; reason: string }> }): Promise<EffortDecision> {
  if (opts.person && opts.person !== 'auto') {
    return { level: opts.person, chosenBy: 'person' };
  }
  if (opts.agent && opts.agent !== 'auto') {
    return { level: opts.agent, chosenBy: 'agent' };
  }
  const read = await opts.auto();
  return { level: read.level, chosenBy: 'auto', reason: read.reason };
}

/**
 * The lines the agent reads with the person's message: its level, its target,
 * and that rounds, depth and parallelism are its own call. On the message, not
 * in the system prompt, so the cached prefix stays the same whatever the level.
 * @param envelope - The turn's envelope.
 * @param decision - How the level was chosen.
 * @param opts - What the turn can do.
 * @param opts.canConsult - Whether this agent has teammates to ask at all.
 */
export function effortNote(envelope: EffortEnvelope, decision: EffortDecision, opts: { canConsult: boolean }): string {
  const name = envelope.level[0]!.toUpperCase() + envelope.level.slice(1);
  const why = decision.chosenBy === 'person' ? 'chosen by the person' : decision.chosenBy === 'agent' ? 'this agent\'s default' : `read from the request${decision.reason ? `: ${decision.reason}` : ''}`;
  const consult = !opts.canConsult || envelope.consults === 'none'
    ? 'Do not consult teammates this turn; answer from your own tools.'
    : envelope.consults === 'one'
      ? 'Consult a teammate only when their work is genuinely needed, at most one, and hand them what you already found (ids and one-line summaries) so they do not repeat it.'
      : 'Consult teammates when their work is needed; ask several side by side when their parts are independent, and hand each what you already found.';
  return [
    `EFFORT: ${name} (${why}). Aim to answer within about ${envelope.targetSeconds} seconds.`,
    `How many rounds, how deep and how wide is your call. Issue independent lookups together in one step (up to about ${envelope.fanOut} at once) rather than one after another; prefer one precise query — a state filter or a typed tool — over several guessed phrasings; never repeat a query you already ran.`,
    'After each round, ask yourself: do I have enough to answer well? If yes, answer now; if not, take the one round that closes the gap.',
    consult,
  ].join(' ');
}

/** Why a turn stopped working and answered with what it had. */
export type CeilingHit = 'time' | 'cost';

/**
 * Watches one turn's two ceilings. `reached` turns true once wall clock or
 * spend passes its ceiling; from then on the turn's model calls are made with
 * tools off (`createEffortMiddleware`), so it answers rather than stopping.
 */
export class EffortCeilings {
  private hit: CeilingHit | null = null;
  private readonly startedAt: number;
  private cents = 0;

  constructor(private readonly envelope: EffortEnvelope, now: number = Date.now()) {
    this.startedAt = now;
  }

  /**
   * The turn's spend so far, as the run's running total.
   * @param totalMicroCents - Everything the turn has cost, in micro-cents.
   */
  spentSoFar(totalMicroCents: number): void {
    this.cents = totalMicroCents / 1_000_000;
    if (!this.hit && this.cents >= this.envelope.ceilingCents) {
      this.hit = 'cost';
    }
  }

  /**
   * The ceiling reached, if any, as of `now`.
   * @param now - The clock.
   */
  reached(now: number = Date.now()): CeilingHit | null {
    if (!this.hit && now - this.startedAt >= this.envelope.ceilingSeconds * 1000) {
      this.hit = 'time';
    }
    return this.hit;
  }

  get spentCents(): number {
    return this.cents;
  }
}

/**
 * What the model is told on the call that answers at a ceiling.
 * @param hit
 */
export function wrapUpNote(hit: CeilingHit): string {
  return `WRAP UP NOW: this turn has reached its ${hit === 'time' ? 'time' : 'spend'} ceiling. Do not call any more tools. Answer the person now with what you have found, say plainly what you did not get to, and stop.`;
}

/** The tool a lead consults a teammate through (deepagents' subagent tool). */
export const CONSULT_TOOL = 'task';

/**
 * The envelope applied to every model call of the turn:
 *
 *   - **No consults at Quick.** The consult tool is left out of the call, so a
 *     quick question is answered by the agent asked, not by a chain of them.
 *   - **Answer at a ceiling.** Once wall clock or spend passes its ceiling,
 *     the call goes out with tools off (`tool_choice: none`, because a history
 *     holding tool calls must still declare its tools) and a line saying why,
 *     so the turn answers with what it has instead of stopping.
 * @param opts - The turn's envelope and ceilings.
 * @param opts.ceilings - The turn's ceilings.
 * @param opts.consults - Whether the consult tool is offered.
 */
export function createEffortMiddleware(opts: { ceilings: EffortCeilings; consults: boolean }) {
  return createMiddleware({
    name: 'VocionEffortMiddleware',
    wrapModelCall: async (request, handler) => {
      const hit = opts.ceilings.reached();
      const tools = opts.consults ? request.tools : request.tools.filter(t => (t as { name?: string }).name !== CONSULT_TOOL);
      if (!hit) {
        return handler(tools === request.tools ? request : { ...request, tools });
      }
      return handler({
        ...request,
        tools,
        toolChoice: 'none',
        systemMessage: request.systemMessage.concat(`\n\n${wrapUpNote(hit)}`),
      });
    },
  });
}
