/**
 * FACETS — typed state stamped on an indexed document at sync time, so a
 * question about STATE is one filtered query rather than a hunt for phrases.
 *
 * Why this exists (2026-10-09, trace c126f3ca): "What sales emails do I need
 * to answer" took the RevOps Lead 35 steps and 3m20s. It ran about twenty
 * searches for phrases an owed reply might contain ("unanswered prospect",
 * "client reply awaiting", "thanks for the call", …), consulted a specialist
 * that ran thirteen more, and still had to read threads one by one to find
 * out who wrote last. The index held CONTENT; the question was about STATE
 * (who is waiting on whom), and no phrase search can see state. So state is
 * worked out once, when a thread is synced, and written beside the content:
 *
 *   knowledge_document.metadata.facets = { reply_state: 'needs_my_reply', … }
 *
 * and a search can filter on it, ranking only within the matching documents.
 *
 * One mechanism for every source. A connector declares the facets it writes
 * here (`FACET_SETS`), with their values and what they mean; the search tool
 * reads the declarations to tell the model which facets it can filter on, and
 * `facetWhere` turns a filter into SQL. Gmail threads are the first; deals,
 * tasks and asks add a set here when they carry state worth asking about.
 *
 * Facets live inside `metadata` rather than in a column of their own: the
 * metadata is already written, refreshed on unchanged content and read back
 * with every hit, and a facet filter runs inside one source's documents,
 * which the (org, source, external id) index already narrows.
 */
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/** A value a facet may hold. Dates are ISO strings. */
export type FacetValue = string | number | boolean | null;

/** What a facet holds, which decides how a filter on it matches. */
export type FacetKind
  /** One of `values`; a filter matches exactly, or any of a list. */
  = | 'enum'
  /** Free text (a name, an address); a filter matches case-insensitively as a substring. */
    | 'text'
  /** An ISO timestamp; a filter is a lower bound (`{ since }`) or an upper one (`{ until }`). */
    | 'date'
  /** true / false. */
    | 'boolean';

export type FacetSpec = {
  name: string;
  kind: FacetKind;
  /** The allowed values, for an `enum`. */
  values?: readonly string[];
  /** What it means, in the words the model reads. */
  description: string;
};

export type FacetSet = {
  /** The connector that writes these (`knowledge_source` config `_connector`). */
  connector: string;
  /** The `metadata.kind` of the documents that carry them. */
  documentKind: string;
  /** What one such document is, for the tool description ("email thread"). */
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

/**
 * Every declared facet set. Add one here when a source carries state a person
 * asks about; nothing else needs to change for the search tool to offer it.
 */
export const FACET_SETS: readonly FacetSet[] = [
  {
    connector: 'gmail',
    documentKind: MAIL_THREAD_STATE_KIND,
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
    ],
  },
];

/** A filter as the model writes it: a value, a list of values, or a date bound. */
export type FacetFilterValue = string | number | boolean | string[] | { since?: string; until?: string };
export type FacetFilter = Record<string, FacetFilterValue>;

/**
 * The facet sets offered for a set of connected sources.
 * @param connectors - The connector kinds behind the agent's sources.
 */
export function facetSetsFor(connectors: Iterable<string>): FacetSet[] {
  const have = new Set(connectors);
  return FACET_SETS.filter(s => have.has(s.connector));
}

/** Every facet any set declares, by name; the first declaration of a name wins. */
function specsByName(): Map<string, FacetSpec> {
  const out = new Map<string, FacetSpec>();
  for (const set of FACET_SETS) {
    for (const f of set.facets) {
      if (!out.has(f.name)) {
        out.set(f.name, f);
      }
    }
  }
  return out;
}

/**
 * The lines the search tool's description carries, so the model knows what it
 * can filter on and when to. Empty when no connected source writes facets.
 * @param connectors - The connector kinds behind the agent's sources.
 */
export function describeFacets(connectors: Iterable<string>): string {
  const sets = facetSetsFor(connectors);
  if (sets.length === 0) {
    return '';
  }
  const lines = sets.map((s) => {
    const fields = s.facets.map(f => `${f.name}${f.values ? ` (${f.values.join(' | ')})` : ` (${f.kind})`}: ${f.description}`).join('; ');
    return `${s.noun}s from ${s.connector} carry facets — ${fields}.`;
  });
  return [
    'STATE IS A FILTER, NOT A PHRASE: when the question is about state — who owes whom a reply, what is waiting, what is overdue — pass `facets` and ONE plain query for the topic instead of guessing phrases the documents might contain. Example: "what sales emails do I need to answer" is facets {"reply_state": "needs_my_reply", "category": "sales"} with query "sales". Dates take {"since": "<ISO>"}.',
    ...lines,
  ].join(' ');
}

