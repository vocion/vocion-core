import type { PreviewDoc } from '@/libs/preview/types';
import type { RecordType } from '@/services/chat/pageContext';
import type { ActionChange } from '@/services/inbox/describeActionRun';
import type { EmailPreviewModel } from '@/services/inbox/emailPreview';
import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
import { looksLikeManualInput } from '@/libs/actions/manual';
import { evidenceRef } from '@/libs/preview/evidenceRef';
import { humaniseField } from '@/services/inbox/describeActionRun';

/**
 * The decision screen's reasoning, as pure functions — what the reviewer is
 * judging, which verb the note field implies, what the header line says
 * versus what the "Why this?" fold holds, and what the context pane lists.
 *
 * Chris, 2026-09-19, on `/dashboard/inbox/r/<record>`: *"actual work to
 * approve is buried in the middle of everything … there may be too much in
 * the head/header as context … no clear way to approve w/ feedback/direction …
 * approve/next shouldn't be in 2 places."* Every one of those is a decision
 * about what goes where, so every one of them lives here rather than inside a
 * component, where it can be asserted without a DOM.
 *
 * No React, no I/O: the record page calls `workCardModel` on the server and
 * the sheet calls `planDecision` on every keystroke.
 */

// ---------------------------------------------------------------------------
// 1. The work — the payload the person is judging, rendered as itself.
// ---------------------------------------------------------------------------

/** One labelled value in a work card: the proposed value, and the current one where the proposer knew it. */
export type WorkField = {
  /** The payload key the edit is written back to. */
  key: string;
  label: string;
  /** What the record says today; absent when the proposer did not supply it. */
  from?: string;
  /** What the agent proposes. */
  to: string;
  /** Render as a textarea rather than an input. */
  multiline?: boolean;
};

/**
 * How one proposed action renders as the thing it is. `email` is a composer;
 * `changes` is a field diff; `fields` is the honest default for everything
 * else — labelled values, never a paragraph of prose about them.
 */
export type WorkCardModel
  = | { shape: 'email'; heading: string; consequence: string; to: string; cc: string | null; subject: string; body: string }
    | { shape: 'changes'; heading: string; consequence: string; fields: WorkField[] }
    | { shape: 'fields'; heading: string; consequence: string; fields: WorkField[] };

/** Payload keys that are plumbing, not the work: never shown, never edited. */
const PLUMBING = new Set(['baseUrl', 'draft', 'objectType', 'objectId', 'previous', 'properties', 'leadBriefId', 'hubspotUserId', 'rawExtractRef']);

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * What approving does, said once, where the verb is — never "are you sure".
 * @param actionId - The registered action id.
 * @param input - The proposed payload.
 * @param actionKind - The describer's two-word name ("CRM update", "Email").
 */
export function consequenceOf(actionId: string, input: Record<string, unknown>, actionKind: string): string {
  if (actionId === 'gmail.send') {
    return input.draft === true ? 'Approving writes a Gmail draft. Nothing is sent.' : 'Approving sends this email.';
  }
  if (actionId === 'hubspot.update') {
    return 'Approving writes these values to the CRM.';
  }
  if (actionId === 'personalization.enroll') {
    return 'Approving enrolls the contact and starts the sequence.';
  }
  if (looksLikeManualInput(input)) {
    return 'Approving releases this to be done by hand. Nothing runs here.';
  }
  return `Approving runs this ${actionKind.toLowerCase()}.`;
}

/**
 * The work card for one proposed action. Email first, because an email is a
 * thing a person already knows how to read; a payload carrying `properties`
 * is a field diff; anything else is its own payload as labelled rows, which
 * beats a sentence describing a payload nobody can see.
 * @param row - The proposal as the record page has it.
 * @param row.actionId
 * @param row.actionKind - From `describeActionRun`.
 * @param row.input - The proposed payload.
 * @param row.changes - The describer's field changes, which carry `from` when the proposer supplied it.
 * @param row.email - The email read off the payload, when the action is one.
 */
