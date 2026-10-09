/**
 * FACETS — typed state on an indexed document, so a question about STATE is
 * one filtered query rather than a hunt for phrases.
 *
 * Why this exists (2026-10-09, trace c126f3ca): "What sales emails do I need
 * to answer" took the RevOps Lead 35 steps and 3m20s of phrase searches. The
 * index held CONTENT; the question was about STATE (who is waiting on whom),
 * and no phrase search can see state.
 *
 * One shape for every source. A FACET SET names a kind of document — an email
 * thread, a calendar event, a deal, an issue, a pull request, a chat message,
 * an invoice — by the metadata that marks it (`match`), and declares the
 * facets it carries: a name, a kind, the allowed values, what it means, and
 * where in the document's metadata it lives (`path`). Some facets are worked
 * out at sync for the purpose (a mail thread's `reply_state`, under
 * `metadata.facets`); most are fields the connector already stores (a
 * calendar event's `start`, an issue's `assignee`), read where they are, so a
 * new set needs no re-ingest.
 *
 * A filter is read the same way everywhere: `search_knowledge` ranks within
 * it, `query_state` lists it (`services/state/queryState.ts`), and a saved
 * view is a stored filter (`services/state/views.ts`). Every set also has the
 * document's own date as `updated_at`.
 *
 * Values may be relative — `{"since": "-14d"}`, `{"until": "+24h"}`, `"now"` —
 * and `"$me"` stands for the person asking (their address, its local part and
 * their name), so one stored view serves everyone.
 */
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/** A value a facet may hold. Dates are ISO strings. */
export type FacetValue = string | number | boolean | null | string[];

/** What a facet holds, which decides how a filter on it matches. */
export type FacetKind
  /** One of `values`; a filter matches exactly, any of a list, or `{not}`. */
  = | 'enum'
  /** Free text (a name, an address); a filter matches case-insensitively as a substring. */
    | 'text'
  /** A list of strings (attendees, reviewers, mentions); a filter matches when any element is any value, case aside. */
    | 'list'
  /** An ISO date or timestamp; a filter is a bound — `{since}`, `{until}`, absolute or relative. */
    | 'date'
  /** A number; a filter is `{gt}` / `{lt}` or an exact value. */
    | 'number'
  /** true / false. */
    | 'boolean';

export type FacetSpec = {
  name: string;
  kind: FacetKind;
  /** The allowed values, for an `enum`. */
  values?: readonly string[];
  /** What it means, in the words the model reads. */
  description: string;
  /** Where it lives in `metadata`, dotted (default `facets.<name>`). */
  path?: string;
};

export type FacetSet = {
  /** Stable id, domain first: `mail.thread`, `crm.deal`, `code.pull_request`. */
  id: string;
  /** The connector that writes these documents. */
  connector: string;
  /** The metadata that marks a document as one of these. */
  match: { key: string; value: string };
  /** What one is, for descriptions ("email thread"). */
  noun: string;
  facets: readonly FacetSpec[];
};

/** Reply states of an email thread, from the mailbox owner's side. */
export const REPLY_STATES = ['needs_my_reply', 'waiting_on_them', 'fyi', 'outbound_spam'] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

/** What a thread is about, broadly — enough to answer "sales emails" without a phrase hunt. */
export const THREAD_CATEGORIES = ['sales', 'customer', 'partner', 'vendor', 'hiring', 'internal', 'personal', 'other'] as const;
export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

/** The document kind a mail thread's state is filed under. */
export const MAIL_THREAD_STATE_KIND = 'mail-thread-state';

/** Every set's own date: when the source last changed the document. */
const UPDATED_AT: FacetSpec = { name: 'updated_at', kind: 'date', description: 'when the source last changed it' };

/**
 * Every declared facet set. Add one here when a source carries state a person
 * asks about; the search tool, `query_state` and saved views pick it up.
 */
