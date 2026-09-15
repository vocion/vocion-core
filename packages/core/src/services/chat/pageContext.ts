/**
 * Where the person is in the app when they ask (ticket 058), now structured.
 *
 * Off a record page the dock is the everything-scoped conversation, but the
 * person is still looking at something: a briefing, an ask waiting in the
 * inbox, a team's row on the report, a deal. The client sends that as
 * `page_context` with each turn. Two readers use it: the model gets a compact
 * note under the message (`withPageContext`) and can pull the same object
 * deliberately through the `page_context` tool; the conversation row keeps
 * the context of its FIRST turn (`context_json`) so history shows where a
 * thread started. The persisted transcript keeps the raw message.
 *
 * Shape (also the wire shape, validated by `readPageContext`):
 *   { path, title, record?, selection?, refs?, openedFrom? }
 *   record / refs[] are `RecordRef` — { type, id, label?, href? }.
 *
 * `RecordRef` is the single ref shape in the app. The composer's `@tag`
 * autocomplete (R2's agent rail) produces the same type and posts it beside
 * the message as `context_refs`, read by `readContextRefs`; the client-side
 * `ContextRef` in `features/dashboard/chat/types.ts` is that shape plus a
 * `routeTo` routing hint, which is stripped on the way in.
 */

export const RECORD_TYPES = [
  'briefing',
  'ask',
  'agent',
  'team',
  'mission',
  'mission_run',
  'object',
  'deal',
  'worker_run',
  'conversation',
  'canvas-tile',
  // The composer can tag the page itself (`@page`).
  'page',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

/** A typed pointer at one record in the app — the unit of "this". */
export type RecordRef = {
  type: RecordType;
  id: string;
  /** Human name for the note and for chips ("Revenue Briefing — Mon, Sep 15"). */
  label?: string;
  /** In-app route for the chip. Relative, never absolute. */
  href?: string;
};

export type PageContext = {
  path: string;
  title: string;
  /** The record the page is about, when it is a record page or an affordance named one. */
  record?: RecordRef;
  /** Text the person highlighted before asking — quoted to the model verbatim. */
  selection?: { text: string; quote?: true };
  /** Records the person @-mentioned in the composer. */
  refs?: RecordRef[];
  /**
   * Set by an "Ask about this" affordance: the conversation was opened FROM a
   * record, not from the hotkey. Drives the `chat.opened_from_context` event.
   */
  openedFrom?: true;
};

const MAX = 200;
const MAX_ID = 120;
const MAX_LABEL = 200;
const MAX_HREF = 400;
const MAX_SELECTION = 2000;
const MAX_REFS = 8;
/** Composer `@tags` per turn — the autocomplete caps its own hit list at 12. */
const MAX_TAG_REFS = 12;

const RECORD_TYPE_SET: ReadonlySet<string> = new Set(RECORD_TYPES);

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const t = v.trim().slice(0, max);
  return t || null;
}

/**
 * Validate one record reference. Anything off-shape reads as no ref — the
 * message is still fine to answer without it.
 * @param raw - A candidate `{type, id, label?, href?}`.
 */
export function readRecordRef(raw: unknown): RecordRef | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { type, id, label, href } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || !RECORD_TYPE_SET.has(type)) {
    return null;
  }
  const i = str(id, MAX_ID);
  if (!i) {
    return null;
  }
  const ref: RecordRef = { type: type as RecordType, id: i };
  const l = str(label, MAX_LABEL);
  if (l) {
    ref.label = l;
  }
  const h = str(href, MAX_HREF);
  // Only in-app, relative routes travel — an absolute URL in a chip is an
  // open redirect waiting to happen.
  if (h && h.startsWith('/') && !h.startsWith('//')) {
    ref.href = h;
  }
  return ref;
}

/**
 * Validate the client's `context_refs`: the records the person tagged in the
 * composer (`@team`, `@mission`, a deal…), posted beside the message. Each
 * entry is a `RecordRef`; malformed entries are dropped one by one, because a
 * bad tag must never fail the turn.
 * @param raw - `body.context_refs` as posted.
 */
export function readContextRefs(raw: unknown): RecordRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: RecordRef[] = [];
  for (const item of raw) {
    const ref = readRecordRef(item);
    if (!ref) {
      continue;
    }
    out.push(ref);
    if (out.length >= MAX_TAG_REFS) {
      break;
    }
  }
  return out;
}

/**
 * Validate the client's `page_context`. `path` is the one required field;
 * every other part is kept only when it parses. Anything else (missing,
 * wrong shape, empty, oversized) reads as no context, never as an error.
 * @param raw - `body.page_context` as posted.
 */
