/**
 * A proposed action, described the way a person would say it.
 *
 * The review queue stored `Action · hubspot.update` as a title, so 213 items
 * rendered as 213 identical rows. The payload knows better: which deal, which
 * contact, what changes, which agent proposed it, how sure it was. This module
 * reads that out — pure functions over the row, no I/O — so the inbox row,
 * the decision sheet and the tests all agree on what an item IS.
 *
 * Every action id gets a describer; anything unknown falls back to the
 * proposal's rationale, then to the action id spelled out.
 */

export type ActionRunLike = {
  id: number;
  actionId: string;
  input: Record<string, unknown> | null;
  proposal: {
    confidence?: number;
    rationale?: string;
    evidence?: string[];
    agentSlug?: string;
    suggestedDecision?: unknown;
    [key: string]: unknown;
  } | null;
  invokedBy: string | null;
};

/** The record a proposal is about — the grouping key for a decision sheet. */
export type RecordRef = {
  /** `deal` | `contact` | `company` | `email` | `other` */
  kind: 'deal' | 'contact' | 'company' | 'email' | 'other';
  /** Stable key, e.g. `hubspot:deals:1234`, `email:jane@acme.com`. */
  key: string;
  /** How the record is named to a person. */
  name: string;
  /**
   * How the record reads when only its id is known — `Deal 1234`. Kept even
   * once `name` is a real name, so the id stays available on hover and in
   * the detail instead of being the label (Chris, 2026-09-16: "I should be
   * able to see the name of this deal").
   */
  idLabel?: string;
  /**
   * True while `name` is still the id spelled out — the payload carried no
   * name and nothing has resolved one yet. `services/records/recordLabel`
   * clears it from the CRM mirror; what is still set after that genuinely
   * has no name we can show, and says so rather than pretending.
   */
  fromId?: boolean;
};

/**
 * The record as a row title: its name, or the id plus the reason there is no
 * name. Never the bare id pretending to be a name.
 * @param record
 */
export function recordTitle(record: RecordRef): string {
  return record.fromId && record.idLabel ? `${record.idLabel} (name not synced)` : record.name;
}

export type ActionChange = { field: string; from?: string; to: string };

/** Everything a describer may know that is not on the run itself. */
export type DescribeOptions = {
  /**
   * Record key → the name the workspace knows that record by, from the CRM
   * mirror (`services/records/recordLabel`). Only ever overrides a name the
   * describer had to derive from an id: what the proposer actually wrote
   * stays, because that is what it proposed.
   */
  recordNames?: ReadonlyMap<string, string>;
};

export type ActionDescription = {
  title: string;
  /** "<Record> › <action kind> › proposed by <agent>" */
  subline: string;
  /** What the action is, in two words: "CRM update", "Enrollment", "Email". */
  actionKind: string;
  record: RecordRef | null;
  changes: ActionChange[];
  /** Money on the payload, when there is any (a deal amount). */
  amount: number | null;
  currency: string | null;
  /** 0–1, from the proposal. */
  confidence: number | null;
  agentSlug: string | null;
  rationale: string | null;
  evidence: string[];
};

/** How each HubSpot object type reads when only its id is known. */
const HUBSPOT_ID_LABEL: Record<string, string> = { deals: 'Deal', contacts: 'Contact', companies: 'Company' };

const HUBSPOT_OBJECT_KIND: Record<string, RecordRef['kind']> = {
  deals: 'deal',
  contacts: 'contact',
  companies: 'company',
};

/**
 * `hs_next_step` → `Next step`, `dealstage` → `Deal stage`. Good enough for a
 * row; the card keeps the raw property name.
 * @param field
 */
