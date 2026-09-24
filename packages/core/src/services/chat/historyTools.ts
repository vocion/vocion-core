/**
 * WHAT A PAST TURN ACTUALLY DID, replayed with it.
 *
 * History reaches the model as text: "I'll pull the records… Nothing on
 * record covers this." With no tool evidence behind those words, the model
 * on the next turn disbelieves its own earlier self — production turns 595,
 * 608, 625 and 631 (2026-09-24) each opened with "my last message got ahead
 * of itself; I said I'd pulled the records and I hadn't" and re-planned,
 * once onto the wrong request. It HAD pulled them. This appends one line to
 * each replayed assistant turn saying which tools ran and what came back, so
 * the earlier turn's claims stand on their evidence.
 */

type RunEntry = { type?: string; name?: string; input?: unknown; output?: unknown; label?: string; actionId?: string; runId?: number };

const MAX_MARKER = 600;

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
 * The marker for one stored turn's `runs_json`, or '' when no tool ran.
 * @param runs - The stored runs (text, tool, …).
 */
export function toolsMarker(runs: unknown): string {
  if (!Array.isArray(runs)) {
    return '';
  }
  const tools = (runs as RunEntry[]).filter(r => r && r.type === 'tool' && typeof r.name === 'string');
  const cards = (runs as RunEntry[]).filter(r => r && r.type === 'card' && typeof r.label === 'string');
  if (tools.length === 0 && cards.length === 0) {
    return '';
  }
  const parts: string[] = [];
  if (tools.length > 0) {
    parts.push(`you ran: ${tools.map(r => `${r.name}${brief(r.input)}${came(r.output)}`).join('; ')}`);
  }
  if (cards.length > 0) {
    // The card IS the thing a person approves next: its label, the action it
    // carries, the payload's title, and the proposal id when it was filed.
    parts.push(`you put up ${cards.length === 1 ? 'a card' : `${cards.length} cards`}: ${cards.map((c) => {
      const input = c.input && typeof c.input === 'object' ? c.input as Record<string, unknown> : {};
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
