/**
 * The briefing contract — one test per rule in `docs/specs/briefing-v2.md`.
 *
 * Every one of these is a rule the CEO's review asked for, and every one of
 * them is checked against CODE rather than against a prompt. If a test here
 * can be made to pass by rewording an agent's instructions, it is the wrong
 * test.
 *
 * Pure: no database, no clock, no model.
 */

import type { BriefingChange, BriefingDecision, BriefingV2 } from './document';
import type { AlignmentScore } from '@/services/alignment/AlignmentService';
import type { InboxItem } from '@/services/InboxService';
import { describe, expect, it } from 'vitest';
import {
  aboveFoldCount,
  capDecisions,
  capHistory,
  capMetrics,
  decisionHeadline,
  firstScreen,
  MAX_ABOVE_FOLD_ITEMS,
  MAX_DECISIONS,
  MAX_HISTORY_ENTRIES,
  MAX_TODAY_METRICS,
  splitChanges,
} from './budget';
import { composeWorkspaceBriefing, dedupeCriticalPath, dedupeExceptions, dedupeMetrics, metricScore, rankMetrics } from './compose';
import { BATCHABLE_AGREEMENT, BATCHABLE_MIN_SAMPLE, laneFor, splitLanes } from './decisions';
import { computeChanges, directionOf, joinDeltas, narrateChanges, rankChanges } from './deltas';
import { BRIEFING_SECTIONS, hasContent, renderedSections, SECTION_TITLE } from './document';
import { FIXTURE_BRIEFING, FIXTURE_METRICS, FIXTURE_PRIOR_METRICS, metric } from './fixtures';
import { formatMetric } from './format';
import { deriveOnTrack } from './onTrack';
import { redactSystemVocabulary } from './redact';
import { renderBriefingEmailMarkdown, renderBriefingMarkdown } from './render';
import { enforceBriefing, validateBriefingV2 } from './validate';

const NOW = new Date('2026-09-16T12:15:00Z');

function card(partial: Partial<BriefingDecision> & Pick<BriefingDecision, 'key'>): BriefingDecision {
  return {
    ref: { kind: 'ask', id: 1 },
    href: `/dashboard/inbox/${partial.key}`,
    kind: 'ruling',
    title: `Decision ${partial.key}`,
    whyNow: 'It blocks work that has already started.',
    evidence: [],
    lane: 'judgment',
    incident: false,
    risk: null,
    amount: null,
    currency: null,
    ...partial,
  };
}

function inboxItem(partial: Partial<InboxItem> & Pick<InboxItem, 'key' | 'kind'>): InboxItem {
  return {
    shape: 'single',
    ref: { kind: 'ask', id: 1 },
    title: `Item ${partial.key}`,
    agentSlug: null,
    teamSlug: null,
    risk: null,
    status: 'open',
    at: new Date('2026-09-10T00:00:00Z'),
    href: `/dashboard/inbox/${partial.key}`,
    ...partial,
  };
}

function score(agreementRate: number | null, n: number): AlignmentScore {
  return { agreementRate, n, agreed: Math.round((agreementRate ?? 0) * n), decided: n, rejected: 0, withNote: 0, window: '30d' };
}

/* ------------------------------------------------------------------ */
/* §1 — a section with nothing in it is omitted, never an empty state  */
/* ------------------------------------------------------------------ */

