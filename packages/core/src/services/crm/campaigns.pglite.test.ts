import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { campaignPlans, changeCampaign } = await import('./campaigns');
const { installOutreachPlanning, planningListIds } = await import('./planning');
const { writeListRecords, configureList } = await import('@/services/lists/service');
const actor = { orgId: 'campaign-org', userId: 'campaign-admin' };
const member = { ...actor, userId: 'campaign-member' };
const outsider = { orgId: 'campaign-other', userId: 'campaign-outsider' };
let listId: string;
const values = { name: 'Weekly value', subject: 'A useful idea', preview: 'Preview', body: 'Draft content', sender: 'sender@example.test', audience: 'Opted-in contacts', exclusions: 'Suppress opt-outs, replies and active sequences; eligibility unverified', evidence: 'Source document reference', proposed_at: '2099-01-01T09:00:00-08:00', timezone: 'America/Los_Angeles' };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([{ id: 'campaign-account', name: 'Example', slug: 'campaign-account' }, { id: 'campaign-other-account', name: 'Other', slug: 'campaign-other-account' }]);
  await db.insert(userSchema).values([actor, member, outsider].map(a => ({ id: a.userId, email: `${a.userId}@example.test` })));
  await db.insert(accountMembershipSchema).values([actor, member, outsider].map(a => ({ userId: a.userId, accountId: a === outsider ? 'campaign-other-account' : 'campaign-account', role: a === member ? 'member' : 'admin' })));
  await db.insert(projectSchema).values([{ id: actor.orgId, accountId: 'campaign-account', name: 'Example', slug: actor.orgId, outboundDryRun: true }, { id: outsider.orgId, accountId: 'campaign-other-account', name: 'Other', slug: outsider.orgId }]);
  await installOutreachPlanning(actor);
  listId = planningListIds(actor.orgId)[1]!;
});

async function draft(extra: Record<string, string> = {}) {
  const before = await campaignPlans(actor, 'weekly');
  const id = randomUUID();
  await changeCampaign(member, { action: 'save', id: listId, expectedVersion: before.list.version, records: [{ id, values: { ...values, ...extra } }] });
  const after = await campaignPlans(actor, 'weekly');
  return { action: 'review' as const, id: listId, expectedVersion: after.list.version, recordId: id, recordVersion: 1, decision: 'approve' as const, notes: 'Reviewed copy and proposed timing; send remains held.' };
}

it('binds reviews to exact revisions and invalidates approval after a generic List edit', async () => {
  const request = await draft();
  const receipt = await changeCampaign(actor, request);

  expect(receipt).toMatchObject({ delivery: 'held', scheduledAt: '2099-01-01T17:00:00.000Z' });
  expect((await campaignPlans(member, 'weekly')).rows.find(r => r.id === request.recordId)).toMatchObject({ state: 'scheduled', review: { actorId: actor.userId, recordVersion: 1 } });

  await writeListRecords(member, { id: listId, expectedVersion: receipt.version, records: [{ id: request.recordId, values: { body: 'Changed after approval', status: 'Planned · dry run', reviewer: actor.userId } }] });

  expect((await campaignPlans(actor, 'weekly')).rows.find(r => r.id === request.recordId)).toMatchObject({ state: 'stale' });
  await expect(changeCampaign(actor, request)).rejects.toMatchObject({ status: 409 });
});

it('does not treat editable status/reviewer cells as authority and rejects member reviews', async () => {
  const request = await draft({ status: 'Planned · dry run', reviewer: actor.userId });

  expect((await campaignPlans(actor, 'weekly')).rows.find(r => r.id === request.recordId)).toMatchObject({ state: 'draft', review: null });
  await expect(changeCampaign(member, request)).rejects.toMatchObject({ status: 403 });
  await expect(changeCampaign(outsider, request)).rejects.toMatchObject({ status: 404 });
  await expect(campaignPlans({ ...actor, userId: outsider.userId }, 'weekly')).rejects.toMatchObject({ status: 404 });
});

it('rejects incomplete, ambiguous, overdue and invalid timezone schedules without writing an approval', async () => {
  const invalid: Record<string, string>[] = [{ audience: '' }, { proposed_at: '2099-01-01T09:00' }, { proposed_at: '2000-01-01T00:00:00Z' }, { timezone: 'Bad/Timezone' }, { sender: 'not-an-email' }];
  for (const extra of invalid) {
    const request = await draft(extra);

    await expect(changeCampaign(actor, request)).rejects.toMatchObject({ status: 400 });
    expect((await campaignPlans(actor, 'weekly')).rows.find(r => r.id === request.recordId)?.state).toBe('draft');
  }
});

it('serializes conflicting decisions and records cancellation without sending', async () => {
  const request = await draft();
  const outcomes = await Promise.allSettled([changeCampaign(actor, request), changeCampaign(actor, { ...request, decision: 'changes' })]);

  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);

  const current = await campaignPlans(actor, 'weekly');
  await changeCampaign(actor, { ...request, expectedVersion: current.list.version, decision: 'cancel' });

  expect((await campaignPlans(actor, 'weekly')).rows.find(r => r.id === request.recordId)).toMatchObject({ state: 'cancelled', review: { scheduledAt: null } });
});

it('marks an elapsed slot held and refuses to approve it again without a future time', async () => {
  const request = await draft();
  await changeCampaign(actor, request);
  vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));
  try {
    const current = await campaignPlans(actor, 'weekly');

    expect(current.rows.find(r => r.id === request.recordId)?.state).toBe('due');
    await expect(changeCampaign(actor, { ...request, expectedVersion: current.list.version })).rejects.toThrow('future time');
  } finally {
    vi.useRealTimers();
  }
});

it('does not disclose archived planning lists', async () => {
  const current = await campaignPlans(actor, 'weekly');
  await configureList(actor, { id: listId, expectedVersion: current.list.version, archived: true });

  await expect(campaignPlans(actor, 'weekly')).rejects.toMatchObject({ status: 404 });
});