export function workCardModel(row: {
  actionId: string;
  actionKind: string;
  input: Record<string, unknown>;
  changes: readonly ActionChange[];
  email: EmailPreviewModel | null;
}): WorkCardModel {
  const consequence = consequenceOf(row.actionId, row.input, row.actionKind);
  if (row.email) {
    return { shape: 'email', heading: row.input.draft === true ? 'Email draft' : 'Email', consequence, to: row.email.to, cc: row.email.cc, subject: row.email.subject, body: row.email.body };
  }
  const properties = row.input.properties && typeof row.input.properties === 'object' && !Array.isArray(row.input.properties)
    ? row.input.properties as Record<string, unknown>
    : null;
  if (properties && Object.keys(properties).length > 0) {
    const priors = new Map(row.changes.filter(c => c.from !== undefined).map(c => [c.field, c.from!] as const));
    return {
      shape: 'changes',
      heading: row.actionKind,
      consequence,
      fields: Object.entries(properties).map(([key, value]) => ({
        key,
        label: humaniseField(key),
        ...(priors.has(key) ? { from: priors.get(key)! } : {}),
        to: text(value),
        multiline: text(value).length > 80,
      })),
    };
  }
  const fields: WorkField[] = Object.entries(row.input)
    .filter(([key, value]) => !PLUMBING.has(key) && value !== null && value !== undefined && text(value) !== '')
    .map(([key, value]) => ({ key, label: humaniseField(key), to: text(value), multiline: text(value).length > 80 }));
  // A payload with nothing showable still gets its changes, so the card is
  // never blank: less evidence makes a smaller card, not an apology.
  const fallback: WorkField[] = row.changes.map(c => ({ key: c.field, label: humaniseField(c.field), ...(c.from !== undefined ? { from: c.from } : {}), to: c.to }));
  return { shape: 'fields', heading: row.actionKind, consequence, fields: fields.length > 0 ? fields : fallback };
}

/**
 * The payload an edited work card approves with, or undefined when nothing was
 * touched. `POST /api/v1/reviews/decide` replaces `input` wholesale, so the
 * whole payload travels with the edits merged in.
 * @param model - Which shape the card rendered as.
 * @param input - The payload as proposed.
 * @param edits - Keys the reviewer changed, by payload key.
 */
export function editedInputFor(model: WorkCardModel, input: Record<string, unknown>, edits: Record<string, string>): Record<string, unknown> | undefined {
  const touched = Object.entries(edits).filter(([, v]) => v !== undefined);
  if (touched.length === 0) {
    return undefined;
  }
  if (model.shape === 'changes') {
    const properties = { ...(input.properties as Record<string, unknown> | undefined ?? {}) };
    for (const [k, v] of touched) {
      properties[k] = v;
    }
    return { ...input, properties };
  }
  return { ...input, ...Object.fromEntries(touched) };
}

/**
 * Whether the card has been edited away from what the agent proposed. An edit
 * back to the original value is not an edit.
 * @param model
 * @param edits
 */
export function hasEdits(model: WorkCardModel, edits: Record<string, string>): boolean {
  const original = (key: string): string | undefined => {
    if (model.shape === 'email') {
      return key === 'to' ? model.to : key === 'subject' ? model.subject : key === 'body' ? model.body : key === 'cc' ? model.cc ?? '' : undefined;
    }
    return model.fields.find(f => f.key === key)?.to;
  };
  return Object.entries(edits).some(([k, v]) => v !== original(k));
}

// ---------------------------------------------------------------------------
// 2. One interaction place — which verbs the bar carries, and what the note
//    field turns them into.
// ---------------------------------------------------------------------------

export type ReviewVerbId = 'approve' | 'reject' | 'send_back';

export type ReviewVerb = {
  id: ReviewVerbId;
  label: string;
  /** The single key that fires it; `send_back` has none — it needs the note. */
  shortcut?: 'a' | 'd';
  tone?: 'ghost' | 'danger';
};

export type ReviewDecisionPlan = {
  primary: ReviewVerb;
  secondary: ReviewVerb[];
  /** The one line under the field saying what the typed text will do. */
  hint: string;
  /** True once the note or an edit is carried by the primary. */
  carriesNote: boolean;
};

/**
 * What the action bar offers, given what is in the note field and whether the
 * work card was edited. This is the missing "approve with feedback/direction"
 * (Chris, 2026-09-19): an empty field leaves plain Approve / Reject; text in
 * it makes the primary **Approve with changes** — which executes with the note
 * attached, and the note queues as feedback the agent learns from
 * (`services/feedback/ruleRecorder`, `source: 'review'`) — and offers **Send
 * back with direction**, which returns it to the agent instead of executing.
 *
 * There is no second note field and no second bar: the field IS the feedback
 * path, and the bar is the only place a decision happens.
 * @param input
 * @param input.note - What is in the field.
 * @param input.edited - Whether the work card differs from what was proposed.
 * @param input.draft - An email proposal that writes a draft rather than sending.
 * @param input.isEmail - Whether the payload is an email, for the plain verb's wording.
 */