const DECLARED: FacetSet[] = [
  {
    id: 'mail.thread',
    connector: 'gmail',
    match: { key: 'kind', value: MAIL_THREAD_STATE_KIND },
    noun: 'email thread',
    facets: [
      {
        name: 'reply_state',
        kind: 'enum',
        values: REPLY_STATES,
        description: 'needs_my_reply = the other side wrote last and expects an answer from the mailbox owner; waiting_on_them = the owner wrote last; fyi = nothing to answer (notices, receipts, newsletters, a thanks); outbound_spam = a cold pitch or automated sales sequence aimed at the owner',
      },
      { name: 'category', kind: 'enum', values: THREAD_CATEGORIES, description: 'what the thread is about: sales (prospects, deals, proposals), customer, partner, vendor, hiring, internal, personal, other' },
      { name: 'counterpart', kind: 'text', description: 'who is on the other side, name and address (matches a part, e.g. "kestrel" or "dana")' },
      { name: 'last_inbound_at', kind: 'date', description: 'when the other side last wrote' },
      { name: 'last_outbound_at', kind: 'date', description: 'when the owner last wrote' },
      { name: 'mailbox', kind: 'text', description: 'whose mailbox the thread is in' },
      { name: 'ask', kind: 'text', description: 'what the other side asked for, in one line' },
    ],
  },
  {
    id: 'calendar.event',
    connector: 'google-calendar',
    match: { key: 'kind', value: 'calendar-event' },
    noun: 'calendar event',
    facets: [
      { name: 'start', kind: 'date', path: 'start', description: 'when it starts' },
      { name: 'organizer', kind: 'text', path: 'organizer', description: 'who organised it' },
      { name: 'attendees', kind: 'list', path: 'attendees', description: 'attendee addresses' },
      { name: 'external_attendees', kind: 'number', path: 'facets.external_attendees', description: 'how many attendees are from outside the organiser\'s domain' },
    ],
  },
  {
    id: 'crm.deal',
    connector: 'hubspot',
    match: { key: 'objectType', value: 'deals' },
    noun: 'deal',
    facets: [
      { name: 'stage', kind: 'text', path: 'dealStage', description: 'the deal stage id (closedwon / closedlost are closed)' },
      { name: 'amount', kind: 'number', path: 'amount', description: 'deal amount' },
      { name: 'close_date', kind: 'date', path: 'closeDate', description: 'expected close date' },
      { name: 'owner', kind: 'text', path: 'ownerId', description: 'the CRM owner id' },
    ],
  },
  {
    id: 'tasks.issue',
    connector: 'jira',
    match: { key: 'type', value: 'issue' },
    noun: 'issue',
    facets: [
      { name: 'assignee', kind: 'text', path: 'assignee', description: 'who it is assigned to (address or name)' },
      { name: 'status', kind: 'text', path: 'status', description: 'workflow status' },
      { name: 'completed', kind: 'boolean', path: 'completed', description: 'whether it is done' },
      { name: 'due', kind: 'date', path: 'due', description: 'due date' },
    ],
  },
  {
    id: 'code.pull_request',
    connector: 'github',
    match: { key: 'kind', value: 'pull_request' },
    noun: 'pull request',
    facets: [
      { name: 'state', kind: 'enum', path: 'state', values: ['open', 'closed', 'merged'], description: 'open, closed or merged' },
      { name: 'author', kind: 'text', path: 'author', description: 'who opened it (login)' },
      { name: 'requested_reviewers', kind: 'list', path: 'requestedReviewers', description: 'whose review is requested (logins)' },
      { name: 'draft', kind: 'boolean', path: 'draft', description: 'whether it is a draft' },
    ],
  },
  {
    id: 'chat.message',
    connector: 'slack',
    match: { key: 'kind', value: 'slack-message' },
    noun: 'chat message',
    facets: [
      { name: 'channel', kind: 'text', path: 'channelName', description: 'the channel name' },
      { name: 'author', kind: 'text', path: 'user', description: 'the author\'s member id' },
      { name: 'mentions', kind: 'list', path: 'mentions', description: 'member ids the message mentions' },
    ],
  },
  {
    id: 'finance.invoice',
    connector: 'quickbooks',
    match: { key: 'objectType', value: 'invoice' },
    noun: 'invoice',
    facets: [
      { name: 'customer', kind: 'text', path: 'customer', description: 'who it is billed to' },
      { name: 'due', kind: 'date', path: 'dueDate', description: 'due date' },
      { name: 'balance', kind: 'number', path: 'balance', description: 'amount still owed' },
      { name: 'status', kind: 'text', path: 'status', description: 'payment status' },
    ],
  },
];

