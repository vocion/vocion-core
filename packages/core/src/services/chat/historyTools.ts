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

export type RunEntry = { type?: string; name?: string; input?: unknown; output?: unknown; state?: string; label?: string; actionId?: string; runId?: number; ref?: { type: string; id: number } };

/** One stored turn as the loop replays it — a person's or the agent's words, plus what the agent's turn did. */
export type HistoryTurn = { role: 'user' | 'assistant'; content: string; id?: string | number; runs?: unknown };

/** A replayed message: the agent's words with the calls it made, or one call's result. */
export type HistoryMessage
  = { role: 'assistant'; content: string; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }
    | { role: 'tool'; toolCallId: string; name: string; content: string };

const MAX_MARKER = 600;
/** A replayed tool result is evidence, not the whole ledger; the live turn already read it. */
const MAX_RESULT = 1200;

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
  const runs = entries(turn.runs);
  const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  const results: HistoryMessage[] = [];
  const key = String(turn.id ?? 'turn');
  runs.forEach((r, i) => {
    const id = `hist_${key}_${i}`;
    if (r.type === 'tool' && typeof r.name === 'string') {
      calls.push({ id, name: r.name, args: args(r.input) });
      const out = typeof r.output === 'string' ? r.output : '';
      const body = r.state === 'error' ? `Error: ${out || 'the tool failed'}` : out || '(no output)';
      results.push({ role: 'tool', toolCallId: id, name: r.name, content: body.length > MAX_RESULT ? `${body.slice(0, MAX_RESULT - 1)}…` : body });
    } else if (r.type === 'card' && typeof r.label === 'string') {
      calls.push({ id, name: 'recommend_action', args: { label: r.label, action_id: r.actionId, ...args(r.input) } });
      results.push({
        role: 'tool',
        toolCallId: id,
        name: 'recommend_action',
        content: r.ref
          ? `Card "${r.label}" ran (proposal #${r.runId ?? '?'} executed) and created ${r.ref.type} #${r.ref.id}. That record exists now — read it by id; do not file it again or ask for its id.`
          : `Card "${r.label}" is on the person's screen${r.runId ? ` as proposal #${r.runId}` : ''}. If they say "approve", "file it" or "go ahead", they mean this card: decide it${r.runId ? ` (decide_proposal ${r.runId})` : ''} or make its call — never a different record.`,
      });
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
      return `"${c.label}" → ${c.actionId}${title}${c.runId ? ` (proposal #${c.runId})` : ''}`;
    }).join('; ')}. "Approve", "file it" or "go ahead" means THAT card — decide it or make its call, never a different record`);
  }
  let line = `[Earlier in this turn ${parts.join('. And ')}]`;
  if (line.length > MAX_MARKER) {
    line = `${line.slice(0, MAX_MARKER - 2)}…]`;
  }
  return `\n\n${line}`;
}