export function planDecision(input: { note: string; edited: boolean; draft?: boolean; isEmail?: boolean }): ReviewDecisionPlan {
  const note = input.note.trim();
  const carriesNote = note !== '' || input.edited;
  const plain = input.isEmail ? (input.draft ? 'Approve → draft' : 'Approve & send') : 'Approve';
  const primary: ReviewVerb = { id: 'approve', label: carriesNote ? 'Approve with changes' : plain, shortcut: 'a' };
  const reject: ReviewVerb = { id: 'reject', label: 'Reject', shortcut: 'd', tone: 'danger' };
  const sendBack: ReviewVerb = { id: 'send_back', label: 'Send back with direction' };
  return {
    primary,
    secondary: note !== '' ? [sendBack, reject] : [reject],
    hint: note !== ''
      ? 'Approve with changes executes now and files your note as feedback. Send back returns it to the agent instead.'
      : input.edited
        ? 'Your edits run instead of what was proposed, and the difference teaches the agent.'
        : 'Type direction here to approve with changes, or to send it back to the agent.',
    carriesNote,
  };
}

/**
 * The keyboard legend beside the bar. `j` walks the sheet; the verbs decide it.
 * @param plan
 * @param more
 */
export function decisionLegend(plan: ReviewDecisionPlan, more: boolean): Array<{ key: string; label: string }> {
  const keys: Array<{ key: string; label: string }> = [{ key: 'a', label: plan.primary.label }];
  const reject = plan.secondary.find(v => v.id === 'reject');
  if (reject) {
    keys.push({ key: 'd', label: reject.label });
  }
  if (more) {
    keys.push({ key: 'j', label: 'Next' });
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 3. The header is a line; the context is one click behind it.
// ---------------------------------------------------------------------------

export type WhyFact = { label: string; value: string };

export type ReviewHeadline = {
  title: string;
  /** "Email", "CRM update" — the kind chip. */
  kindLabel: string;
  askedBy: string | null;
  /** 0–1, or null. */
  confidence: number | null;
  /** "Recommendation 1 of 2", or null for a single item. */
  position: string | null;
};

export type ReviewWhy = {
  reason: string | null;
  facts: WhyFact[];
  /** True when the fold holds anything at all. */
  any: boolean;
};

/**
 * Split what the page knows into the line a person reads at a glance and the
 * fold they open when the glance is not enough. Nothing is deleted — that is
 * the whole contract (principle 9: hide complexity, never hide truth).
 * @param input
 * @param input.title
 * @param input.kindLabel
 * @param input.askedBy - The proposing agent's slug.
 * @param input.confidence - 0–1.
 * @param input.index - 0-based position on the sheet.
 * @param input.total - How many open items the sheet holds.
 * @param input.reason - The agent's rationale, in full.
 * @param input.runId - The action run.
 * @param input.waiting - How long it has waited ("3d"), already formatted.
 * @param input.earlierDecisions - How many decisions this record already carries.
 */
export function splitReviewContext(input: {
  title: string;
  kindLabel: string;
  askedBy: string | null;
  confidence: number | null;
  index: number;
  total: number;
  reason: string | null;
  runId: number;
  waiting: string | null;
  earlierDecisions: number;
}): { headline: ReviewHeadline; why: ReviewWhy } {
  const facts: WhyFact[] = [];
  if (input.askedBy) {
    facts.push({ label: 'Recommended by', value: input.askedBy });
  }
  if (input.waiting) {
    facts.push({ label: 'Waiting', value: input.waiting });
  }
  facts.push({ label: 'Run', value: `#${input.runId}` });
  if (input.confidence !== null) {
    facts.push({ label: 'Confidence', value: `${Math.round(input.confidence * 100)}%` });
  }
  if (input.earlierDecisions > 0) {
    facts.push({ label: 'Earlier decisions', value: String(input.earlierDecisions) });
  }
  return {
    headline: {
      title: input.title,
      kindLabel: input.kindLabel,
      askedBy: input.askedBy,
      confidence: input.confidence,
      position: input.total > 1 ? `Recommendation ${input.index + 1} of ${input.total}` : null,
    },
    why: { reason: input.reason, facts, any: true },
  };
}

/**
 * The H1. The list's title has to work with no card beside it, so it spells
 * the whole change out — "Update Northwind Traders — Amount: $36,000 →
 * $48,000, Close date: … +1 more". On the decision sheet the work card renders
 * exactly that, so repeating it in the heading is the "too much in the header"
 * Chris named: the heading's job here is to say WHICH thing this is.
 *
 * An email is identified by its subject; anything else by the record it is
 * about. Neither ever falls through to a bare id — `recordTitle` upstream has
 * already made that decision.
 * @param input - What the row knows.
 * @param input.isEmail - Whether the payload is an email.
 * @param input.subject - The email's subject, when it has one.
 * @param input.recordName - The record the recommendation is about.
 * @param input.title - The list's own title, as the last resort.
 */
export function sheetHeadline(input: { isEmail: boolean; subject?: string | null; recordName?: string | null; title: string }): string {
  if (input.isEmail) {
    return input.subject?.trim() || input.recordName?.trim() || input.title;
  }
  return input.recordName?.trim() || input.title;
}

// ---------------------------------------------------------------------------
// 4. The context pane — rows that preview, not rows that stare.
// ---------------------------------------------------------------------------

export type ContextRowKind = 'crm' | 'thread' | 'sequence' | 'change' | 'evidence';

export type ContextPaneRow = {
  id: string;
  /** The group's eyebrow key: `Contact`, `Threads`, `Sequence`, `Changes`, `Documents`. */
  group: 'Contact' | 'Threads' | 'Sequence' | 'Changes' | 'Documents';
  kind: ContextRowKind;
  title: string;
  subline: string | null;
  /** The right-hand cell: "3d ago · Gmail". */
  meta: string | null;
  /**
   * The preview the pane paints when the row is opened. Absent on a row whose
   * content lives elsewhere — `ref` is resolved by the preview registry then.
   */
  doc?: PreviewDoc;
  ref?: { type: RecordType; id: string };
  /** The words the search box matches on. */
  haystack: string;
};

export type ContextPane = {
  warnings: string[];
  rows: ContextPaneRow[];
  /** What could not be read, per section, in the reader's language. */
  notes: string[];
};

/**
 * Every word the pane puts on screen that is not data. Passed in rather than
 * read here, because this module is pure and `next-intl` is not — and because
 * losing the rail's French was the alternative.
 */
export type ContextPaneLabels = {
  name: string;
  title: string;
  company: string;
  email: string;
  stage: string;
  source: string;
  since: string;
  inbound: string;
  outbound: string;
  when: string;
  system: string;
  sequence: string;
  enrolled: string;
  notEnrolled: string;
  today: string;
  proposed: string;
  /** Section names, for the `notes` lines. */
  contactSection: string;
  threadsSection: string;
  sequenceSection: string;
  /** Section statuses. */
  none: string;
  notConnected: string;
  error: string;
  /**
   * The record's context is read on the server and the read calls out to the
   * CRM, so only the first few recommendations on a sheet get one. Beyond
   * that the pane must say the context was never read rather than render the
   * same empty state as "this contact has nothing" (principle 10).
   */
  notRead: string;
};

/** The English defaults, so a story or a test need not build the whole table. */
export const CONTEXT_PANE_LABELS: ContextPaneLabels = {
  name: 'Name',
  title: 'Title',
  company: 'Company',
  email: 'Email',
  stage: 'Stage',
  source: 'Came in via',
  since: 'In CRM',
  inbound: 'They wrote',
  outbound: 'We wrote',
  when: 'When',
  system: 'System',
  sequence: 'Sequence',
  enrolled: 'Enrolled',
  notEnrolled: 'Not in a sequence',
  today: 'Today',
  proposed: 'Proposed',
  contactSection: 'Contact',
  threadsSection: 'Inbox & outbox',
  sequenceSection: 'Sequence',
  none: 'None found',
  notConnected: 'Not connected',
  error: 'Could not read:',
  notRead: 'Context for this recommendation has not been read yet.',
};

/** The record types `services/preview/descriptors` actually registers a resolver for. */
const PREVIEWABLE = new Set<RecordType>(['document', 'artifact', 'deal', 'object', 'conversation', 'briefing', 'lead', 'page']);

/**
 * Whether the preview registry can resolve this type. A citation pointing at
 * anything else stays a row with no preview rather than a panel saying nothing.
 * @param type - The evidence reference's record type.
 */
function isPreviewable(type: RecordType): boolean {
  return PREVIEWABLE.has(type);
}

/**
 * One section's honest line when it holds nothing — the system's own words for
 * an error, never an empty pane pretending nothing exists (principle 10).
 * @param section - What the section is called.
 * @param status - How the read went.
 * @param message - What the system said, on an error.
 * @param labels - The pane's words.
 */
function sectionNote(section: string, status: string, message: string | undefined, labels: ContextPaneLabels): string {
  const reason = status === 'not-connected' ? labels.notConnected : status === 'error' ? `${labels.error} ${message ?? ''}`.trim() : labels.none;
  return `${section} — ${reason}`;
}

/**
 * Everything the record actually has, as one previewable list. Not only email:
 * the CRM fields, the threads both ways, the sequence state, the changes this
 * recommendation proposes and the documents it cites — each a row that opens
 * in the pane rather than navigating away from the decision.
 * @param input - What the page assembled.
 * @param input.context - The contact context, when the proposal is about an address.
 * @param input.contextRead
 * @param input.changes - The field changes this proposal would write.
 * @param input.evidence - Citations behind the proposal.
 * @param input.agoLabel - How a timestamp reads ("3d ago"); injected so the model stays pure.
 * @param input.labels - The pane's words, translated by the caller.
 */
export function contextPaneRows(input: {
  context?: ReviewContextModel | null;
  /** Whether a context read was even attempted for this recommendation. */
  contextRead?: boolean;
  changes?: readonly ActionChange[];
  evidence?: readonly string[];
  agoLabel: (at: Date) => string;
  labels?: ContextPaneLabels;
}): ContextPane {
  const labels = input.labels ?? CONTEXT_PANE_LABELS;
  const rows: ContextPaneRow[] = [];
  const notes: string[] = [];
  const ctx = input.context ?? null;
  const attempted = input.contextRead ?? true;

  if (ctx?.contact.status === 'ok') {
    const c = ctx.contact.data;
    const facts = [
      { label: labels.name, value: c.name ?? '—' },
      ...(c.jobTitle ? [{ label: labels.title, value: c.jobTitle }] : []),
      ...(c.company ? [{ label: labels.company, value: c.company }] : []),
      { label: labels.email, value: c.email },
      { label: labels.stage, value: c.lifecycleStage ?? '—' },
      { label: labels.source, value: [c.source, c.sourceDetail].filter(Boolean).join(' · ') || '—' },
      ...(c.createdAt ? [{ label: labels.since, value: input.agoLabel(new Date(c.createdAt)) }] : []),
    ];
    rows.push({
      id: 'crm',
      kind: 'crm',
      group: 'Contact',
      title: c.name ?? c.email,
      subline: [c.jobTitle, c.company].filter(Boolean).join(' · ') || c.email,
      meta: c.lifecycleStage,
      doc: {
        ref: { type: 'object', id: `hubspot:contact:${c.hubspotId}` },
        title: c.name ?? c.email,
        sourceLabel: 'HubSpot',
        ...(c.company ? { subtitle: c.company } : {}),
        facts,
        body: facts.map(f => `**${f.label}** — ${f.value}`).join('\n\n'),
        ...(c.href ? { externalHref: c.href } : {}),
      },
      haystack: [c.name, c.email, c.company, c.jobTitle, c.lifecycleStage, c.source].filter(Boolean).join(' ').toLowerCase(),
    });
  } else if (ctx?.email) {
    notes.push(sectionNote(labels.contactSection, ctx.contact.status, ctx.contact.status === 'error' ? ctx.contact.message : undefined, labels));
  }

  if (ctx?.touches.status === 'ok') {
    for (const [i, t] of ctx.touches.data.entries()) {
      const when = t.at ? input.agoLabel(new Date(t.at)) : null;
      const system = t.source === 'hubspot' ? 'HubSpot' : 'Gmail';
      const direction = t.direction === 'in' ? labels.inbound : labels.outbound;
      rows.push({
        id: `thread:${i}`,
        kind: 'thread',
        group: 'Threads',
        title: t.subject || '(no subject)',
        subline: t.snippet || direction,
        meta: [when, system].filter(Boolean).join(' · '),
        doc: {
          ref: { type: 'document', id: `touch:${i}` },
          title: t.subject || '(no subject)',
          sourceLabel: system,
          subtitle: direction,
          facts: [
            ...(when ? [{ label: labels.when, value: when }] : []),
            { label: labels.system, value: system },
          ],
          ...(t.snippet ? { body: t.snippet } : {}),
          ...(t.href ? { href: t.href } : {}),
        },
        haystack: [t.subject, t.snippet, system, direction].filter(Boolean).join(' ').toLowerCase(),
      });
    }
  } else if (ctx?.email) {
    notes.push(sectionNote(labels.threadsSection, ctx.touches.status, ctx.touches.status === 'error' ? ctx.touches.message : undefined, labels));
  }

  if (ctx?.enrollment.status === 'ok') {
    const e = ctx.enrollment.data;
    const state = e.enrolled ? labels.enrolled : labels.notEnrolled;
    const title = e.enrolled && e.sequenceName ? `${state} — ${e.sequenceName}` : state;
    rows.push({
      id: 'sequence',
      kind: 'sequence',
      group: 'Sequence',
      title,
      subline: e.enrolledBy ?? null,
      meta: null,
      doc: {
        ref: { type: 'object', id: 'sequence' },
        title,
        sourceLabel: 'HubSpot',
        facts: [
          { label: labels.sequence, value: e.sequenceName ?? state },
          ...(e.enrolledBy ? [{ label: labels.source, value: e.enrolledBy }] : []),
        ],
        body: title,
      },
      haystack: `${labels.sequence} ${title} ${e.sequenceName ?? ''}`.toLowerCase(),
    });
  } else if (ctx?.email) {
    notes.push(sectionNote(labels.sequenceSection, ctx.enrollment.status, ctx.enrollment.status === 'error' ? ctx.enrollment.message : undefined, labels));
  }

  for (const [i, c] of (input.changes ?? []).entries()) {
    // `humaniseField` is the one namer the rest of the inbox uses; the raw
    // property name is an internal identifier and never reaches the reader.
    const label = humaniseField(c.field);
    const facts = [
      ...(c.from !== undefined ? [{ label: labels.today, value: c.from }] : []),
      { label: labels.proposed, value: c.to },
    ];
    rows.push({
      id: `change:${i}`,
      kind: 'change',
      group: 'Changes',
      title: label,
      subline: c.from !== undefined ? `${c.from} → ${c.to}` : c.to,
      meta: null,
      doc: {
        ref: { type: 'object', id: `change:${i}` },
        title: label,
        sourceLabel: 'Vocion',
        facts,
        body: facts.map(f => `**${f.label}** — ${f.value}`).join('\n\n'),
      },
      haystack: `${label} ${c.from ?? ''} ${c.to}`.toLowerCase(),
    });
  }

  for (const source of input.evidence ?? []) {
    const ref = evidenceRef(source);
    rows.push({
      id: `evidence:${source}`,
      kind: 'evidence',
      group: 'Documents',
      title: ref.label,
      subline: ref.sourceLabel,
      meta: null,
      // No `doc`: an evidence citation IS a record elsewhere, so the preview
      // registry resolves it the way it does on every other surface.
      ...(isPreviewable(ref.ref.type) ? { ref: { type: ref.ref.type, id: ref.ref.id } } : {}),
      haystack: `${ref.label} ${ref.sourceLabel} ${source}`.toLowerCase(),
    });
  }

  // Never let "we did not look" render as "there is nothing here": the
  // server reads context for the first few recommendations only, and the
  // rest must say so rather than share the empty state (principle 10).
  if (!attempted && ctx === null) {
    notes.push(labels.notRead);
  }

  return { warnings: ctx?.warnings ?? [], rows, notes };
}

/**
 * The pane's search box. Matches the row's own words, not the group heading —
 * typing "sequence" should find the sequence row, and it does, because the
 * haystack carries it.
 * @param rows
 * @param query
 */
export function filterContextRows(rows: readonly ContextPaneRow[], query: string): ContextPaneRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [...rows];
  }
  const terms = q.split(/\s+/);
  return rows.filter(r => terms.every(t => r.haystack.includes(t)));
}

/**
 * The pane's rows in their groups, in the order the groups were built.
 * @param rows
 */
export function groupContextRows(rows: readonly ContextPaneRow[]): Array<{ group: string; rows: ContextPaneRow[] }> {
  const groups: Array<{ group: string; rows: ContextPaneRow[] }> = [];
  for (const row of rows) {
    const found = groups.find(g => g.group === row.group);
    if (found) {
      found.rows.push(row);
    } else {
      groups.push({ group: row.group, rows: [row] });
    }
  }
  return groups;
}