export function readPageContext(raw: unknown): PageContext | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const path = str(r.path, MAX);
  if (!path) {
    return null;
  }
  const ctx: PageContext = { path, title: str(r.title, MAX) ?? '' };

  const record = readRecordRef(r.record);
  if (record) {
    ctx.record = record;
  }

  if (typeof r.selection === 'object' && r.selection !== null) {
    const text = str((r.selection as Record<string, unknown>).text, MAX_SELECTION);
    if (text) {
      ctx.selection = { text, quote: true };
    }
  }

  if (Array.isArray(r.refs)) {
    const refs = r.refs.slice(0, MAX_REFS).map(readRecordRef).filter((x): x is RecordRef => x !== null);
    if (refs.length > 0) {
      ctx.refs = refs;
    }
  }

  if (r.openedFrom === true) {
    ctx.openedFrom = true;
  }
  return ctx;
}

/**
 * Fold a scoped dock's `scopeRef` (a CRM mirror ref like `contacts:9412`)
 * into the context as a ref, so a scoped conversation and a page context can
 * travel together instead of excluding each other.
 * @param ctx - The page context, or null.
 * @param scopeRef - The dock's scope, or null/undefined.
 */
export function mergeScopeRef(ctx: PageContext | null, scopeRef: string | null | undefined): PageContext | null {
  if (!scopeRef) {
    return ctx;
  }
  const ref = scopeRefToRecord(scopeRef);
  if (!ref) {
    return ctx;
  }
  const base: PageContext = ctx ?? { path: '', title: '' };
  const refs = base.refs ?? [];
  if (refs.some(x => x.type === ref.type && x.id === ref.id) || (base.record?.type === ref.type && base.record.id === ref.id)) {
    return base;
  }
  return { ...base, refs: [...refs, ref].slice(0, MAX_REFS) };
}

/**
 * `contacts:9412` → a record ref. Contacts/companies/deals map onto the
 * one CRM record type the context knows; anything else stays an `object`.
 * @param scopeRef - The dock's scope ref.
 */
export function scopeRefToRecord(scopeRef: string): RecordRef | null {
  const [kind, id] = scopeRef.split(':', 2);
  if (!kind || !id) {
    return null;
  }
  const type: RecordType = kind === 'deals' ? 'deal' : 'object';
  return { type, id: `${kind}:${id}`.slice(0, MAX_ID) };
}

function describeRecord(ref: RecordRef): string {
  const name = ref.label ? `"${ref.label}"` : ref.id;
  return `${ref.type.replace('_', ' ')} ${name}${ref.href ? ` (${ref.href})` : ''}`;
}

/**
 * The message as the model sees it: the person's words, then where they are —
 * page, the record it is about, anything they @-mentioned, and the passage they
 * highlighted, quoted. Compact by design: the model can call `page_context`
 * for the same object when it wants to work from it deliberately.
 * Records tagged in the composer travel in `refs` and get their own note, so
 * an `@tag` reaches the model and not only the router.
 * @param message - What the person typed.
 * @param ctx - The page they are on, or null for a context-free turn.
 * @param refs - Records tagged in the composer (`context_refs`), if any.
 */
export function withPageContext(message: string, ctx: PageContext | null, refs: RecordRef[] = []): string {
  const tagged = refs.length > 0
    ? `\n\n--- records I tagged ---\nMy question is about these specifically; look them up rather than guessing:\n${refs.map(r => `- ${r.type} "${r.label || r.id}" (${r.type}:${r.id})`).join('\n')}`
    : '';
  if (!ctx) {
    return `${message}${tagged}`;
  }
  const lines: string[] = [];
  const where = ctx.title ? `"${ctx.title}" (${ctx.path})` : ctx.path;
  if (where.trim()) {
    lines.push(`I am looking at ${where} in the app.`);
  }
  if (ctx.record) {
    lines.push(`This page is about the ${describeRecord(ctx.record)}.`);
  }
  if (ctx.refs && ctx.refs.length > 0) {
    lines.push(`I mentioned: ${ctx.refs.map(describeRecord).join('; ')}.`);
  }
  if (ctx.selection) {
    lines.push(`I highlighted this passage:\n> ${ctx.selection.text.replace(/\n/g, '\n> ')}`);
  }
  lines.push(
    ctx.record || ctx.selection
      ? 'Unless I say otherwise, take my question to be about that record and passage. The `page_context` tool returns the same details as JSON.'
      : 'Unless I say otherwise, take my question to be about what that page shows.',
  );
  return `${message}\n\n--- where I am ---\n${lines.join('\n')}${tagged}`;
}