export function humaniseField(field: string): string {
  const known: Record<string, string> = {
    dealstage: 'Deal stage',
    dealname: 'Deal name',
    hs_next_step: 'Next step',
    closedate: 'Close date',
    amount: 'Amount',
    hubspot_owner_id: 'Owner',
    lifecyclestage: 'Lifecycle stage',
    hs_lead_status: 'Lead status',
  };
  if (known[field]) {
    return known[field];
  }
  const words = field.replace(/^hs_/, '').replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A value as it reads on a row: numbers and booleans spelled, nulls as "—",
 * long strings cut.
 * @param value
 */
export function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const s = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/**
 * The first sentence of a paragraph, for a fallback title.
 * @param text
 */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const s = (m?.[1] ?? trimmed).trim();
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/**
 * `hubspot.update` → `HubSpot update`, `personalization.enroll` → `Personalization enroll`.
 * @param actionId
 */
export function humaniseActionId(actionId: string): string {
  const [system, verb] = actionId.split('.');
  const sys = system === 'hubspot' ? 'HubSpot' : system === 'gmail' ? 'Gmail' : (system ?? actionId).charAt(0).toUpperCase() + (system ?? actionId).slice(1);
  return verb ? `${sys} ${verb.replaceAll('_', ' ')}` : sys;
}

/**
 * Which agent's judgement this is: the proposal says so when it can; else an
 * `agent:<slug>` invoker; else nothing (a token or a person proposed it).
 * @param run
 */
export function agentOf(run: Pick<ActionRunLike, 'proposal' | 'invokedBy'>): string | null {
  const fromProposal = run.proposal?.agentSlug;
  if (typeof fromProposal === 'string' && fromProposal) {
    return fromProposal;
  }
  if (run.invokedBy?.startsWith('agent:')) {
    return run.invokedBy.slice('agent:'.length) || null;
  }
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * The record name for a HubSpot update, from what the payload carries: a deal
 * name, a contact's name or email, a company name; else the id.
 * @param objectType
 * @param objectId
 * @param properties
 * @param before - Prior values, when the proposer supplied them.
 */
function hubspotRecordName(objectType: string, objectId: string, properties: Record<string, unknown>, before: Record<string, unknown>): { name: string; idLabel: string; fromId: boolean } {
  const pick = (...keys: string[]) => keys.map(k => str(properties[k]) ?? str(before[k])).find(Boolean) ?? null;
  const idLabel = HUBSPOT_ID_LABEL[objectType] ? `${HUBSPOT_ID_LABEL[objectType]} ${objectId}` : `${objectType} ${objectId}`;
  const found = objectType === 'deals'
    ? pick('dealname')
    : objectType === 'contacts'
      ? ([pick('firstname'), pick('lastname')].filter(Boolean).join(' ') || pick('email'))
      : objectType === 'companies'
        ? pick('name', 'domain')
        : null;
  return found ? { name: found, idLabel, fromId: false } : { name: idLabel, idLabel, fromId: true };
}

/** Fields that name the record rather than change it — not listed as changes. */
const HUBSPOT_IDENTITY_FIELDS = new Set(['dealname', 'firstname', 'lastname', 'email', 'name', 'domain']);

function describeHubspotUpdate(run: ActionRunLike, opts?: DescribeOptions): ActionDescription {
  const input = rec(run.input);
  const objectType = str(input.objectType) ?? 'records';
  const objectId = str(input.objectId) ?? '?';
  const properties = rec(input.properties);
  // Prior values are not part of the action's schema; a proposer that knows
  // them may put them on the proposal (`before`) or the input (`previous`).
  const before = { ...rec(input.previous), ...rec(run.proposal?.before) };
  const named = hubspotRecordName(objectType, objectId, properties, before);
  const key = `hubspot:${objectType}:${objectId}`;
  const resolved = named.fromId ? opts?.recordNames?.get(key) : undefined;
  const name = resolved ?? named.name;
  const fromId = named.fromId && resolved === undefined;
  const changes: ActionChange[] = Object.entries(properties)
    .filter(([field]) => !(HUBSPOT_IDENTITY_FIELDS.has(field) && Object.keys(properties).length > 1))
    .map(([field, to]) => ({ field, to: valueLabel(to), ...(field in before ? { from: valueLabel(before[field]) } : {}) }));
  // Money reads as money on the row; everything else as the CRM has it.
  const shown = (c: ActionChange, v: string) => (c.field === 'amount' && num(v) !== null ? amountLabel(num(v), str(properties.deal_currency_code) ?? 'USD') : v);
  const changeText = changes
    .slice(0, 3)
    .map(c => `${humaniseField(c.field)}: ${c.from !== undefined ? `${shown(c, c.from)} → ` : ''}${shown(c, c.to)}`)
    .join(', ');
  const more = changes.length > 3 ? ` +${changes.length - 3} more` : '';
  const agentSlug = agentOf(run);
  const kind = HUBSPOT_OBJECT_KIND[objectType] ?? 'other';
  const amount = num(properties.amount) ?? num(before.amount);
  return {
    title: changeText ? `Update ${name} — ${changeText}${more}` : `Update ${name}`,
    subline: ['CRM update', agentSlug ? `proposed by ${agentSlug}` : null].filter(Boolean).join(' › '),
    actionKind: 'CRM update',
    record: { kind, key, name, idLabel: named.idLabel, fromId },
    changes,
    amount,
    currency: amount === null ? null : str(properties.deal_currency_code) ?? 'USD',
    confidence: num(run.proposal?.confidence),
    agentSlug,
    rationale: str(run.proposal?.rationale),
    evidence: Array.isArray(run.proposal?.evidence) ? run.proposal.evidence.filter((e): e is string => typeof e === 'string') : [],
  };
}

function describeEnroll(run: ActionRunLike, opts?: DescribeOptions): ActionDescription {
  const input = rec(run.input);
  const contact = str(input.contactName) ?? str(input.contactRef) ?? 'a contact';
  const company = str(input.companyName);
  const sequence = str(input.sequenceName) ?? str(input.sequenceId) ?? 'a sequence';
  const contactRef = str(input.contactRef);
  const key = contactRef ? `hubspot:${contactRef.includes(':') ? contactRef : `contacts:${contactRef}`}` : `enroll:${run.id}`;
  const agentSlug = agentOf(run);
  const name = company ? `${contact} (${company})` : contact;
  // Only a ref was given: `contacts:9412` is an id, not a name.
  const idOnly = !str(input.contactName) && contactRef !== null && contact === contactRef;
  const idLabel = idOnly ? `Contact ${contactRef!.split(':').at(-1)}` : undefined;
  const resolved = idOnly ? opts?.recordNames?.get(key) : undefined;
  const shown = resolved ?? (idOnly ? idLabel! : name);
  const fromId = idOnly && resolved === undefined;
  return {
    title: `Enroll ${shown} in ${sequence}`,
    subline: ['Enrollment', agentSlug ? `proposed by ${agentSlug}` : null].filter(Boolean).join(' › '),
    actionKind: 'Enrollment',
    record: { kind: 'contact', key, name: shown, ...(idOnly ? { idLabel, fromId } : {}) },
    changes: [{ field: 'sequence', to: sequence }],
    amount: null,
    currency: null,
    confidence: num(run.proposal?.confidence),
    agentSlug,
    rationale: str(run.proposal?.rationale),
    evidence: Array.isArray(run.proposal?.evidence) ? run.proposal.evidence.filter((e): e is string => typeof e === 'string') : [],
  };
}

function describeGmailSend(run: ActionRunLike): ActionDescription {
  const input = rec(run.input);
  const to = str(input.to) ?? 'someone';
  const subject = str(input.subject);
  const draft = input.draft === true;
  const agentSlug = agentOf(run);
  return {
    title: `${draft ? 'Draft email to' : 'Email'} ${to}${subject ? ` — ${subject}` : ''}`,
    subline: [draft ? 'Email draft' : 'Email', agentSlug ? `proposed by ${agentSlug}` : null].filter(Boolean).join(' › '),
    actionKind: 'Email',
    record: { kind: 'email', key: `email:${to.toLowerCase()}`, name: to },
    changes: subject ? [{ field: 'subject', to: subject }] : [],
    amount: null,
    currency: null,
    confidence: num(run.proposal?.confidence),
    agentSlug,
    rationale: str(run.proposal?.rationale),
    evidence: Array.isArray(run.proposal?.evidence) ? run.proposal.evidence.filter((e): e is string => typeof e === 'string') : [],
  };
}

function describeFallback(run: ActionRunLike): ActionDescription {
  const rationale = str(run.proposal?.rationale);
  const agentSlug = agentOf(run);
  const actionKind = humaniseActionId(run.actionId);
  return {
    title: rationale ? firstSentence(rationale) : actionKind,
    subline: [actionKind, agentSlug ? `proposed by ${agentSlug}` : null].filter(Boolean).join(' › '),
    actionKind,
    record: null,
    changes: [],
    amount: num(rec(run.input).amount),
    currency: null,
    confidence: num(run.proposal?.confidence),
    agentSlug,
    rationale,
    evidence: Array.isArray(run.proposal?.evidence) ? run.proposal.evidence.filter((e): e is string => typeof e === 'string') : [],
  };
}

const DESCRIBERS: Record<string, (run: ActionRunLike, opts?: DescribeOptions) => ActionDescription> = {
  'hubspot.update': describeHubspotUpdate,
  'personalization.enroll': describeEnroll,
  'gmail.send': describeGmailSend,
};

/**
 * Describe one proposed action for a person. Never throws on a malformed
 * payload — a row that cannot be read still needs a row.
 * @param run
 * @param opts - Names the workspace knows that the payload did not carry.
 */
export function describeActionRun(run: ActionRunLike, opts?: DescribeOptions): ActionDescription {
  const describer = DESCRIBERS[run.actionId] ?? describeFallback;
  try {
    return describer(run, opts);
  } catch {
    return describeFallback(run);
  }
}

/**
 * Money on a row: `$12,500`, or `—`.
 * @param amount
 * @param currency
 */
export function amountLabel(amount: number | null, currency: string | null): string {
  if (amount === null) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-US')} ${currency ?? ''}`.trim();
  }
}

/**
 * `0.87` → `87%`, `null` → `—`.
 * @param confidence
 */
export function confidenceLabel(confidence: number | null): string {
  return confidence === null ? '—' : `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}
