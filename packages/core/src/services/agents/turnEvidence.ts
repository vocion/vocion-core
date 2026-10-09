/**
 * TURN EVIDENCE — what one turn has already found, so nothing in it is looked
 * up twice and a consulted teammate starts from it.
 *
 * On 2026-10-09 (trace c126f3ca) one turn searched the same person's name
 * three times and the same company twice, and the consulted Follow Up
 * Coordinator was handed a one-line task and re-ran the lead's searches from
 * scratch — 23 of them, 133 s. The turn held the answers; nothing carried them.
 *
 * One ledger per turn, on the turn's context, which the lead's tools and every
 * teammate's tools share (they close over the same context):
 *
 *   - **Every cited source** is recorded as its `documents` event goes out —
 *     number, title, source, document id — whichever tool found it.
 *   - **Every search** is recorded by its normalised key: the query lowercased
 *     with whitespace collapsed, plus its filters in a stable order. A repeat
 *     returns the earlier result's numbers instead of searching again. That is
 *     the only "near" a repeat is: the words are never compared for meaning.
 *   - **A consult carries the ledger.** The `task` call's description gets the
 *     searches already run and the sources already found, with their numbers,
 *     and the teammate is told not to repeat them.
 */
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';

export type EvidenceSource = { n: number; title: string; source: string; documentId?: string; link?: string; at?: string };
export type EvidenceSearch = { query: string; key: string; numbers: number[]; output: string; hits: number };

export type TurnEvidence = {
  sources: Map<number, EvidenceSource>;
  searches: Map<string, EvidenceSearch>;
  /** Results of read-only lookups that declare `turnMemo`, by tool and canonical arguments. */
  lookups: Map<string, { tool: string; content: string }>;
};

/** A fresh, empty ledger. */
export function newTurnEvidence(): TurnEvidence {
  return { sources: new Map(), searches: new Map(), lookups: new Map() };
}

/**
 * Canonical JSON: keys sorted at every level, so two filters that say the same
 * thing in a different order make the same key.
 * @param value - Any JSON value.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The key a search is remembered by: its query normalised by case and
 * whitespace only, and its filters canonically ordered.
 * @param tool - The tool searched with.
 * @param args - Its arguments; `query` is the free text.
 */
export function searchKey(tool: string, args: Record<string, unknown>): string {
  const { query, ...filters } = args;
  const q = typeof query === 'string' ? query.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  const sortedFilters = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : v]));
  return `${tool}|${q}|${canonical(sortedFilters)}`;
}

/**
 * Note the sources a `documents` event carried.
 * @param ev - The ledger.
 * @param documents - The event's documents, each with its citation number.
 */
export function noteSources(ev: TurnEvidence, documents: ReadonlyArray<{ citationIndex?: number; semantic_identifier?: string; source_type?: string; document_id?: string; link?: string; updated_at?: string }>): void {
  for (const d of documents) {
    if (typeof d.citationIndex === 'number' && !ev.sources.has(d.citationIndex)) {
      ev.sources.set(d.citationIndex, {
        n: d.citationIndex,
        title: (d.semantic_identifier ?? '').slice(0, 120),
        source: d.source_type ?? 'unknown',
        ...(d.document_id ? { documentId: d.document_id } : {}),
        ...(d.link ? { link: d.link } : {}),
        ...(d.updated_at ? { at: d.updated_at } : {}),
      });
    }
  }
}

/**
 * The line a repeated search returns instead of searching again.
 * @param prior
 */
export function repeatNote(prior: EvidenceSearch): string {
  const nums = prior.numbers.length > 0 ? prior.numbers.map(n => `[${n}]`).join('') : 'nothing';
  return `Already searched this turn with the same query and filters ("${prior.query}"): it found ${prior.hits === 0 ? 'nothing' : nums}. Use those results above; do not run this search again.${prior.hits > 0 ? `\n\n${prior.output}` : ''}`;
}