describe('empty sections are omitted, not rendered', () => {
  it('drops every section that carries nothing', () => {
    const doc: BriefingV2 = {
      version: 2,
      title: 'Revenue Briefing',
      dateLabel: 'Wed, Sep 16',
      updatedLabel: 'Updated 5:15 AM PT',
      teamSlug: null,
      composedFrom: [],
      today: { metrics: [metric({ key: 'k', label: 'Pipeline', value: 1 })], onTrack: { status: 'not-enough-evidence', basis: [], targetSet: false } },
      changes: { items: [] },
      criticalPath: { items: [] },
      exceptions: { items: [] },
      detail: { tables: [{ title: 'Empty', columns: ['a'], rows: [] }] },
      history: { entries: [], viewAllHref: '/dashboard/briefings/archive', total: 0 },
    };

    expect(renderedSections(doc)).toEqual(['today']);

    for (const section of BRIEFING_SECTIONS.filter(s => s !== 'today')) {
      expect(hasContent(doc, section)).toBe(false);
    }
  });

  it('renders no heading and no "nothing happened" line for an omitted section', () => {
    const doc: BriefingV2 = { ...FIXTURE_BRIEFING, exceptions: { items: [] }, agentActivity: undefined };
    const md = renderBriefingMarkdown(doc);

    expect(md).not.toContain(SECTION_TITLE.exceptions);
    expect(md).not.toContain(SECTION_TITLE.agentActivity);
    expect(md).not.toMatch(/nothing (?:ran|to judge|happened)/i);
    expect(md).not.toMatch(/no runs in this window/i);
  });

  it('keeps the spec order for the sections that do render', () => {
    const order = renderedSections(FIXTURE_BRIEFING);

    expect(order).toEqual(['today', 'decisions', 'changes', 'criticalPath', 'exceptions', 'detail', 'provenance', 'history']);

    const headings = [...renderBriefingMarkdown(FIXTURE_BRIEFING).matchAll(/^## (.+)$/gm)].map(m => m[1]);

    expect(headings).toEqual(order.map(s => SECTION_TITLE[s]));
  });

  it('strips husk sections from a document on the way to storage', () => {
    const { doc } = enforceBriefing({ ...FIXTURE_BRIEFING, exceptions: { items: [] } });

    expect(doc.exceptions).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* §5 — deltas are a typed join, never prose, never a fabricated zero  */
/* ------------------------------------------------------------------ */

describe('deltas join the prior brief by key', () => {
  it('fills previous, delta and direction from the prior brief', () => {
    const joined = joinDeltas(FIXTURE_METRICS, FIXTURE_PRIOR_METRICS);
    const pipeline = joined.find(m => m.key === 'open_pipeline')!;

    expect(pipeline.previous).toBe(3_310_000);
    expect(pipeline.delta).toBe(210_000);
    expect(pipeline.direction).toBe('up');
    expect(formatMetric(pipeline)).toBe('Open pipeline $3.52M ↑ $210K');
  });

  it('renders the value alone on a first brief — never a fake zero delta', () => {
    const joined = joinDeltas(FIXTURE_METRICS, null);

    for (const m of joined) {
      expect(m.previous).toBeUndefined();
      expect(m.delta).toBeUndefined();
      expect(m.direction).toBeUndefined();
    }

    expect(formatMetric(joined[0]!)).toBe('Open pipeline $3.52M');
    expect(formatMetric(joined[0]!)).not.toContain('↑');
  });

  it('gives no delta for a key the prior brief did not carry', () => {
    const joined = joinDeltas([metric({ key: 'brand_new', label: 'Brand new', value: 7 })], FIXTURE_PRIOR_METRICS);

    expect(joined[0]!.previous).toBeUndefined();
    expect(joined[0]!.delta).toBeUndefined();
  });

  it('discards a delta the caller supplied — the join is the only writer', () => {
    const lying = { ...metric({ key: 'open_pipeline', label: 'Open pipeline', value: 100 }), previous: 1, delta: 99, direction: 'up' as const };
    const joined = joinDeltas([lying], null);

    expect(joined[0]!.delta).toBeUndefined();
  });

  it('calls a flat move flat rather than up', () => {
    expect(directionOf(0)).toBe('flat');
    expect(directionOf(-1)).toBe('down');

    const joined = joinDeltas([metric({ key: 'awaiting_signature', label: 'Awaiting signature', value: 846_500, unit: 'usd' })], FIXTURE_PRIOR_METRICS);

    expect(formatMetric(joined[0]!)).toBe('Awaiting signature $846.5K no change');
  });

  it('computes changes only for keys that actually moved', () => {
    const joined = joinDeltas(FIXTURE_METRICS, FIXTURE_PRIOR_METRICS);
    const changes = computeChanges(joined, FIXTURE_PRIOR_METRICS);
    const keys = changes.map(c => c.key).sort();

    // awaiting_signature did not move; weighted_forecast appeared unreadable.
    expect(keys).toEqual(['call_outcomes_missing', 'open_pipeline']);
  });

  it('computes nothing on a first brief', () => {
    expect(computeChanges(FIXTURE_METRICS, null)).toEqual([]);
  });

  it('drops a narration whose key names no computed change', () => {
    const changes = computeChanges(joinDeltas(FIXTURE_METRICS, FIXTURE_PRIOR_METRICS), FIXTURE_PRIOR_METRICS);
    const narrated = narrateChanges(changes, { open_pipeline: 'One opportunity advanced.', invented_key: 'Something dramatic.' });

    expect(narrated.find(c => c.key === 'open_pipeline')!.narrative).toBe('One opportunity advanced.');
    expect(narrated.some(c => c.narrative === 'Something dramatic.')).toBe(false);
  });

  it('ranks a status change ahead of a numeric nudge', () => {
    const items: BriefingChange[] = [
      { key: 'nudge', label: 'Nudge', from: 100, to: 101, delta: 1, direction: 'up', provenance: 'observed', evidence: [] },
      { key: 'appeared', label: 'Appeared', from: null, to: 1, provenance: 'verified', evidence: [] },
    ];

    expect(rankChanges(items).map(c => c.key)).toEqual(['appeared', 'nudge']);
  });
});

/* ------------------------------------------------------------------ */
/* §2 + content rules — the attention budget                           */
/* ------------------------------------------------------------------ */

describe('the attention budget', () => {
  it('shows at most five metrics', () => {
    const many = Array.from({ length: 9 }, (_, i) => metric({ key: `k${i}`, label: `Metric ${i}`, value: i }));

    expect(capMetrics(many)).toHaveLength(MAX_TODAY_METRICS);
  });

  it('shows at most three decisions', () => {
    const cards = Array.from({ length: 7 }, (_, i) => card({ key: `c${i}` }));
    const { shown, dropped } = capDecisions(cards);

    expect(shown).toHaveLength(MAX_DECISIONS);
    expect(dropped).toHaveLength(4);
  });

  it('lets a genuine incident past the third card, and keeps its reason', () => {
    const cards = [
      card({ key: 'c0' }),
      card({ key: 'c1' }),
      card({ key: 'c2' }),
      card({ key: 'c3' }),
      card({ key: 'incident', incident: true, incidentReason: 'A signed customer is live on an unsigned agreement.' }),
    ];
    const { shown, overBudget, dropped } = capDecisions(cards);

    expect(shown.map(c => c.key)).toEqual(['c0', 'c1', 'c2', 'incident']);
    expect(overBudget.map(c => c.key)).toEqual(['incident']);
    expect(dropped.map(c => c.key)).toEqual(['c3']);
    expect(overBudget[0]!.incidentReason).toContain('unsigned agreement');
  });

  it('keeps the first screen to five items, folding changes rather than decisions', () => {
    const doc: BriefingV2 = {
      ...FIXTURE_BRIEFING,
      changes: { items: Array.from({ length: 6 }, (_, i) => ({ key: `ch${i}`, label: `Change ${i}`, from: 0, to: i + 1, delta: i + 1, direction: 'up' as const, provenance: 'observed' as const, evidence: [] })) },
    };
    const screen = firstScreen(doc);

    expect(screen.decisions).toHaveLength(3);
    expect(screen.changes).toHaveLength(2);
    expect(aboveFoldCount(screen.decisions.length, screen.changes.length)).toBe(MAX_ABOVE_FOLD_ITEMS);
    // Folded, not deleted.
    expect(screen.foldedChanges).toHaveLength(4);
  });

  it('gives an incident its own room instead of taking it from the changes', () => {
    const doc: BriefingV2 = {
      ...FIXTURE_BRIEFING,
      decisions: { ...FIXTURE_BRIEFING.decisions!, judgment: [...FIXTURE_BRIEFING.decisions!.judgment, card({ key: 'incident', incident: true, incidentReason: 'Production outage.' })] },
    };
    const screen = firstScreen(doc);

    expect(screen.decisions).toHaveLength(4);
    expect(screen.overBudget).toHaveLength(1);
    expect(screen.changes).toHaveLength(2);
    expect(validateBriefingV2(doc).issues.filter(i => i.rule === 'above-the-fold-budget')).toEqual([]);
  });

  it('never fits fewer than zero changes', () => {
    expect(splitChanges([], 9).shown).toEqual([]);
  });

  it('shows the last five briefings, not the archive', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Brief ${i}`, at: NOW, href: `/dashboard/briefings/${i + 1}`, teamSlug: null }));

    expect(capHistory(entries)).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(MAX_HISTORY_ENTRIES).toBeLessThanOrEqual(5);
  });

  it('caps history inside the document too', () => {
    const { doc } = enforceBriefing({
      ...FIXTURE_BRIEFING,
      history: { ...FIXTURE_BRIEFING.history!, entries: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `Brief ${i}`, at: NOW, href: `/dashboard/briefings/${i + 1}`, teamSlug: null })) },
    });

    expect(doc.history!.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(validateBriefingV2(doc).issues.filter(i => i.rule === 'history-budget')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* §2 — the headline is a split, never the raw queue count             */
/* ------------------------------------------------------------------ */

describe('the decisions headline', () => {
  it('splits judgment from the queue', () => {
    expect(decisionHeadline(3, 658)).toBe('3 decisions need you today · 658 lower-priority items queued');
  });

  it('never leads with the raw queue count', () => {
    const headline = decisionHeadline(3, 658);

    expect(headline.startsWith('661')).toBe(false);
    expect(headline.startsWith('658')).toBe(false);
    expect(headline).not.toContain('661');
  });

  it('reads right at one and at zero', () => {
    expect(decisionHeadline(1, 1)).toBe('1 decision needs you today · 1 lower-priority item queued');
    expect(decisionHeadline(0, 0)).toBe('Nothing needs your judgment today');
    expect(decisionHeadline(2, 0)).toBe('2 decisions need you today');
  });

  it('splits the queue by the inbox’s own kinds and the alignment ledger', () => {
    const alignment = new Map([
      ['hubspot.update', score(0.97, 40)],
      ['gmail.send', score(0.55, 30)],
      ['calendar.create', score(0.99, BATCHABLE_MIN_SAMPLE - 1)],
    ]);
    const items = [
      inboxItem({ key: 'a', kind: 'ruling' }),
      inboxItem({ key: 'b', kind: 'recommendation' }),
      inboxItem({ key: 'c', kind: 'proposal', actionId: 'hubspot.update' }),
      inboxItem({ key: 'd', kind: 'proposal', actionId: 'gmail.send' }),
      inboxItem({ key: 'e', kind: 'proposal', actionId: 'hubspot.update', risk: 'high' }),
      inboxItem({ key: 'f', kind: 'proposal', actionId: 'calendar.create' }),
      inboxItem({ key: 'g', kind: 'merge' }),
      inboxItem({ key: 'h', kind: 'run' }),
    ];
    const lanes = splitLanes(items, alignment);

    expect(lanes.judgment.map(i => i.key)).toEqual(['a', 'b', 'd', 'e']);
    expect(lanes.batchable.map(i => i.key)).toEqual(['c']);
    expect(lanes.background.map(i => i.key)).toEqual(['f', 'g', 'h']);
  });

  it('treats a kind with no track record as background, not batchable', () => {
    const untried = inboxItem({ key: 'x', kind: 'proposal', actionId: 'never.seen' });

    expect(laneFor(untried, new Map())).toBe('background');
    expect(BATCHABLE_AGREEMENT).toBeGreaterThan(0.5);
  });
});

/* ------------------------------------------------------------------ */
/* Content rule — every card answers why now                           */
/* ------------------------------------------------------------------ */

describe('why-now is required on every decision card', () => {
  it('rejects a card with no whyNow', () => {
    const { ok, issues } = validateBriefingV2({
      ...FIXTURE_BRIEFING,
      decisions: { ...FIXTURE_BRIEFING.decisions!, judgment: [{ ...FIXTURE_BRIEFING.decisions!.judgment[0]!, whyNow: '' }] },
    });

    expect(ok).toBe(false);
    expect(issues.some(i => i.message.includes('whyNow') || i.rule === 'why-now-required')).toBe(true);
  });

  it('rejects a card whose whyNow is only whitespace', () => {
    const { ok } = validateBriefingV2({
      ...FIXTURE_BRIEFING,
      decisions: { ...FIXTURE_BRIEFING.decisions!, judgment: [{ ...FIXTURE_BRIEFING.decisions!.judgment[0]!, whyNow: '   ' }] },
    });

    expect(ok).toBe(false);
  });

  it('drops the card rather than inventing a reason', () => {
    const { doc, dropped } = enforceBriefing({
      ...FIXTURE_BRIEFING,
      decisions: { ...FIXTURE_BRIEFING.decisions!, judgment: [{ ...FIXTURE_BRIEFING.decisions!.judgment[0]!, whyNow: '  ' }] },
    });

    expect(doc.decisions!.judgment).toHaveLength(0);
    expect(dropped.some(d => d.rule === 'why-now-required')).toBe(true);
  });

  it('requires a reason from a card claiming to be an incident', () => {
    const { ok, issues } = validateBriefingV2({
      ...FIXTURE_BRIEFING,
      decisions: { ...FIXTURE_BRIEFING.decisions!, judgment: [card({ key: 'x', incident: true })] },
    });

    expect(ok).toBe(false);
    expect(issues.some(i => i.rule === 'incident-reason-required')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §3 — "On track" next to "nothing ran" is impossible                 */
/* ------------------------------------------------------------------ */

describe('on track requires evidence', () => {
  it('answers not-enough-evidence when nothing measurable ran', () => {
    expect(deriveOnTrack([]).status).toBe('not-enough-evidence');
    expect(deriveOnTrack(FIXTURE_METRICS).status).toBe('not-enough-evidence');
  });

  it('refuses a verdict on an agent-reported number, however good it looks', () => {
    const selfReported = [metric({ key: 'k', label: 'Touches', value: 100, target: 10, provenance: 'agent-reported' })];

    expect(deriveOnTrack(selfReported).status).toBe('not-enough-evidence');
  });

  it('refuses a verdict on a measure with no target', () => {
    const noTarget = [metric({ key: 'k', label: 'Pipeline', value: 100, provenance: 'verified' })];

    expect(deriveOnTrack(noTarget).status).toBe('not-enough-evidence');
  });

  it('gives a verdict once a verified or observed measure carries a target', () => {
    expect(deriveOnTrack([metric({ key: 'k', label: 'Pipeline', value: 120, target: 100, provenance: 'verified' })]).status).toBe('on-track');
    expect(deriveOnTrack([metric({ key: 'k', label: 'Pipeline', value: 90, target: 100, provenance: 'observed' })]).status).toBe('at-risk');
    expect(deriveOnTrack([metric({ key: 'k', label: 'Pipeline', value: 10, target: 100, provenance: 'verified' })]).status).toBe('off-track');
  });

  it('omits the section entirely when nothing can be judged and no target is set', () => {
    const doc: BriefingV2 = { ...FIXTURE_BRIEFING, today: { metrics: [], onTrack: deriveOnTrack([]) } };

    expect(hasContent(doc, 'today')).toBe(false);
    expect(renderBriefingMarkdown(doc)).not.toContain('Are we on track');
  });

  it('says exactly that, and only that, when the person has set a target', () => {
    const onTrack = deriveOnTrack([], { targetSet: true });

    expect(onTrack.status).toBe('not-enough-evidence');
    expect(onTrack.note).toContain('target is set');

    const md = renderBriefingMarkdown({ ...FIXTURE_BRIEFING, today: { metrics: FIXTURE_BRIEFING.today!.metrics, onTrack } });

    expect(md).toContain('Not enough evidence');
    expect(md).not.toContain('On track');
  });

  it('rejects a hand-written green status with nothing behind it', () => {
    const { ok, issues } = validateBriefingV2({
      ...FIXTURE_BRIEFING,
      today: { ...FIXTURE_BRIEFING.today!, onTrack: { status: 'on-track', basis: [], targetSet: true } },
    });

    expect(ok).toBe(false);
    expect(issues.some(i => i.rule === 'on-track-needs-evidence')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §7–§9 — system vocabulary stays behind progressive disclosure       */
/* ------------------------------------------------------------------ */

describe('system vocabulary is redacted from the narrative', () => {
  it('catches a connector field name and footnotes it', () => {
    const prose = 'hs_deal_stage_probability exists in the CRM schema but is not returned by the counting tools available.';
    const { text, footnotes } = redactSystemVocabulary(prose);

    expect(text).not.toContain('hs_deal_stage_probability');
    expect(text).toContain('a connector field [1]');
    expect(footnotes).toEqual([{ marker: 1, token: 'hs_deal_stage_probability', kind: 'connector-field' }]);
  });

  it('catches agent slugs, job names, run ids, token counts and table names', () => {
    const vocab = { agents: ['proposal-writer'], jobs: ['daily-team-report'] };
    const cases: [string, string][] = [
      ['proposal-writer ran 0/0 times.', 'agent'],
      ['The `daily-team-report` job produced it.', 'job'],
      ['Run 4f2a9c1b88 failed.', 'run-id'],
      ['Spend $0, 12,480 tokens.', 'tokens'],
      ['Nothing landed in action_run.', 'schema-identifier'],
    ];
    for (const [prose, kind] of cases) {
      const { text, footnotes } = redactSystemVocabulary(prose, vocab);

      expect(footnotes[0]?.kind, prose).toBe(kind);
      expect(text, prose).not.toBe(prose);
    }
  });

  it('leaves ordinary briefing prose alone', () => {
    const prose = 'Delivery has started while the master agreement remains unsigned, so work is running ahead of the paperwork.';

    expect(redactSystemVocabulary(prose).footnotes).toEqual([]);
    expect(redactSystemVocabulary(prose).text).toBe(prose);
  });

  it('rejects a document that puts system vocabulary in a narrative section', () => {
    const { ok, issues } = validateBriefingV2({
      ...FIXTURE_BRIEFING,
      today: { ...FIXTURE_BRIEFING.today!, summary: 'Nothing landed because worker_run stayed empty.' },
    }, { agents: [] });

    expect(ok).toBe(false);
    expect(issues.some(i => i.rule === 'no-system-vocabulary')).toBe(true);
  });

  it('moves the token into the footnotes rather than deleting it', () => {
    const { doc } = enforceBriefing({
      ...FIXTURE_BRIEFING,
      today: { ...FIXTURE_BRIEFING.today!, summary: 'Weighted totals are missing because hs_deal_stage_probability is not returned.' },
    });

    expect(doc.today!.summary).not.toContain('hs_deal_stage_probability');
    expect(doc.provenance!.footnotes.some(f => f.token === 'hs_deal_stage_probability')).toBe(true);
    expect(validateBriefingV2(doc).ok).toBe(true);
  });

  it('allows the technical detail behind the metric’s "Why?" disclosure', () => {
    // The unavailable DETAIL is disclosure content, not narrative: the page
    // shows "Weighted forecast unavailable · Why?" and keeps the rest hidden.
    expect(validateBriefingV2(FIXTURE_BRIEFING).ok).toBe(true);
    expect(formatMetric(FIXTURE_BRIEFING.today!.metrics[3]!)).toBe('Weighted forecast unavailable · Why?');
  });
});

/* ------------------------------------------------------------------ */
/* §4 — the composer is an editorial layer, not a concatenation        */
/* ------------------------------------------------------------------ */

describe('the composer', () => {
  const teamDoc = (over: Partial<BriefingV2>): BriefingV2 => ({
    version: 2,
    title: 'Team brief',
    dateLabel: 'Wed, Sep 16',
    updatedLabel: 'Updated 5:00 AM PT',
    teamSlug: 'alpha',
    composedFrom: [],
    ...over,
  });

  it('de-duplicates the same metric reported by two teams, keeping the stronger provenance', () => {
    const merged = dedupeMetrics([
      { metric: metric({ key: 'open_pipeline', label: 'Open pipeline', value: 10, provenance: 'agent-reported', evidence: [{ kind: 'run', id: 'a', label: 'A' }] }), teamRank: 0 },
      { metric: metric({ key: 'open_pipeline', label: 'Open pipeline', value: 12, provenance: 'verified', evidence: [{ kind: 'crm-deal', id: 'b', label: 'B' }] }), teamRank: 1 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.metric.value).toBe(12);
    expect(merged[0]!.metric.provenance).toBe('verified');
    // Merging never loses a citation.
    expect(merged[0]!.metric.evidence.map(e => e.id).sort()).toEqual(['a', 'b']);
  });

  it('breaks a provenance tie on the caller’s team order', () => {
    const merged = dedupeMetrics([
      { metric: metric({ key: 'k', label: 'K', value: 2, provenance: 'observed' }), teamRank: 1 },
      { metric: metric({ key: 'k', label: 'K', value: 1, provenance: 'observed' }), teamRank: 0 },
    ]);

    expect(merged[0]!.metric.value).toBe(1);
  });

  it('de-duplicates critical-path items and exceptions across teams', () => {
    const path = dedupeCriticalPath([
      { at: '11:30', order: 690, label: 'Reset call', evidence: [] },
      { at: '11:30', order: 690, label: 'reset  call', status: 'held', evidence: [] },
      { at: '12:30', order: 750, label: 'Follow-up', evidence: [] },
    ]);

    expect(path.map(i => i.label)).toEqual(['Reset call', 'Follow-up']);
    expect(path[0]!.status).toBe('held');

    const exceptions = dedupeExceptions([
      { key: 'stale', label: 'Stale deals', why: 'No activity.', severity: 'risk', evidence: [] },
      { key: 'stale', label: 'Stale deals', why: 'No activity.', severity: 'blocker', evidence: [] },
    ]);

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.severity).toBe('blocker');
  });

  it('ranks across teams on provenance, then movement, then size', () => {
    const verified = metric({ key: 'a', label: 'A', value: 1, provenance: 'verified' });
    const selfReported = metric({ key: 'b', label: 'B', value: 1, provenance: 'agent-reported' });
    const moved = { ...metric({ key: 'c', label: 'C', value: 110, provenance: 'observed' }), previous: 100, delta: 10, direction: 'up' as const };
    const still = metric({ key: 'd', label: 'D', value: 100, provenance: 'observed' });

    expect(metricScore(verified, 0)).toBeGreaterThan(metricScore(selfReported, 0));
    expect(metricScore(moved, 0)).toBeGreaterThan(metricScore(still, 0));
    expect(rankMetrics([{ metric: selfReported, teamRank: 0 }, { metric: verified, teamRank: 3 }]).map(m => m.key)).toEqual(['a', 'b']);
  });

  it('is deterministic when two claims score the same', () => {
    const entries = [
      { metric: metric({ key: 'zulu', label: 'Z', value: 1 }), teamRank: 0 },
      { metric: metric({ key: 'alpha', label: 'A', value: 1 }), teamRank: 0 },
    ];

    expect(rankMetrics(entries).map(m => m.key)).toEqual(['alpha', 'zulu']);
    expect(rankMetrics([...entries].reverse()).map(m => m.key)).toEqual(['alpha', 'zulu']);
  });

  it('carries the team briefings as SOURCES and never inlines them', () => {
    const { doc } = composeWorkspaceBriefing({
      title: 'Revenue Briefing',
      dateLabel: 'Wed, Sep 16',
      updatedLabel: 'Updated 5:15 AM PT',
      teams: [
        { briefingId: 7, teamSlug: 'alpha', teamName: 'Alpha', at: NOW, doc: teamDoc({ today: { metrics: [metric({ key: 'open_pipeline', label: 'Open pipeline', value: 3_520_000, unit: 'usd', provenance: 'verified' })] } }) },
        { briefingId: 8, teamSlug: 'bravo', teamName: 'Bravo', at: NOW, doc: teamDoc({ today: { metrics: [metric({ key: 'open_pipeline', label: 'Open pipeline', value: 3_000_000, unit: 'usd', provenance: 'agent-reported' })] } }) },
      ],
      prior: null,
    });

    expect(doc.today!.metrics).toHaveLength(1);
    expect(doc.today!.metrics[0]!.value).toBe(3_520_000);
    expect(doc.composedFrom.map(t => t.teamSlug)).toEqual(['alpha', 'bravo']);
    expect(doc.provenance!.sources.map(s => s.label)).toContain('Alpha briefing');

    const md = renderBriefingMarkdown(doc);

    expect(md).not.toMatch(/from the .* briefing/i);
    // One title, one date line — never a briefing inside a briefing.
    expect([...md.matchAll(/^# /gm)]).toHaveLength(1);
  });

  it('puts the composing agent’s own reading ahead of the teams’', () => {
    const { doc } = composeWorkspaceBriefing({
      title: 'Revenue Briefing',
      dateLabel: 'Wed, Sep 16',
      updatedLabel: 'Updated 5:15 AM PT',
      own: { metrics: [metric({ key: 'k', label: 'K', value: 1, provenance: 'observed' })] },
      teams: [{ briefingId: 7, teamSlug: 'alpha', teamName: 'Alpha', at: NOW, doc: teamDoc({ today: { metrics: [metric({ key: 'k', label: 'K', value: 2, provenance: 'observed' })] } }) }],
      prior: null,
    });

    expect(doc.today!.metrics[0]!.value).toBe(1);
  });

  it('produces a document that satisfies the contract', () => {
    const { doc } = composeWorkspaceBriefing({
      title: 'Revenue Briefing',
      dateLabel: 'Wed, Sep 16',
      updatedLabel: 'Updated 5:15 AM PT',
      teams: [{ briefingId: 7, teamSlug: 'alpha', teamName: 'Alpha', at: NOW, doc: teamDoc({ today: { metrics: FIXTURE_METRICS }, criticalPath: FIXTURE_BRIEFING.criticalPath, exceptions: FIXTURE_BRIEFING.exceptions }) }],
      prior: { ...FIXTURE_BRIEFING, today: { metrics: FIXTURE_PRIOR_METRICS } },
      decisions: { judgment: FIXTURE_BRIEFING.decisions!.judgment, queued: { batchable: 612, background: 46 } },
      narratives: { open_pipeline: 'One opportunity advanced a stage.' },
      history: FIXTURE_BRIEFING.history!.entries,
      historyTotal: 41,
    });

    expect(validateBriefingV2(doc).issues).toEqual([]);
    expect(doc.today!.metrics.find(m => m.key === 'open_pipeline')!.delta).toBe(210_000);
    expect(doc.changes!.items.find(c => c.key === 'open_pipeline')!.narrative).toBe('One opportunity advanced a stage.');
  });
});

/* ------------------------------------------------------------------ */
/* The mail — the first screen and a link, not the whole document      */
/* ------------------------------------------------------------------ */

describe('the email renderer', () => {
  it('carries the first screen and a link, and nothing below the fold', () => {
    const mail = renderBriefingEmailMarkdown(FIXTURE_BRIEFING, { briefing: 'https://example.test/dashboard/briefings/42', inbox: 'https://example.test/dashboard/inbox', archive: 'https://example.test/dashboard/briefings/archive' });

    expect(mail).toContain('Revenue Briefing');
    expect(mail).toContain(SECTION_TITLE.decisions);
    expect(mail).toContain(SECTION_TITLE.changes);
    expect(mail).toContain(SECTION_TITLE.criticalPath);
    expect(mail).toContain('[Open the full briefing](https://example.test/dashboard/briefings/42)');

    expect(mail).not.toContain(SECTION_TITLE.detail);
    expect(mail).not.toContain(SECTION_TITLE.provenance);
    expect(mail).not.toContain(SECTION_TITLE.history);
    expect(mail).not.toContain(SECTION_TITLE.agentActivity);
  });

  it('spends the same attention budget as the page', () => {
    const mail = renderBriefingEmailMarkdown(FIXTURE_BRIEFING);
    const bullets = [...mail.matchAll(/^- /gm)];
    const screen = firstScreen(FIXTURE_BRIEFING);

    expect(bullets).toHaveLength(screen.decisions.length + screen.changes.length);
  });
});

describe('the critical path is a claim about today', () => {
  // On 2026-09-17 a briefing served a call from the previous day as "10:30am
  // CT today". A critical-path item carried a time of day and no date, so an
  // item carried forward from the previous briefing was indistinguishable
  // from one happening in an hour. The prompt already forbade it; the
  // publisher now checks it.
  const NOW_ = new Date('2026-09-17T16:00:00Z');
  const today = '2026-09-17';
  const item = (over: Record<string, unknown>) => ({ at: '10:30', order: 630, label: 'Bid outcome call', evidence: [], ...over });

  it('keeps an item dated today', () => {
    const { doc, dropped } = enforceBriefing(
      { ...FIXTURE_BRIEFING, criticalPath: { items: [item({ date: today })] } },
      {},
      NOW_,
    );

    expect(doc.criticalPath?.items).toHaveLength(1);
    expect(dropped.filter(d => d.section === 'criticalPath')).toHaveLength(0);
  });

  it('drops an item carried forward from yesterday, and says so', () => {
    const { doc, dropped } = enforceBriefing(
      { ...FIXTURE_BRIEFING, criticalPath: { items: [item({ date: '2026-09-16' })] } },
      {},
      NOW_,
    );

    expect(doc.criticalPath?.items ?? []).toHaveLength(0);
    expect(dropped.find(d => d.rule === 'must-be-today')?.message).toContain('2026-09-16');
  });

  it('drops an undated item, because a time of day is not a date', () => {
    const { doc, dropped } = enforceBriefing(
      { ...FIXTURE_BRIEFING, criticalPath: { items: [item({})] } },
      {},
      NOW_,
    );

    expect(doc.criticalPath?.items ?? []).toHaveLength(0);
    expect(dropped.find(d => d.rule === 'must-be-today')?.message).toContain('no date');
  });

  it('keeps today and drops the rest in one pass', () => {
    const { doc } = enforceBriefing(
      {
        ...FIXTURE_BRIEFING,
        criticalPath: {
          items: [
            item({ date: '2026-09-16', label: 'Yesterday' }),
            item({ date: today, label: 'Today' }),
            item({ label: 'Undated' }),
            item({ date: '2026-09-18', label: 'Tomorrow' }),
          ],
        },
      },
      {},
      NOW_,
    );

    expect((doc.criticalPath?.items ?? []).map(i => i.label)).toEqual(['Today']);
  });
});
