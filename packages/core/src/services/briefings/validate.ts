/**
 * The validator — where every content rule in `docs/specs/briefing-v2.md`
 * stops being a request and becomes a refusal.
 *
 * Nothing here asks a model to behave. A document that breaks a rule does not
 * get published: `publish_briefing` runs `assertBriefingV2` and returns the
 * issues to the agent, and the composer runs `enforceBriefing` so a document
 * it builds is in budget before it is ever stored.
 *
 * The rules, and where each one comes from:
 *
 *   §1  a section with nothing in it is absent      — `stripEmptySections`
 *   §2  ≤3 cards need you, 4th+ only as an incident — `budget.capDecisions`
 *   §3  no coloured on-track without a judgeable measure — `onTrack`
 *   §5  no delta without a prior value              — `deltas.joinDeltas`
 *   §7  no system vocabulary in the narrative       — `redact`
 *   §10 history shows the last 3–5                  — `budget.capHistory`
 *   Content rules: ≤5 `today` metrics, ≤5 items above the fold, every card
 *   answers why-now.
 */

import type { BriefingSection, BriefingV2 } from './document';
import type { RedactionVocabulary } from './redact';
import { capDecisions, capHistory, capMetrics, firstScreen, MAX_ABOVE_FOLD_ITEMS, MAX_DECISIONS, MAX_HISTORY_ENTRIES, MAX_TODAY_METRICS } from './budget';
import { BRIEFING_SECTIONS, BriefingV2Schema, hasContent, NARRATIVE_SECTIONS } from './document';
import { isJudgeable } from './onTrack';
import { redactSystemVocabulary } from './redact';

export type BriefingIssue = {
  section: BriefingSection | 'document';
  rule: string;
  message: string;
};

export class BriefingContractError extends Error {
  readonly issues: BriefingIssue[];
  constructor(issues: BriefingIssue[]) {
    super(`Briefing contract violated: ${issues.map(i => `${i.section}/${i.rule} — ${i.message}`).join('; ')}`);
    this.name = 'BriefingContractError';
    this.issues = issues;
  }
}

/**
 * Every string in the document a person reads as prose, by section.
 * @param doc - The document.
 */
function narrativeStrings(doc: BriefingV2): { section: BriefingSection; text: string }[] {
  const out: { section: BriefingSection; text: string }[] = [];
  const push = (section: BriefingSection, text?: string | null) => {
    if (text && text.trim()) {
      out.push({ section, text });
    }
  };
  push('today', doc.today?.summary);
  push('today', doc.today?.onTrack?.note);
  for (const m of doc.today?.metrics ?? []) {
    push('today', m.label);
    push('today', m.unavailable?.headline);
  }
  for (const d of doc.decisions?.judgment ?? []) {
    push('decisions', d.title);
    push('decisions', d.whyNow);
    push('decisions', d.incidentReason);
    push('decisions', d.owner);
  }
  for (const c of doc.changes?.items ?? []) {
    push('changes', c.label);
    push('changes', c.narrative);
  }
  for (const c of doc.criticalPath?.items ?? []) {
    push('criticalPath', c.label);
    push('criticalPath', c.status);
    push('criticalPath', c.owner);
  }
  for (const e of doc.exceptions?.items ?? []) {
    push('exceptions', e.label);
    push('exceptions', e.why);
    push('exceptions', e.owner);
  }
  for (const t of doc.detail?.tables ?? []) {
    push('detail', t.title);
    push('detail', t.note);
    for (const col of t.columns) {
      push('detail', col);
    }
    for (const row of t.rows) {
      for (const cell of row) {
        push('detail', cell);
      }
    }
  }
  return out;
}

/**
 * Every rule, checked. Returns the issues rather than throwing so a caller
 * can report all of them at once.
 * @param input - A document, parsed or raw.
 * @param vocab - The workspace's agent slugs, job names and tool names.
 */
