/**
 * WHAT A PAST TURN ACTUALLY DID, replayed with it — as tool calls, not prose.
 *
 * History used to reach the model as text: "I'll pull the records… Nothing on
 * record covers this." With no tool evidence behind those words, the model on
 * the next turn disbelieved its own earlier self — production turns 595, 608,
 * 625 and 631 (2026-09-24) each opened with "my last message got ahead of
 * itself" and re-planned, once onto the wrong request. And the card a turn put
 * up lived only in the browser, so "approve filing it" had nothing to bind to
 * and went looking for an existing record — #124, #121, #125, all wrong.
 *
 * The first fix appended a bracketed sentence to the replayed turn. Chris,
 * 2026-09-24: "Should card come back as metadata? Not text inline to parse?"
 * Yes. `historyMessages` replays a stored turn the way the model produced it:
 * an assistant message carrying the tool calls, a tool result for each, then
 * the answer. A card is the `recommend_action` call it was, and its result says
 * it is on screen and which proposal it filed — the model binds "approve" to a
 * tool call it made, not to a sentence about one.
 *
 * `toolsMarker` remains for the two out-of-process loops, whose payload is
 * `{role, content}` only; it is the prompt-shaped fallback, used nowhere else.
 */

export type RunEntry = {
  type?: string;
  /** A card's id, and its kind: a choice card is replayed as a question, not a proposal. */
  id?: string;
  kind?: string;
  /** The person's answer to a choice card. */
  answer?: { optionId?: string; text?: string };
  name?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
  label?: string;
  actionId?: string;
  runId?: number;
  ref?: { type: string; id: number };
  /** The proposal's status NOW, read when the history is assembled (`withLiveCardState`). */
  status?: string;
  /** What the proposal did, in a clause, when it ran. */
  outcome?: string;
  /** Why it failed, when it did. */
  error?: string;
};

/** One stored turn as the loop replays it — a person's or the agent's words, plus what the agent's turn did. */
export type HistoryTurn = { role: 'user' | 'assistant'; content: string; id?: string | number; runs?: unknown };

/** A replayed message: the agent's words with the calls it made, or one call's result. */
export type HistoryMessage
  = { role: 'assistant'; content: string; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }
    | { role: 'tool'; toolCallId: string; name: string; content: string };

const MAX_MARKER = 600;
/** A replayed tool result is evidence, not the whole ledger; the live turn already read it. */
const MAX_RESULT = 1200;

/**
 * What a cut replay says about itself. Conversation 364 (2026-09-29): the
 * replay of request #224 stopped at 1,200 characters, before its history,
 * and the next turn read the absence as a fact: "That wasn't in the record;
 * I asserted it" about a gate that had fired twice. A cut is not an absence.
 */
const CUT_NOTE = ' [cut on replay: that turn read the whole result; what is not shown here may still be in it. Read it again before saying it is not there.]';

function entries(runs: unknown): RunEntry[] {
  return Array.isArray(runs) ? (runs as RunEntry[]).filter(r => r && typeof r === 'object') : [];
}

