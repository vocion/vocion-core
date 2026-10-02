/**
 * The daily cap on what an intake automation files from a tracker, against
 * PGlite. "One a day" is a person's requirement, so the filing tool refuses
 * the second one. The rules someone could get wrong: a chat filing is never
 * capped, yesterday does not count against today, and "today" is the
 * workspace's date, not UTC's.
 */
import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, knowledgeSourceSchema, missionRunSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { intakeCapRefusal } = await import('./intakeCap');

const ORG = 'org_intake_cap';
const BASE = 'https://northwind.atlassian.net';
const FIELDS = { evidence: { urls: [`${BASE}/browse/NW-2`] } };

let typeId = 0;
let automationRunId = 0;

function ctx(missionRunId?: number): RuntimeContext {
  return { orgId: ORG, userId: 'user_owner', agentSlug: 'product-manager', ...(missionRunId ? { missionRunId } : {}) } as unknown as RuntimeContext;
}

async function fileOn(createdAt: Date, issue: string) {
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId, title: `From ${issue}`, metadata: { evidence: { urls: [`${BASE}/browse/${issue}`] } }, createdAt });
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-cap', name: 'Northwind', slug: 'northwind-cap' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-cap', slug: 'northwind', name: 'Northwind', timeZone: 'America/Los_Angeles' });
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'jira-northwind', kind: 'plugin', configJson: { _connector: 'jira', baseUrl: BASE, projectKeys: ['NW'], intakePerDay: 1 } });
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object' } }).returning({ id: businessObjectTypeSchema.id });
  typeId = type!.id;
  const [run] = await db.insert(missionRunSchema).values({ orgId: ORG, title: 'Pick up the roadmap', brief: 'x', team: [], causedBy: [{ automationSlug: 'factory-tracker-intake' }] } as never).returning({ id: missionRunSchema.id });
  automationRunId = run!.id;
});

describe('intakeCapRefusal', () => {
  it('refuses the second ticket of the day and names the date it counted for', async () => {
    await fileOn(new Date('2026-10-02T15:00:00Z'), 'NW-1');

    const refusal = await intakeCapRefusal(ctx(automationRunId), FIELDS, new Date('2026-10-02T20:00:00Z'));

    expect(refusal).toBe('The factory already picked up 1 of 1 tickets from jira-northwind today (2026-10-02). The rest wait for tomorrow.');
  });

  it('never caps a request filed from chat', async () => {
    expect(await intakeCapRefusal(ctx(), FIELDS, new Date('2026-10-02T20:00:00Z'))).toBeUndefined();
  });

  it('does not count yesterday: the next morning the factory may pick one up again', async () => {
    expect(await intakeCapRefusal(ctx(automationRunId), FIELDS, new Date('2026-10-03T16:00:00Z'))).toBeUndefined();
  });

  it('counts the day in the workspace time zone, not UTC', async () => {
    // 06:00 UTC on Oct 1 is 11 PM on Sep 30 in Los Angeles: yesterday there, today in UTC.
    await fileOn(new Date('2026-10-01T06:00:00Z'), 'NW-0');

    expect(await intakeCapRefusal(ctx(automationRunId), FIELDS, new Date('2026-10-01T12:00:00Z'))).toBeUndefined();
  });

  it('leaves a ticket from a tracker with no daily limit alone', async () => {
    const other = { evidence: { urls: ['https://other.atlassian.net/browse/OT-1'] } };

    expect(await intakeCapRefusal(ctx(automationRunId), other, new Date('2026-10-02T20:00:00Z'))).toBeUndefined();
  });
});