export function validateBriefingV2(input: unknown, vocab: RedactionVocabulary = {}): { ok: boolean; doc: BriefingV2 | null; issues: BriefingIssue[] } {
  const parsed = BriefingV2Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      doc: null,
      issues: parsed.error.issues.map(i => ({
        section: (BRIEFING_SECTIONS as readonly string[]).includes(String(i.path[0])) ? i.path[0] as BriefingSection : 'document',
        rule: 'schema',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      })),
    };
  }
  const doc = parsed.data;
  const issues: BriefingIssue[] = [];

  // §1 — no empty sections. A present-but-empty section is a defect, not a state.
  for (const section of BRIEFING_SECTIONS) {
    if (doc[section] !== undefined && !hasContent(doc, section)) {
      issues.push({ section, rule: 'no-empty-sections', message: 'section is present but carries nothing; omit it instead of rendering an empty state' });
    }
  }

  // Content rule — ≤5 metrics.
  if ((doc.today?.metrics.length ?? 0) > MAX_TODAY_METRICS) {
    issues.push({ section: 'today', rule: 'metric-budget', message: `${doc.today!.metrics.length} metrics; the budget is ${MAX_TODAY_METRICS}` });
  }

  // §5 — a delta only where a previous value exists.
  for (const m of doc.today?.metrics ?? []) {
    if (m.previous === undefined && (m.delta !== undefined || m.direction !== undefined)) {
      issues.push({ section: 'today', rule: 'no-fabricated-delta', message: `metric "${m.key}" carries a delta with no previous value` });
    }
    if (m.value === null && !m.unavailable) {
      issues.push({ section: 'today', rule: 'no-silent-null', message: `metric "${m.key}" has no value and no reason; a missing number renders as a state, never as a blank` });
    }
  }

  // §2 — the attention budget, and why-now on every card.
  const cards = doc.decisions?.judgment ?? [];
  const nonIncidentBeyondBudget = cards.slice(MAX_DECISIONS).filter(c => !c.incident);
  if (nonIncidentBeyondBudget.length > 0) {
    issues.push({ section: 'decisions', rule: 'decision-budget', message: `${cards.length} cards need you; past ${MAX_DECISIONS} a card must be marked incident (${nonIncidentBeyondBudget.map(c => c.key).join(', ')})` });
  }
  for (const c of cards) {
    if (!c.whyNow.trim()) {
      issues.push({ section: 'decisions', rule: 'why-now-required', message: `card "${c.key}" has no whyNow` });
    }
    if (c.incident && !c.incidentReason?.trim()) {
      issues.push({ section: 'decisions', rule: 'incident-reason-required', message: `card "${c.key}" is marked incident but says nothing about why` });
    }
  }

  // Content rule — ~5 major items above the fold, incidents excepted. The
  // split is `firstScreen`'s, so this asserts the one definition rather than
  // inventing a second one.
  const screen = firstScreen(doc);
  const budgeted = screen.decisions.length - screen.overBudget.length + screen.changes.length;
  if (budgeted > MAX_ABOVE_FOLD_ITEMS) {
    issues.push({ section: 'document', rule: 'above-the-fold-budget', message: `${screen.decisions.length} decisions + ${screen.changes.length} changes exceeds the ${MAX_ABOVE_FOLD_ITEMS}-item budget` });
  }

  // §3 — a coloured status needs a measure the system can see.
  const onTrack = doc.today?.onTrack;
  if (onTrack && onTrack.status !== 'not-enough-evidence') {
    const judgeable = (doc.today?.metrics ?? []).filter(isJudgeable);
    if (judgeable.length === 0) {
      issues.push({ section: 'today', rule: 'on-track-needs-evidence', message: `status "${onTrack.status}" with no verified or observed measure carrying a target` });
    }
    const basisMissing = onTrack.basis.filter(k => !judgeable.some(m => m.key === k));
    if (basisMissing.length > 0) {
      issues.push({ section: 'today', rule: 'on-track-needs-evidence', message: `basis names ${basisMissing.join(', ')}, which no judgeable measure backs` });
    }
  }

  // §7–§9 — system vocabulary only in agentActivity and provenance.
  for (const { section, text } of narrativeStrings(doc)) {
    if (!NARRATIVE_SECTIONS.includes(section)) {
      continue;
    }
    const { footnotes } = redactSystemVocabulary(text, vocab);
    if (footnotes.length > 0) {
      issues.push({ section, rule: 'no-system-vocabulary', message: `"${footnotes.map(f => f.token).join('", "')}" belongs behind agent activity or sources, not in the briefing` });
    }
  }

  // §8 — agent activity only when something mattered.
  if (doc.agentActivity && doc.agentActivity.reasons.length === 0) {
    issues.push({ section: 'agentActivity', rule: 'only-when-it-matters', message: 'agent activity with no reason; a roster of zeroes is not briefing content' });
  }

  // §10 — history is a preview, not an archive.
  if ((doc.history?.entries.length ?? 0) > MAX_HISTORY_ENTRIES) {
    issues.push({ section: 'history', rule: 'history-budget', message: `${doc.history!.entries.length} entries; show at most ${MAX_HISTORY_ENTRIES} and link to the archive` });
  }

  return { ok: issues.length === 0, doc, issues };
}

