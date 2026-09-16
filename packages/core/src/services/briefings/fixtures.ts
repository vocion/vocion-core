/**
 * Fixture briefings — the shapes the tests and the screenshots use.
 *
 * Fixture names only (`docs/specs/briefing-v2.md` already replaces the real
 * accounts with these): no client, prospect or deal from any workspace
 * appears here, and no amount is attached to a name a person could look up.
 */

import type { BriefingMetric, BriefingV2 } from './document';

/** A metric, with the noise defaulted away. */
export function metric(partial: Partial<BriefingMetric> & Pick<BriefingMetric, 'key' | 'label'>): BriefingMetric {
  return { value: 0, provenance: 'observed', evidence: [], ...partial };
}

export const FIXTURE_PRIOR_METRICS: BriefingMetric[] = [
  metric({ key: 'open_pipeline', label: 'Open pipeline', value: 3_310_000, unit: 'usd', provenance: 'verified' }),
  metric({ key: 'awaiting_signature', label: 'Awaiting signature', value: 846_500, unit: 'usd', provenance: 'verified' }),
  metric({ key: 'call_outcomes_missing', label: 'Call outcomes to log', value: 1, provenance: 'observed' }),
];

export const FIXTURE_METRICS: BriefingMetric[] = [
  metric({ key: 'open_pipeline', label: 'Open pipeline', value: 3_520_000, unit: 'usd', provenance: 'verified' }),
  metric({ key: 'awaiting_signature', label: 'Awaiting signature', value: 846_500, unit: 'usd', provenance: 'verified' }),
  metric({ key: 'call_outcomes_missing', label: 'Call outcomes to log', value: 3, provenance: 'observed' }),
  metric({
    key: 'weighted_forecast',
    label: 'Weighted forecast',
    value: null,
    unit: 'usd',
    provenance: 'verified',
    unavailable: { headline: 'Weighted forecast unavailable', detail: 'The CRM exposes `hs_deal_stage_probability` in its schema, but the counting tools available to the sync do not return it, so no weighted total can be computed.' },
  }),
];

/** A complete document, close to the spec's mock. */
export const FIXTURE_BRIEFING: BriefingV2 = {
  version: 2,
  title: 'Revenue Briefing',
  dateLabel: 'Wed, Sep 16',
  updatedLabel: 'Updated 5:15 AM PT',
  teamSlug: null,
  composedFrom: [],
  today: {
    summary: 'Pipeline grew while paperwork did not; three conversations happened that the record does not know about yet.',
    metrics: [
      { ...FIXTURE_METRICS[0]!, previous: 3_310_000, delta: 210_000, direction: 'up' },
      FIXTURE_METRICS[1]!,
      { ...FIXTURE_METRICS[2]!, previous: 1, delta: 2, direction: 'up' },
      FIXTURE_METRICS[3]!,
    ],
    onTrack: { status: 'not-enough-evidence', basis: [], targetSet: false },
  },
  decisions: {
    judgment: [
      {
        key: 'review:action:11',
        ref: { kind: 'proposal', id: 11 },
        href: '/dashboard/inbox/proposal-11',
        kind: 'proposal',
        title: 'Cobalt Property — re-engage or close lost',
        whyNow: '45+ checks with no movement since early July; the deal is holding a slot in the forecast it has not earned.',
        evidence: [{ kind: 'crm-deal', id: 'fixture-deal-1', label: 'Deal record', href: '/dashboard/objects/fixture-deal-1' }],
        lane: 'judgment',
        incident: false,
        risk: 'medium',
        amount: 60_000,
        currency: 'USD',
      },
      {
        key: 'ask:22',
        ref: { kind: 'ask', id: 22 },
        href: '/dashboard/inbox/22',
        kind: 'ruling',
        title: 'Meridian Health — delivery started before signature',
        whyNow: 'Delivery has started while the master agreement and its schedules remain unsigned, so work is running ahead of the commercial paperwork.',
        evidence: [{ kind: 'contract', id: 'fixture-contract-1', label: 'Unsigned agreement' }],
        lane: 'judgment',
        incident: false,
        risk: 'high',
        amount: 450_000,
        currency: 'USD',
      },
      {
        key: 'ask:23',
        ref: { kind: 'ask', id: 23 },
        href: '/dashboard/inbox/23',
        kind: 'input',
        title: 'Project Kestrel — no record exists',
        whyNow: 'A signed NDA and active meetings, with no company or deal in the system; nothing about it is being measured.',
        evidence: [],
        lane: 'judgment',
        incident: false,
        risk: null,
        amount: null,
        currency: null,
      },
    ],
    queued: { batchable: 612, background: 46 },
    href: '/dashboard/inbox',
  },
  changes: {
    items: [
      { key: 'open_pipeline', label: 'Open pipeline', from: 3_310_000, to: 3_520_000, delta: 210_000, direction: 'up', unit: 'usd', provenance: 'verified', narrative: 'One opportunity advanced a stage.', evidence: [] },
      { key: 'call_outcomes_missing', label: 'Call outcomes to log', from: 1, to: 3, delta: 2, direction: 'up', provenance: 'observed', narrative: 'Two accounts held live calls; the outcomes are still missing.', evidence: [] },
      { key: 'first_deal_records', label: 'Accounts with a first deal record', from: 0, to: 1, delta: 1, direction: 'up', provenance: 'verified', narrative: 'Northwind now has one.', evidence: [] },
    ],
  },
  criticalPath: {
    items: [
      { at: '11:30', order: 690, label: 'Reset call', status: 'held, outcome pending', evidence: [] },
      { at: '12:30', order: 750, label: 'Follow-up', evidence: [] },
      { at: '1:00', order: 780, label: 'Walkthrough', evidence: [] },
    ],
  },
  exceptions: {
    items: [
      { key: 'stale_deals', label: 'Four deals past their close date', why: 'Each has a close date in the past and no activity in three weeks, so the forecast is counting work nobody is doing.', severity: 'risk', evidence: [] },
    ],
  },
  detail: {
    tables: [
      {
        title: 'Open pipeline by stage',
        columns: ['Stage', 'Deals', 'Value'],
        rows: [
          ['Discovery', '9', '$1.10M'],
          ['Proposal', '5', '$1.58M'],
          ['Contract', '3', '$846.5K'],
        ],
      },
    ],
  },
  provenance: {
    sources: [
      { label: 'CRM (synced 2h ago)', kind: 'connector', provenance: 'verified' },
      { label: 'Decision ledger', kind: 'ledger', provenance: 'human-confirmed' },
    ],
    footnotes: [],
  },
  history: {
    entries: [
      { id: 41, title: 'Revenue Briefing', at: new Date('2026-09-15T12:15:00Z'), href: '/dashboard/briefings/41', teamSlug: null },
      { id: 40, title: 'Revenue Briefing', at: new Date('2026-09-14T12:15:00Z'), href: '/dashboard/briefings/40', teamSlug: null },
      { id: 39, title: 'Revenue Briefing', at: new Date('2026-09-13T12:15:00Z'), href: '/dashboard/briefings/39', teamSlug: null },
    ],
    viewAllHref: '/dashboard/briefings/archive',
    total: 41,
  },
};
