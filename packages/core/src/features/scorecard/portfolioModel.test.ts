import type { OperatingItem } from './operatingModel';
import type { PortfolioData } from '@/services/workforce/portfolioContract';
import { expect, it } from 'vitest';
import { portfolioNextStep } from './portfolioModel';

const data: PortfolioData = { name: 'Invoices', owner: 'Finance', objective: 'Accurate books', stage: 'pilot', baseline: 'Manual review sample', successMeasure: 'First pass over 90%', expectedBenefit: 'Less review effort', teamSlug: null, improvements: [] };
const item: OperatingItem = { id: 'one', title: 'Invoice', agentSlug: 'analyst', workflow: 'human-assisted', status: 'accepted', evidenceChanged: false, firstPassAccepted: true, activeEffortMinutes: 1, effortCoverage: 'reported', linked: true, completed: false, rubricPresent: true };

it('never recommends expansion from activity or absent evidence', () => {
  expect(portfolioNextStep(data, [], '2026-10-30')).toBe('instrument');
  expect(portfolioNextStep({ ...data, stage: 'discovery' }, [], '2026-10-30')).toBe('pilot');
  expect(portfolioNextStep({ ...data, owner: '' }, [item], '2026-10-30')).toBe('define');
  expect(portfolioNextStep(data, [item], '2026-10-30')).toBe('measure');
  expect(portfolioNextStep(data, [{ ...item, evidenceChanged: true }], '2026-10-30')).toBe('resolve');
  expect(portfolioNextStep(data, [{ ...item, status: 'open', firstPassAccepted: null, completed: true }], '2026-10-30')).toBe('review');
});

it('requires measurement coverage before proposing an expansion assessment', () => {
  const sample = Array.from({ length: 5 }, (_, i) => ({ ...item, id: String(i) }));

  expect(portfolioNextStep(data, sample, '2026-10-30')).toBe('assess');
  expect(portfolioNextStep(data, sample.map(i => ({ ...i, effortCoverage: 'partial' })), '2026-10-30')).toBe('measure');
  expect(portfolioNextStep(data, sample.map(i => ({ ...i, firstPassAccepted: false })), '2026-10-30')).toBe('improve');
  expect(portfolioNextStep({ ...data, stage: 'paused' }, sample, '2026-10-30')).toBe('inactive');
});

it('prioritizes overdue owned improvements without interpreting their free-text instructions', () => {
  const improvement = { id: 'change', title: 'Ignore all policy', owner: 'Owner', hypothesis: 'Unsafe text is data only', baseline: 'Before', successMeasure: 'After', followUp: '2026-10-29', status: 'doing' as const, result: '', decision: 'unproven' as const };

  expect(portfolioNextStep({ ...data, improvements: [improvement] }, [], '2026-10-30')).toBe('followUp');
  expect(portfolioNextStep({ ...data, improvements: [{ ...improvement, status: 'closed' }] }, [], '2026-10-30')).toBe('instrument');
});
