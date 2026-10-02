/**
 * The daily cap on what the tracker-intake automation files, against PGlite.
 * "One a day" is a person's requirement, so the filing tool refuses the second
 * and stamps the first. The rules someone could get wrong: only the intake
 * automation (by its declared role) is capped; only what the intake filed
 * counts, never chat or another automation; yesterday does not count; and the
 * day is the workspace's, not UTC's.
 */
import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationSchema, businessObjectSchema, businessObjectTypeSchema, knowledgeSourceSchema, missionRunSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { intakeFiling } = await import('./intakeCap');

const ORG = 'org_intake_cap';
const BASE = 'https://northwind.atlassian.net';
const FIELDS = { evidence: { urls: [`${BASE}/browse/NW-2`] } };
const NOON_OCT_2 = new Date('2026-10-02T20:00:00Z');

let typeId = 0;
let intakeRunId = 0;
let ciRunId = 0;

function ctx(missionRunId?: number): RuntimeContext {
  return { orgId: ORG, userId: 'user_owner', agentSlug: 'product-manager', ...(missionRunId ? { missionRunId } : {}) } as unknown as RuntimeContext;
}

async function file(createdAt: Date, issue: string, stamp?: { source: string; day: string }) {
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId, title: `From ${issue}`, metadata: { evidence: { urls: [`${BASE}/browse/${issue}`] }, ...(stamp ? { intake: stamp } : {}) }, createdAt });
}

async function runCausedBy(automationSlug: string): Promise<number> {
  const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: automationSlug, brief: 'x', team: [], causedBy: [{ automationSlug }] } as never).returning({ id: missionRunSchema.id });
  return run!.id;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-cap', name: 'Northwind', slug: 'northwind-cap' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-cap', slug: 'northwind', name: 'Northwind', timeZone: 'America/Los_Angeles' });
  await db.insert(knowledgeSourceSchema).values([
    { orgId: ORG, slug: 'jira-northwind', kind: 'plugin', configJson: { _connector: 'jira', baseUrl: BASE, projectKeys: ['NW'], intakePerDay: 1 } },
    { orgId: ORG, slug: 'jira-uncapped', kind: 'plugin', configJson: { _connector: 'jira', baseUrl: 'https://open.atlassian.net', projectKeys: ['OP'] } },
  ]);
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object' } }).returning({ id: businessObjectTypeSchema.id });
  typeId = type!.id;
  await db.insert(automationSchema).values([
    { orgId: ORG, slug: 'factory-tracker-intake', name: 'Pick up the roadmap', whenConfig: { schedule: '0 * * * 1-5' }, doConfig: { checkMission: 'close-the-gap', role: 'tracker-intake' } },
    { orgId: ORG, slug: 'factory-ci-failure', name: 'A check failed', whenConfig: { event: 'ci.failed' }, doConfig: { checkMission: 'close-the-gap' } },
  ] as never);
  intakeRunId = await runCausedBy('factory-tracker-intake');
  ciRunId = await runCausedBy('factory-ci-failure');
});

describe('intakeFiling', () => {
  it('stamps the first filing of the day with the source and the workspace date', async () => {
    const out = await intakeFiling(ctx(intakeRunId), FIELDS, NOON_OCT_2);

    expect(out).toEqual({ stamp: { source: 'jira-northwind', day: '2026-10-02' } });
  });

  it('counts chat filings and other automations\' filings for nothing: two of them still let the intake through', async () => {
    await file(new Date('2026-10-02T15:00:00Z'), 'NW-10');
    await file(new Date('2026-10-02T16:00:00Z'), 'NW-11');

    const out = await intakeFiling(ctx(intakeRunId), FIELDS, NOON_OCT_2);

    expect(out.refusal).toBeUndefined();
    expect(out.stamp?.day).toBe('2026-10-02');
  });

  it('refuses the second ticket once one is stamped today, and names the date it counted for', async () => {
    await file(new Date('2026-10-02T17:00:00Z'), 'NW-12', { source: 'jira-northwind', day: '2026-10-02' });

    const out = await intakeFiling(ctx(intakeRunId), FIELDS, NOON_OCT_2);

    expect(out.refusal).toBe('The factory already picked up 1 of 1 tickets from jira-northwind today (2026-10-02). The rest wait for tomorrow.');
    expect(out.stamp).toBeUndefined();
  });

  it('never caps or stamps a filing from chat', async () => {
    expect(await intakeFiling(ctx(), FIELDS, NOON_OCT_2)).toEqual({});
  });

  it('never caps or stamps another automation\'s filing of a Jira-linked request', async () => {
    expect(await intakeFiling(ctx(ciRunId), FIELDS, NOON_OCT_2)).toEqual({});
  });

  it('does not count yesterday: the next morning the factory may pick one up again', async () => {
    const out = await intakeFiling(ctx(intakeRunId), FIELDS, new Date('2026-10-03T16:00:00Z'));

    expect(out.refusal).toBeUndefined();
    expect(out.stamp?.day).toBe('2026-10-03');
  });

  it('names the day in the workspace time zone, not UTC', async () => {
    // 06:00 UTC on Oct 1 is 11 PM on Sep 30 in Los Angeles.
    const out = await intakeFiling(ctx(intakeRunId), FIELDS, new Date('2026-10-01T06:00:00Z'));

    expect(out.stamp?.day).toBe('2026-09-30');
  });

  it('stamps but never refuses a tracker with no daily limit', async () => {
    const out = await intakeFiling(ctx(intakeRunId), { evidence: { urls: ['https://open.atlassian.net/browse/OP-1'] } }, NOON_OCT_2);

    expect(out).toEqual({ stamp: { source: 'jira-uncapped', day: '2026-10-02' } });
  });

  it('leaves a link that is no connected tracker\'s issue alone', async () => {
    expect(await intakeFiling(ctx(intakeRunId), { evidence: { urls: ['https://elsewhere.example/browse/X-1'] } }, NOON_OCT_2)).toEqual({});
  });
});