export const FACET_SETS: readonly FacetSet[] = DECLARED.map(s => ({ ...s, facets: [...s.facets, UPDATED_AT] }));

/** A filter as the model or a stored view writes it. */
export type FacetFilterValue
  = | string
    | number
    | boolean
    | string[]
    | { since?: string; until?: string }
    | { not: string | string[] }
    | { gt?: number; lt?: number }
    | { exists: boolean };
export type FacetFilter = Record<string, FacetFilterValue>;

/** What a filter is resolved against: who is asking, and when. */
export type FacetContext = {
  /** The person's handles: address, its local part, name. `$me` expands to these. */
  me?: string[];
  now?: Date;
};

/**
 * The facet sets offered for a set of connected sources.
 * @param connectors - The connector kinds behind the agent's sources.
 */
export function facetSetsFor(connectors: Iterable<string>): FacetSet[] {
  const have = new Set(connectors);
  return FACET_SETS.filter(s => have.has(s.connector));
}

/**
 * A set by id.
 * @param id - `mail.thread`, `crm.deal`, …
 */
export function facetSet(id: string): FacetSet | undefined {
  return FACET_SETS.find(s => s.id === id);
}

/**
 * The lines the search tool's description carries, so the model knows what it
 * can filter on and when to. Empty when no connected source carries facets.
 * @param connectors - The connector kinds behind the agent's sources.
 */
export function describeFacets(connectors: Iterable<string>): string {
  const sets = facetSetsFor(connectors);
  if (sets.length === 0) {
    return '';
  }
  return [
    'STATE IS A FILTER, NOT A PHRASE: when the question is about state — who owes whom a reply, what is waiting, what is overdue, what is next — pass `facets` and ONE plain query for the topic instead of guessing phrases the documents might contain. Example: "what sales emails do I need to answer" is facets {"reply_state": "needs_my_reply", "category": "sales"} with query "sales". Dates take {"since": "-7d"} or an ISO date; "$me" is the person asking.',
    ...sets.map(s => `${s.noun}s (${s.connector}): ${describeSet(s)}.`),
  ].join(' ');
}

/**
 * One set's facets in a line.
 * @param set - The set.
 */
export function describeSet(set: FacetSet): string {
  return set.facets.map(f => `${f.name}${f.values ? ` (${f.values.join(' | ')})` : ` (${f.kind})`}${f.name === 'updated_at' ? '' : `: ${f.description}`}`).join('; ');
}

export type FacetFilterError = { facet: string; message: string };

/**
 * The sets a filter can apply to: every set (of those given) that declares
 * every facet the filter names.
 * @param filter - The filter.
 * @param among - The sets in play; all of them by default.
 */
export function setsForFilter(filter: FacetFilter, among: readonly FacetSet[] = FACET_SETS): FacetSet[] {
  const names = Object.keys(filter);
  return among.filter(s => names.every(n => s.facets.some(f => f.name === n)));
}

/**
 * Check a filter against the declarations: unknown facets and values outside
 * an enum are refused with the allowed ones named, so the model can correct
 * itself in one step rather than reading an empty result as "nothing there".
 * @param filter - The filter as written.
 * @param among - The sets in play; all of them by default.
 */