/** The most sources and searches a hand-off names. */
const HANDOFF_SOURCES = 30;
const HANDOFF_SEARCHES = 20;

/**
 * The block a consult's task description carries: what this turn already
 * searched for and found, by citation number. Empty when nothing has been.
 * @param ev - The ledger.
 */
export function evidenceBlock(ev: TurnEvidence): string {
  if (ev.sources.size === 0 && ev.searches.size === 0) {
    return '';
  }
  const lines = ['', '--- ALREADY GATHERED THIS TURN (by the agent consulting you) ---'];
  if (ev.searches.size > 0) {
    lines.push('Searches already run — do not run these again:');
    for (const s of [...ev.searches.values()].slice(-HANDOFF_SEARCHES)) {
      lines.push(`- "${s.query}" → ${s.hits === 0 ? 'nothing' : s.numbers.map(n => `[${n}]`).join('')}`);
    }
  }
  if (ev.sources.size > 0) {
    lines.push('Sources already found (cite them by these numbers; look further only for what is missing):');
    for (const s of [...ev.sources.values()].slice(0, HANDOFF_SOURCES)) {
      lines.push(`- [${s.n}] ${s.title} (${s.source}${s.at ? `, ${s.at.slice(0, 10)}` : ''})`);
    }
    if (ev.sources.size > HANDOFF_SOURCES) {
      lines.push(`- and ${ev.sources.size - HANDOFF_SOURCES} more`);
    }
  }
  lines.push('Build on this: answer the task from it where it is enough, and search only for what it lacks.');
  return lines.join('\n');
}

/** The tool a lead consults a teammate through (deepagents' subagent tool). */
const CONSULT_TOOL = 'task';

/**
 * Hands a consult what the turn already has: the `task` call's description
 * gets the evidence block appended before the teammate starts.
 * @param ev - The turn's ledger.
 */
export function createEvidenceHandoffMiddleware(ev: TurnEvidence) {
  return createMiddleware({
    name: 'VocionEvidenceHandoff',
    wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== CONSULT_TOOL) {
        return handler(request);
      }
      const block = evidenceBlock(ev);
      const args = request.toolCall.args as { description?: unknown };
      if (!block || typeof args.description !== 'string') {
        return handler(request);
      }
      return handler({ ...request, toolCall: { ...request.toolCall, args: { ...args, description: `${args.description}\n${block}` } } });
    },
  });
}

/**
 * Whether a tool says its result can be reused within a turn: a read-only
 * lookup whose answer does not change in the seconds a turn takes. Declared by
 * the tool (`metadata: { turnMemo: true }`), never listed here.
 * @param tool - The tool being called.
 */
function memoisable(tool: unknown): boolean {
  return (tool as { metadata?: { turnMemo?: unknown } } | undefined)?.metadata?.turnMemo === true;
}

/**
 * Answers a repeated read-only lookup — same tool, same arguments, by the
 * lead or a teammate — from the turn's first result, saying so.
 * @param ev - The turn's ledger.
 */
export function createLookupMemoMiddleware(ev: TurnEvidence) {
  return createMiddleware({
    name: 'VocionLookupMemo',
    wrapToolCall: async (request, handler) => {
      if (!memoisable(request.tool)) {
        return handler(request);
      }
      const key = searchKey(request.toolCall.name, request.toolCall.args as Record<string, unknown>);
      const prior = ev.lookups.get(key);
      if (prior) {
        return new ToolMessage({
          content: `Already looked up this turn with the same arguments — the same result as before, repeated here; do not call it again:\n\n${prior.content}`,
          tool_call_id: request.toolCall.id ?? '',
          name: request.toolCall.name,
        });
      }
      const result = await handler(request);
      const content = (result as { content?: unknown }).content;
      if (typeof content === 'string' && !(result as { status?: string }).status?.startsWith('error')) {
        ev.lookups.set(key, { tool: request.toolCall.name, content });
      }
      return result;
    },
  });
}
