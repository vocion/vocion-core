import type { DataRoom } from '@/services/DataRoomService';
import { expect, it } from 'vitest';
import { renderSeoMeasurementReport, seoReadiness } from './readiness';

it('distinguishes prepared profile from approved and exposes missing measurement without zero or invented impact', () => {
  const project = { id: 9, title: 'Northwind', meta: { seoProfileDraft: { profile: { clientType: 'b2b_saas', goals: ['organic_leads'] } } } } as unknown as DataRoom;
  const result = seoReadiness(project, [], null);

  expect(result.checks.find(c => c.id === 'profile')?.state).toBe('missing');
  expect(result.checks.find(c => c.id === 'baseline')?.state).toBe('missing');
  expect(result.checks.find(c => c.id === 'reporting')?.state).toBe('unknown');

  const report = renderSeoMeasurementReport(project.title, result, new Date('2026-10-30'));

  expect(report).toContain('No outcome measures recorded');
  expect(report).toContain('No monthly delivery cadence');
  expect(report).toContain('not attributed leads or revenue');
});

it('calls configured measurement and publish targets configuration, not verified access or automated monitoring', () => {
  const project = { id: 9, meta: { searchConsoleProperty: { siteUrl: 'sc-domain:northwind.example' }, publishTargets: [{ id: 'web' }], siteInventory: { artifactId: 20, readAt: '2026-10-01', pages: 10, cappedAt: 10 } } } as unknown as DataRoom;
  const result = seoReadiness(project, [], null);

  expect(result.checks.find(c => c.id === 'search_console')?.detail).toContain('verified when');
  expect(result.checks.find(c => c.id === 'inventory')?.detail).toContain('coverage was capped');
  expect(result.checks.find(c => c.id === 'publishing')?.detail).toContain('checked at execution');
});

it('exports initiative blockers and links the existing goal review', () => {
  const readiness = seoReadiness({ id: 9, meta: {} } as DataRoom, [], null);
  readiness.initiatives = [{ label: 'Fix crawl errors', status: 'blocked', blockedReason: 'Awaiting CMS access', due: '2026-11-06' }];
  readiness.goalHref = '/dashboard/goals/7';
  const report = renderSeoMeasurementReport('Northwind', readiness);

  expect(report).toContain('Fix crawl errors: blocked; due 2026-11-06; blocked: Awaiting CMS access');
  expect(report).toContain('/dashboard/goals/7');
});

it('reports provider publication separately from dated public checks', () => {
  const readiness = seoReadiness({ id: 9, meta: {} } as DataRoom, [], null);
  readiness.publication = { recordedPublished: 5, verified: 2, failed: 1, unverified: 1, notChecked: 1 };
  const report = renderSeoMeasurementReport('Northwind', readiness);

  expect(report).toContain('5 provider-recorded published pages; 2 have matching public HTML checks');
  expect(report).toContain('not continuous monitoring or indexing proof');
});