export type FacetFilterError = { facet: string; message: string };

/**
 * Check a filter against the declarations: unknown facets and values outside
 * an enum are refused with the allowed ones named, so the model can correct
 * itself in one step rather than reading an empty result as "nothing there".
 * @param filter - The filter as the model wrote it.
 */
export function validateFacetFilter(filter: FacetFilter): FacetFilterError[] {
  const specs = specsByName();
  const errors: FacetFilterError[] = [];
  for (const [name, value] of Object.entries(filter)) {
    const spec = specs.get(name);
    if (!spec) {
      errors.push({ facet: name, message: `unknown facet "${name}"; known: ${[...specs.keys()].join(', ')}` });
      continue;
    }
    if (spec.kind === 'enum' && spec.values) {
      const wanted = Array.isArray(value) ? value : [value];
      const bad = wanted.filter(v => !spec.values!.includes(String(v)));
      if (bad.length > 0) {
        errors.push({ facet: name, message: `"${bad.join('", "')}" is not a ${name}; use one of ${spec.values.join(', ')}` });
      }
    }
    if (spec.kind === 'date' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push({ facet: name, message: `${name} takes {"since": "<ISO date>"} and/or {"until": "<ISO date>"}` });
    }
  }
  return errors;
}

/**
 * The SQL condition a filter adds, on a document's metadata column (the
 * alias `d` by default). Null for an empty filter. Only declared facets reach
 * here (`validateFacetFilter` first); every value is a bound parameter.
 * @param filter - A validated filter.
 * @param metadata - The metadata column to read, e.g. `sql\`${knowledgeDocumentSchema.metadata}\``.
 */
export function facetWhere(filter: FacetFilter | undefined, metadata: SQL = sql`d.metadata`): SQL | null {
  if (!filter) {
    return null;
  }
  const specs = specsByName();
  const conds: SQL[] = [];
  for (const [name, value] of Object.entries(filter)) {
    const spec = specs.get(name);
    if (!spec) {
      continue;
    }
    const field = sql`(${metadata} -> 'facets' ->> ${name})`;
    if (spec.kind === 'date') {
      const bound = value as { since?: string; until?: string };
      if (bound.since && !Number.isNaN(Date.parse(bound.since))) {
        conds.push(sql`${field} >= ${new Date(bound.since).toISOString()}`);
      }
      if (bound.until && !Number.isNaN(Date.parse(bound.until))) {
        conds.push(sql`${field} <= ${new Date(bound.until).toISOString()}`);
      }
      continue;
    }
    const wanted = (Array.isArray(value) ? value : [value]).map(String);
    if (wanted.length === 0) {
      continue;
    }
    if (spec.kind === 'text') {
      conds.push(sql`(${sql.join(wanted.map(w => sql`${field} ILIKE ${`%${w.replace(/[%_\\]/g, m => `\\${m}`)}%`}`), sql` OR `)})`);
    } else {
      conds.push(sql`${field} IN (${sql.join(wanted.map(w => sql`${w}`), sql`, `)})`);
    }
  }
  return conds.length > 0 ? sql.join(conds, sql` AND `) : null;
}

/**
 * Whether a document's own facets satisfy a filter. The same rules as
 * `facetWhere`, in memory: for a caller holding documents already, and the
 * one place the two can be tested against each other.
 * @param facets - A document's `metadata.facets`.
 * @param filter - A validated filter.
 */
export function facetsMatch(facets: Record<string, FacetValue> | undefined, filter: FacetFilter | undefined): boolean {
  if (!filter) {
    return true;
  }
  const specs = specsByName();
  for (const [name, value] of Object.entries(filter)) {
    const spec = specs.get(name);
    if (!spec) {
      continue;
    }
    const have = facets?.[name];
    if (spec.kind === 'date') {
      const bound = value as { since?: string; until?: string };
      const at = typeof have === 'string' ? Date.parse(have) : Number.NaN;
      if ((bound.since || bound.until) && Number.isNaN(at)) {
        return false;
      }
      if (bound.since && at < Date.parse(bound.since)) {
        return false;
      }
      if (bound.until && at > Date.parse(bound.until)) {
        return false;
      }
      continue;
    }
    const wanted = (Array.isArray(value) ? value : [value]).map(String);
    if (spec.kind === 'text') {
      const h = String(have ?? '').toLowerCase();
      if (!wanted.some(w => h.includes(w.toLowerCase()))) {
        return false;
      }
    } else if (!wanted.includes(String(have))) {
      return false;
    }
  }
  return true;
}