/**
 * Parse and validate, or throw.
 * @param input - A document.
 * @param vocab - The workspace's own vocabulary.
 */
export function assertBriefingV2(input: unknown, vocab: RedactionVocabulary = {}): BriefingV2 {
  const { ok, doc, issues } = validateBriefingV2(input, vocab);
  if (!ok || !doc) {
    throw new BriefingContractError(issues);
  }
  return doc;
}

/**
 * Drop sections that carry nothing. The renderer never needs this — it asks
 * `hasContent` — but a stored document should not keep husks around for the
 * next reader to interpret.
 * @param doc - The document.
 */
export function stripEmptySections(doc: BriefingV2): BriefingV2 {
  const out = { ...doc };
  for (const section of BRIEFING_SECTIONS) {
    if (out[section] !== undefined && !hasContent(out, section)) {
      delete out[section];
    }
  }
  return out;
}

/**
 * Make a document obey the contract instead of complaining that it does not:
 * trim to every budget, redact the narrative, drop empty sections. What the
 * composer runs, and the last thing `publish_briefing` does before it stores
 * a model-built document.
 *
 * The one thing it will NOT fix is a missing `whyNow` — inventing a reason a
 * decision matters is exactly the dishonesty the rule exists to prevent, so
 * that card is dropped and the caller is told.
 * @param doc - The document.
 * @param vocab - The workspace's own vocabulary.
 */
export function enforceBriefing(doc: BriefingV2, vocab: RedactionVocabulary = {}): { doc: BriefingV2; dropped: BriefingIssue[] } {
  const dropped: BriefingIssue[] = [];
  const out: BriefingV2 = { ...doc };

  if (out.today) {
    const before = out.today.metrics.length;
    const metrics = capMetrics(out.today.metrics);
    if (metrics.length < before) {
      dropped.push({ section: 'today', rule: 'metric-budget', message: `dropped ${before - metrics.length} metric(s) past the budget of ${MAX_TODAY_METRICS}` });
    }
    out.today = { ...out.today, metrics };
  }

  if (out.decisions) {
    const withWhy = out.decisions.judgment.filter((c) => {
      if (c.whyNow.trim()) {
        return true;
      }
      dropped.push({ section: 'decisions', rule: 'why-now-required', message: `card "${c.key}" dropped: no whyNow, and one is never invented` });
      return false;
    });
    const capped = capDecisions(withWhy);
    for (const c of capped.dropped) {
      dropped.push({ section: 'decisions', rule: 'decision-budget', message: `card "${c.key}" moved to the queue: past ${MAX_DECISIONS} and not an incident` });
    }
    const background = out.decisions.queued.background + capped.dropped.length;
    out.decisions = { ...out.decisions, judgment: capped.shown, queued: { ...out.decisions.queued, background } };
  }

  if (out.history) {
    out.history = { ...out.history, entries: capHistory(out.history.entries) };
  }

  // The narrative, cleaned. Footnotes accumulate into provenance so the token
  // itself is still readable — one number sequence across the whole document.
  const footnotes = [...(out.provenance?.footnotes ?? [])];
  let marker = footnotes.reduce((n, f) => Math.max(n, f.marker), 0) + 1;
  const clean = (text: string): string => {
    const res = redactSystemVocabulary(text, vocab, marker);
    if (res.footnotes.length === 0) {
      return text;
    }
    marker += res.footnotes.length;
    footnotes.push(...res.footnotes);
    return res.text;
  };

  if (out.today?.summary) {
    out.today = { ...out.today, summary: clean(out.today.summary) };
  }
  if (out.decisions) {
    out.decisions = { ...out.decisions, judgment: out.decisions.judgment.map(c => ({ ...c, whyNow: clean(c.whyNow), title: clean(c.title) })) };
  }
  if (out.changes) {
    out.changes = { items: out.changes.items.map(c => (c.narrative ? { ...c, narrative: clean(c.narrative) } : c)) };
  }
  if (out.exceptions) {
    out.exceptions = { items: out.exceptions.items.map(e => ({ ...e, why: clean(e.why), label: clean(e.label) })) };
  }

  if (footnotes.length > 0) {
    out.provenance = { sources: out.provenance?.sources ?? [], footnotes, ...(out.provenance?.runs ? { runs: out.provenance.runs } : {}) };
  }

  return { doc: stripEmptySections(out), dropped };
}