export function validateFacetFilter(filter: FacetFilter, among: readonly FacetSet[] = FACET_SETS): FacetFilterError[] {
  const errors: FacetFilterError[] = [];
  const known = new Map<string, FacetSpec[]>();
  for (const s of among) {
    for (const f of s.facets) {
      known.set(f.name, [...(known.get(f.name) ?? []), f]);
    }
  }
  for (const [name, value] of Object.entries(filter)) {
    const specs = known.get(name);
    if (!specs) {
      errors.push({ facet: name, message: `unknown facet "${name}"; known: ${[...known.keys()].join(', ')}` });
      continue;
    }
    const spec = specs[0]!;
    if (spec.kind === 'enum' && spec.values) {
      const raw = isObject(value) && 'not' in value ? (value as { not: string | string[] }).not : value;
      const wanted = Array.isArray(raw) ? raw : [raw];
      const bad = wanted.filter(v => !spec.values!.includes(String(v)));
      if (bad.length > 0) {
        errors.push({ facet: name, message: `"${bad.join('", "')}" is not a ${name}; use one of ${spec.values.join(', ')}` });
      }
    }
    if (spec.kind === 'date' && !(isObject(value) && ('since' in value || 'until' in value || 'exists' in value))) {
      errors.push({ facet: name, message: `${name} takes {"since": "<ISO date or -7d>"} and/or {"until": "<ISO date or +24h>"}` });
    }
  }
  if (errors.length === 0 && Object.keys(filter).length > 0 && setsForFilter(filter, among).length === 0) {
    errors.push({ facet: Object.keys(filter).join(', '), message: 'no one kind of document carries all of these facets together; filter on facets of one kind' });
  }
  return errors;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const RELATIVE = /^([+-])(\d+)([mhdw])$/;

/**
 * An absolute ISO instant for a date bound: `now`, `-14d`, `+24h`, `-30m`,
 * `-2w`, or a date as written.
 * @param raw - The bound.
 * @param now - The clock.
 */
export function resolveDate(raw: string, now: Date = new Date()): string | null {
  const v = raw.trim();
  if (v === 'now') {
    return now.toISOString();
  }
  const rel = RELATIVE.exec(v);
  if (rel) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[3] as 'm' | 'h' | 'd' | 'w'];
    return new Date(now.getTime() + (rel[1] === '-' ? -1 : 1) * Number(rel[2]) * unit).toISOString();
  }
  return Number.isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
}

/**
 * Values with `$me` expanded to the person's handles.
 * @param values - As written.
 * @param me - The person's handles.
 */
function expand(values: string[], me: string[] | undefined): string[] {
  return values.flatMap(v => (v === '$me' ? (me ?? []) : [v])).filter(v => v.length > 0);
}

/**
 * The handles `$me` stands for: the address, its local part, and the name.
 * @param person - The person.
 * @param person.email - Their address.
 * @param person.name - Their name.
 */
export function handlesOf(person: { email?: string | null; name?: string | null }): string[] {
  const out: string[] = [];
  if (person.email) {
    out.push(person.email.toLowerCase(), person.email.toLowerCase().split('@')[0]!);
  }
  if (person.name) {
    out.push(person.name);
  }
  return [...new Set(out)];
}

/**
 * The SQL path to a facet: `metadata #>> '{a,b}'`.
 * @param metadata - The metadata column.
 * @param spec - The facet.
 */
function fieldOf(metadata: SQL, spec: FacetSpec): SQL {
  const path = (spec.path ?? `facets.${spec.name}`).split('.');
  return sql`(${metadata} #>> ${`{${path.join(',')}}`})`;
}

function escapeLike(v: string): string {
  return v.replace(/[%_\\]/g, m => `\\${m}`);
}

/**
 * One facet's condition.
 * @param spec - The facet.
 * @param value - The filter value.
 * @param cols - Where to read.
 * @param cols.metadata - The metadata column.
 * @param cols.updatedAt - The document's own date.
 * @param ctx - Who and when.
 */