function args(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

/**
 * The messages a stored assistant turn becomes. A turn that ran nothing and
 * put up nothing is one plain assistant message; otherwise the calls come
 * first with their results, then the answer, so the answer stands on them.
 * @param turn - The stored turn (`runs` is the row's `runs_json`).
 */
export function historyMessages(turn: HistoryTurn): HistoryMessage[] {
  const all = entries(turn.runs);
  // A card is ONE call. The tool's own "Surfaced a one-tap recommendation"
  // row beside the card it became replayed the same card twice (conversation
  // 360: three build cards for two proposals), and the model tidied the
  // "duplicate" away. A refused recommend_action stays — it says what failed.
  const hasCards = all.some(r => r.type === 'card');
  const runs = hasCards ? all.filter(r => !(r.type === 'tool' && r.name === 'recommend_action' && r.state !== 'error' && !refusedCall(r.output))) : all;
  const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  const results: HistoryMessage[] = [];
  const key = String(turn.id ?? 'turn');
  runs.forEach((r, i) => {
    const id = `hist_${key}_${i}`;
    if (r.type === 'tool' && typeof r.name === 'string') {
      calls.push({ id, name: r.name, args: args(r.input) });
      const out = typeof r.output === 'string' ? r.output : '';
      const body = r.state === 'error' ? `Error: ${out || 'the tool failed'}` : out || '(no output)';
      results.push({ role: 'tool', toolCallId: id, name: r.name, content: body.length > MAX_RESULT ? `${body.slice(0, MAX_RESULT - 1)}…${CUT_NOTE}` : body });
    } else if (r.type === 'card' && typeof r.label === 'string') {
      calls.push({ id, name: 'recommend_action', args: { label: r.label, action_id: r.actionId, ...args(r.input) } });
      results.push({ role: 'tool', toolCallId: id, name: 'recommend_action', content: cardResult(r) });
    }
  });
  if (calls.length === 0) {
    return [{ role: 'assistant', content: turn.content, toolCalls: [] }];
  }
  const out: HistoryMessage[] = [{ role: 'assistant', content: '', toolCalls: calls }, ...results];
  if (turn.content.trim().length > 0) {
    out.push({ role: 'assistant', content: turn.content, toolCalls: [] });
  }
  return out;
}

function refusedCall(output: unknown): boolean {
  return typeof output === 'string' && /^\s*\{\s*"ok"\s*:\s*false/.test(output);
}

/**
 * What a replayed choice card says. A question has no proposal: it was answered,
 * skipped, or it is still open. Without this branch an open question read as "a
 * card waiting on approval", and "yes" would have been taken as approving it.
 * @param r - The choice card entry.
 */
function choiceResult(r: RunEntry): string {
  const question = `Question "${r.label}" (card ${r.id ?? 'unknown'})`;
  if (r.answer?.text) {
    return `${question} was answered: ${r.answer.text}.`;
  }
  if (r.state === 'decided') {
    return `${question} was answered.`;
  }
  if (r.state === 'deferred') {
    return `${question} was skipped by the person.`;
  }
  return `${question} is still open on the person's screen; don't ask it again.`;
}

/**
 * What a replayed card says it came to — the proposal as it stands NOW when
 * the history was hydrated (`withLiveCardState`), else as the turn stored it.
 * Conversation 360 (2026-09-29): both build cards had run, and the replay
 * told the next turn each was "on the person's screen" to decide — so "go"
 * met two undecided duplicates, and the PM tried to withdraw one that had
 * already started the build.
 * @param r - The card entry.
 */
function cardResult(r: RunEntry): string {
  if (r.kind === 'choice') {
    return choiceResult(r);
  }
  const n = r.runId ? `proposal #${r.runId}` : 'its proposal';
  const status = r.status ?? (r.state === 'decided' || r.ref ? 'done' : undefined);
  if (r.ref) {
    return `Card "${r.label}" ran (${n} executed) and created ${r.ref.type} #${r.ref.id}. That record exists now — read it by id; do not file it again or ask for its id.`;
  }
  if (status === 'done') {
    return `Card "${r.label}" ran (${n} executed)${r.outcome ? `: ${r.outcome}` : ''}. It is done — do not put it up again, start it a second time or withdraw it; say what it did.`;
  }
  if (status === 'failed') {
    return `Card "${r.label}" was approved and failed (${n})${r.error ? `: ${r.error.slice(0, 300)}` : ''}. Nothing it would have done happened.`;
  }
  if (status === 'rejected' || status === 'undone' || status === 'expired') {
    return `Card "${r.label}" was ${status === 'rejected' ? 'turned down' : status} (${n}). Nothing it would have done stands.`;
  }
  if (status === 'approved' || status === 'executing' || status === 'awaiting_execution') {
    return `Card "${r.label}" is approved and running (${n}). Do not put it up again.`;
  }
  if (r.state === 'unfiled') {
    return `Card "${r.label}" was on the person's screen but could not be filed as a proposal. If they say "approve", "go" or "file it", make its call.`;
  }
  return `Card "${r.label}" is on the person's screen${r.runId ? ` as proposal #${r.runId}` : ''}, waiting on them. If they say "approve", "go", "yes", "file it" or "go ahead", they mean this card: decide it${r.runId ? ` (decide_proposal ${r.runId})` : ''} or make its call — never a different record.`;
}

/**
 * What a run's result says it did, in a clause — the part of an executed
 * card the next turn needs to answer "go" without guessing.
 * @param result - The run's stored result.
 */
export function outcomeOf(result: Record<string, unknown> | null | undefined): string | undefined {
  if (!result) {
    return undefined;
  }
  const req = result.requestId ? ` request #${String(result.requestId)}` : '';
  if (result.planning === true) {
    return `it started${req} by planning first${typeof result.why === 'string' ? ` (${result.why})` : ''}; the build starts when the plan is approved`;
  }
  if (result.workerRunId) {
    return `it started build run #${String(result.workerRunId)}${req ? ` for${req}` : ''}`;
  }
  if (typeof result.objectId === 'number') {
    return `it wrote ${typeof result.objectType === 'string' ? result.objectType.replace(/_/g, ' ') : 'record'} #${result.objectId}`;
  }
  return undefined;
}

/**
 * The turns with each card's proposal as it stands now: status, what it did,
 * why it failed. Read once per turn, when the history is assembled, so a card
 * decided after its turn was stored (a tap, the trust ladder, a later turn)
 * replays as what it became. Never throws: a history that cannot be hydrated
 * is replayed as stored.
 * @param orgId - The workspace.
 * @param turns - The stored turns.
 */
export async function withLiveCardState(orgId: string, turns: HistoryTurn[] | undefined): Promise<HistoryTurn[] | undefined> {
  const ids = [...new Set((turns ?? []).flatMap(t => entries(t.runs).filter(r => r.type === 'card' && typeof r.runId === 'number').map(r => r.runId!)))];
  if (!turns || ids.length === 0) {
    return turns;
  }
  try {
    const { and, eq, inArray } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema } = await import('@/models/Schema');
    const rows = await db
      .select({ id: actionRunSchema.id, status: actionRunSchema.status, result: actionRunSchema.result, error: actionRunSchema.error })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, ids)));
    const byId = new Map(rows.map(r => [r.id, r]));
    return turns.map((t) => {
      if (!Array.isArray(t.runs)) {
        return t;
      }
      return {
        ...t,
        runs: entries(t.runs).map((r) => {
          const row = r.type === 'card' && typeof r.runId === 'number' ? byId.get(r.runId) : undefined;
          if (!row) {
            return r;
          }
          const outcome = outcomeOf(row.result as Record<string, unknown> | null);
          return { ...r, status: row.status, ...(outcome ? { outcome } : {}), ...(row.error ? { error: row.error } : {}) };
        }),
      };
    });
  } catch {
    return turns;
  }
}

