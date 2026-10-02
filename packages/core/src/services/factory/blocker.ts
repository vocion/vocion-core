import { CORE_NOUN_CODES, nounCode } from '@/libs/codes';
/**
 * A BLOCKER GOES STALE WHEN THE THING IT WAITS ON MOVES.
 *
 * `request.blocker` is written by the PM (what, owner, next) and read as
 * Blocked by the Work board and the feature page. Nothing cleared it when the
 * state it named moved: #130 said "Chris to approve plan 136" for hours after
 * plan 136 was approved (action 5159, 2026-09-29 14:20 UTC), because the
 * blocker was prose and nothing read the prose back.
 *
 * Now a blocker says what it waits on — `waitsOn: [{kind, id}]`, typed on the
 * request schema — and, for one written before that field existed, the
 * records its `next` names ("approve plan 136", "ask #12", "review item
 * #4068") are read as the same refs. The one move that clears it is `next`;
 * when any record it names has been decided, the move was made and the
 * blocker is stale. Pure: the facts are passed in, so the page, the sweep and
 * the plan-approved step all judge it the same way.
 */

export type BlockerRefKind = 'plan' | 'ask' | 'action';

/** A record a blocker waits on. */
export type BlockerRef = { kind: BlockerRefKind; id: number };

/** What is known about each record a blocker can name. Absent means not known, never resolved. */
export type BlockerFacts = {
  plans?: Array<{ id: number; status?: unknown; approvedAt?: unknown }>;
  asks?: Array<{ id: number; status?: string | null; decidedAt?: Date | string | null }>;
  actions?: Array<{ id: number; status: string; decidedAt?: Date | string | null; executedAt?: Date | string | null }>;
};

/** Why a blocker no longer holds, and since when. */
export type BlockerResolution = { ref: BlockerRef; line: string; at: Date | null };

const KINDS = new Set<BlockerRefKind>(['plan', 'ask', 'action']);

/**
 * The phrases in a blocker's `next` that name a record, and the kind each
 * names. "review item" and "card" are what a pending action is called on the
 * page; the number after them is the action run's id.
 */
const NAMED: Array<{ kind: BlockerRefKind; re: RegExp }> = [
  { kind: 'plan', re: /\bplan\s+#?(\d+)/gi },
  { kind: 'ask', re: /\bask\s+#?(\d+)/gi },
  { kind: 'action', re: /\b(?:review\s+item|action(?:\s+run)?|card)\s+#?(\d+)/gi },
  // The same records by their codes (`libs/codes.ts`): ASK-267, ACT-5590, and
  // a plan by its type's code (PL-295) — any record code, which resolves only
  // when the id is one of the request's plans.
  { kind: 'ask', re: new RegExp(`\\b${CORE_NOUN_CODES.ask}-(\\d+)`, 'g') },
  { kind: 'action', re: new RegExp(`\\b${CORE_NOUN_CODES.action}-(\\d+)`, 'g') },
  { kind: 'plan', re: new RegExp(`\\b(?!(?:${Object.values(CORE_NOUN_CODES).join('|')})-)[A-Z]{2,5}-(\\d+)`, 'g') },
];

function toDate(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function refOf(v: unknown): BlockerRef | null {
  if (v === null || typeof v !== 'object') {
    return null;
  }
  const r = v as Record<string, unknown>;
  const id = Number(r.id);
  return typeof r.kind === 'string' && KINDS.has(r.kind as BlockerRefKind) && Number.isInteger(id) && id > 0
    ? { kind: r.kind as BlockerRefKind, id }
    : null;
}

/**
 * The records a blocker waits on: its typed `waitsOn` when it has one, else
 * the records its `next` names.
 * @param raw - `request.metadata.blocker`.
 */
export function blockerRefs(raw: unknown): BlockerRef[] {
  if (raw === null || typeof raw !== 'object') {
    return [];
  }
  const b = raw as Record<string, unknown>;
  const typed = (Array.isArray(b.waitsOn) ? b.waitsOn : b.waitsOn ? [b.waitsOn] : []).map(refOf).filter((r): r is BlockerRef => r !== null);
  if (typed.length > 0) {
    return typed;
  }
  const next = typeof b.next === 'string' ? b.next : '';
  const out: BlockerRef[] = [];
  for (const { kind, re } of NAMED) {
    for (const m of next.matchAll(re)) {
      const id = Number(m[1]);
      if (id > 0 && !out.some(r => r.kind === kind && r.id === id)) {
        out.push({ kind, id });
      }
    }
  }
  return out;
}

/**
 * Has the move this blocker waits on been made? The first record it names
 * that has been decided — a plan approved, an ask answered, a card decided —
 * after the blocker was written (when it says when; `since`). Null while every
 * record it names is still open, or when it names none.
 * @param raw - `request.metadata.blocker`.
 * @param facts - The records it may name.
 */
export function blockerResolution(raw: unknown, facts: BlockerFacts): BlockerResolution | null {
  const refs = blockerRefs(raw);
  if (refs.length === 0) {
    return null;
  }
  const since = toDate((raw as Record<string, unknown>).since ?? (raw as Record<string, unknown>).at);
  const after = (at: Date | null) => since === null || at === null || at.getTime() >= since.getTime();
  for (const ref of refs) {
    if (ref.kind === 'plan') {
      const p = facts.plans?.find(x => x.id === ref.id);
      const at = toDate(p?.approvedAt);
      if (p && (p.status === 'approved' || at !== null) && after(at)) {
        return { ref, line: `plan #${ref.id} was approved`, at };
      }
    } else if (ref.kind === 'ask') {
      const a = facts.asks?.find(x => x.id === ref.id);
      const at = toDate(a?.decidedAt);
      if (a && (at !== null || (a.status != null && a.status !== 'open')) && after(at)) {
        return { ref, line: `${nounCode('ask', ref.id)} was answered`, at };
      }
    } else {
      const r = facts.actions?.find(x => x.id === ref.id);
      const at = toDate(r?.decidedAt) ?? toDate(r?.executedAt);
      if (r && r.status !== 'pending' && after(at)) {
        return { ref, line: `review item ${nounCode('action', ref.id)} was decided`, at };
      }
    }
  }
  return null;
}