function facetCond(spec: FacetSpec, value: FacetFilterValue, cols: { metadata: SQL; updatedAt: SQL }, ctx: FacetContext): SQL | null {
  const now = ctx.now ?? new Date();
  const field = spec.name === 'updated_at' ? sql`(${cols.updatedAt})::text` : fieldOf(cols.metadata, spec);
  if (isObject(value) && 'exists' in value) {
    return value.exists ? sql`${field} IS NOT NULL` : sql`${field} IS NULL`;
  }
  if (spec.kind === 'date') {
    const bound = value as { since?: string; until?: string };
    const conds: SQL[] = [];
    const lo = bound.since ? resolveDate(bound.since, now) : null;
    const hi = bound.until ? resolveDate(bound.until, now) : null;
    const at = spec.name === 'updated_at' ? cols.updatedAt : sql`(${field})::timestamptz`;
    if (lo) {
      conds.push(sql`${at} >= ${lo}::timestamptz`);
    }
    if (hi) {
      conds.push(sql`${at} <= ${hi}::timestamptz`);
    }
    return conds.length > 0 ? sql.join(conds, sql` AND `) : null;
  }
  if (spec.kind === 'number') {
    const n = sql`(${field})::numeric`;
    if (isObject(value)) {
      const r = value as { gt?: number; lt?: number };
      const conds: SQL[] = [];
      if (typeof r.gt === 'number') {
        conds.push(sql`${n} > ${r.gt}`);
      }
      if (typeof r.lt === 'number') {
        conds.push(sql`${n} < ${r.lt}`);
      }
      return conds.length > 0 ? sql.join(conds, sql` AND `) : null;
    }
    return sql`${n} = ${Number(value)}`;
  }
  if (spec.kind === 'boolean') {
    return sql`${field} = ${String(value === true || value === 'true')}`;
  }
  const negate = isObject(value) && 'not' in value;
  const raw = negate ? (value as { not: string | string[] }).not : value;
  const wanted = expand((Array.isArray(raw) ? raw : [raw]).map(String), ctx.me);
  if (wanted.length === 0) {
    return negate ? null : sql`false`;
  }
  let cond: SQL;
  if (spec.kind === 'list') {
    const path = (spec.path ?? `facets.${spec.name}`).split('.');
    const arr = sql`(${cols.metadata} #> ${`{${path.join(',')}}`})`;
    // Elements are ids and addresses: whole-element matches, case aside — a
    // substring would let "alex" match a member id like "U0ALEX".
    cond = sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${arr}) = 'array' THEN ${arr} ELSE '[]'::jsonb END) AS el(v) WHERE lower(el.v) IN (${sql.join(wanted.map(w => sql`${w.toLowerCase()}`), sql`, `)}))`;
  } else if (spec.kind === 'text') {
    cond = sql`(${sql.join(wanted.map(w => sql`${field} ILIKE ${`%${escapeLike(w)}%`}`), sql` OR `)})`;
  } else {
    cond = sql`${field} IN (${sql.join(wanted.map(w => sql`${w}`), sql`, `)})`;
  }
  return negate ? sql`(${field} IS NULL OR NOT ${cond})` : cond;
}

/**
 * The SQL condition a filter adds on a document: for each set that carries
 * every facet named, "is one of these AND matches", OR-ed across sets. Null
 * for an empty filter; `false` when no set fits. Only declared facets reach
 * SQL, and every value is a bound parameter.
 * @param filter - A validated filter.
 * @param opts - Where to read and against what.
 * @param opts.metadata - The metadata column (default the alias `d.metadata`).
 * @param opts.updatedAt - The document's own date (default `d`'s).
 * @param opts.sets - Limit to these sets (default every set that fits).
 * @param opts.me - `$me`'s handles.
 * @param opts.now - The clock for relative dates.
 */
export function facetWhere(filter: FacetFilter | undefined, opts: { metadata?: SQL; updatedAt?: SQL; sets?: readonly FacetSet[] } & FacetContext = {}): SQL | null {
  const sets = opts.sets ?? FACET_SETS;
  if (!filter || Object.keys(filter).length === 0) {
    if (!opts.sets) {
      return null;
    }
    // A set with no filter still narrows to its documents.
    return matchAny(sets, opts.metadata ?? sql`d.metadata`);
  }
  const cols = { metadata: opts.metadata ?? sql`d.metadata`, updatedAt: opts.updatedAt ?? sql`COALESCE(d.last_modified_at, d.ingested_at)` };
  const fitting = setsForFilter(filter, sets);
  if (fitting.length === 0) {
    return sql`false`;
  }
  const perSet = fitting.map((s) => {
    const conds = [sql`(${cols.metadata} ->> ${s.match.key}) = ${s.match.value}`];
    for (const [name, value] of Object.entries(filter)) {
      const c = facetCond(s.facets.find(f => f.name === name)!, value, cols, opts);
      if (c) {
        conds.push(c);
      }
    }
    return sql`(${sql.join(conds, sql` AND `)})`;
  });
  return sql`(${sql.join(perSet, sql` OR `)})`;
}

function matchAny(sets: readonly FacetSet[], metadata: SQL): SQL {
  if (sets.length === 0) {
    return sql`false`;
  }
  return sql`(${sql.join(sets.map(s => sql`(${metadata} ->> ${s.match.key}) = ${s.match.value}`), sql` OR `)})`;
}

/**
 * Read a facet off a document's metadata, wherever the set says it lives.
 * @param metadata - The document's metadata.
 * @param spec - The facet.
 */
export function facetValueOf(metadata: Record<string, unknown>, spec: FacetSpec): unknown {
  let v: unknown = metadata;
  for (const k of (spec.path ?? `facets.${spec.name}`).split('.')) {
    v = isObject(v) ? v[k] : undefined;
  }
  return v;
}

/**
 * Whether a document's metadata satisfies a filter, in memory — the same
 * rules as `facetWhere`, for a caller holding documents already and for the
 * tests that keep the two honest.
 * @param metadata - A document's metadata.
 * @param filter - A validated filter.
 * @param ctx - Who and when.
 * @param updatedAt - The document's own date.
 */
export function facetsMatch(metadata: Record<string, unknown>, filter: FacetFilter | undefined, ctx: FacetContext = {}, updatedAt?: Date | null): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }
  const now = ctx.now ?? new Date();
  const set = setsForFilter(filter).find(s => String(metadata[s.match.key] ?? '') === s.match.value);
  if (!set) {
    return false;
  }
  for (const [name, value] of Object.entries(filter)) {
    const spec = set.facets.find(f => f.name === name)!;
    const have = spec.name === 'updated_at' ? updatedAt?.toISOString() : facetValueOf(metadata, spec);
    if (isObject(value) && 'exists' in value) {
      if ((have !== undefined && have !== null) !== value.exists) {
        return false;
      }
      continue;
    }
    if (spec.kind === 'date') {
      const at = typeof have === 'string' ? Date.parse(have) : Number.NaN;
      const b = value as { since?: string; until?: string };
      const lo = b.since ? resolveDate(b.since, now) : null;
      const hi = b.until ? resolveDate(b.until, now) : null;
      if ((lo || hi) && Number.isNaN(at)) {
        return false;
      }
      if ((lo && at < Date.parse(lo)) || (hi && at > Date.parse(hi))) {
        return false;
      }
      continue;
    }
    if (spec.kind === 'number') {
      const n = Number(have);
      const r = value as { gt?: number; lt?: number };
      if (isObject(value) ? ((typeof r.gt === 'number' && !(n > r.gt)) || (typeof r.lt === 'number' && !(n < r.lt))) : n !== Number(value)) {
        return false;
      }
      continue;
    }
    if (spec.kind === 'boolean') {
      if (String(have) !== String(value === true || value === 'true')) {
        return false;
      }
      continue;
    }
    const negate = isObject(value) && 'not' in value;
    const raw = negate ? (value as { not: string | string[] }).not : value;
    const wanted = expand((Array.isArray(raw) ? raw : [raw]).map(String), ctx.me).map(w => w.toLowerCase());
    const haves = (Array.isArray(have) ? have : [have]).filter(h => h !== undefined && h !== null).map(h => String(h).toLowerCase());
    const hit = spec.kind === 'enum' || spec.kind === 'list'
      ? haves.some(h => wanted.includes(h))
      : haves.some(h => wanted.some(w => h.includes(w)));
    if (hit === negate) {
      return false;
    }
  }
  return true;
}