/**
 * History for a loop whose payload is `{role, content}` only (the AgentCore
 * container and AWS's harness): the agent's turns carry their tool ledger as
 * one trailing line. The weakest lever, kept only where the strong one cannot reach.
 * @param turns - The stored turns.
 */
export function flatHistory(turns: readonly HistoryTurn[] | undefined): Array<{ role: 'user' | 'assistant'; content: string }> {
  return (turns ?? []).map(t => ({ role: t.role, content: t.role === 'assistant' ? `${t.content}${toolsMarker(t.runs)}` : t.content }));
}

function brief(input: unknown): string {
  if (!input || typeof input !== 'object') {
    return '';
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 3)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}: ${String(v).slice(0, 40)}`);
    }
  }
  return parts.length > 0 ? `{${parts.join(', ')}}` : '';
}

function came(output: unknown): string {
  if (typeof output !== 'string') {
    return '';
  }
  const t = output.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t) as unknown[];
      return ` → ${arr.length} row${arr.length === 1 ? '' : 's'}`;
    } catch {
      /* not JSON */
    }
    const rows = (t.match(/^\[\d+\]/gm) ?? []).length;
    return rows > 0 ? ` → ${rows} result${rows === 1 ? '' : 's'}` : ` → ${t.length} chars`;
  }
  return t.length > 0 ? ` → ${t.length} chars` : ' → nothing';
}

/**
 * The one-line text form of a turn's `runs_json`, or '' when nothing ran.
 * @param runs - The stored runs (text, tool, card).
 */
export function toolsMarker(runs: unknown): string {
  const all = entries(runs);
  const tools = all.filter(r => r.type === 'tool' && typeof r.name === 'string');
  const cards = all.filter(r => r.type === 'card' && typeof r.label === 'string');
  if (tools.length === 0 && cards.length === 0) {
    return '';
  }
  const parts: string[] = [];
  if (tools.length > 0) {
    parts.push(`you ran: ${tools.map(r => `${r.name}${brief(r.input)}${came(r.output)}`).join('; ')}`);
  }
  if (cards.length > 0) {
    parts.push(`you put up ${cards.length === 1 ? 'a card' : `${cards.length} cards`}: ${cards.map((c) => {
      const input = args(c.input);
      const title = typeof input.title === 'string' ? ` "${input.title.slice(0, 80)}"` : '';
      const status = c.status ?? (c.state === 'decided' || c.ref ? 'done' : undefined);
      const ran = status === 'done' ? `, ran${c.outcome ? `: ${c.outcome}` : ''}` : status && status !== 'pending' ? `, ${status}` : '';
      return `"${c.label}" → ${c.actionId}${title}${c.runId ? ` (proposal #${c.runId}${ran})` : ''}`;
    }).join('; ')}. "Approve", "go", "file it" or "go ahead" means THAT card when it is still waiting — decide it or make its call, never a different record; a card that ran is done`);
  }
  let line = `[Earlier in this turn ${parts.join('. And ')}]`;
  if (line.length > MAX_MARKER) {
    line = `${line.slice(0, MAX_MARKER - 2)}…]`;
  }
  return `\n\n${line}`;
}
