/**
 * The notification kinds core declares itself: a decision near its deadline
 * reaches its owner on the existing path with nothing declared, a workspace
 * can replace or switch the kind off, and the settings page lists it like any
 * other kind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { accountMembershipSchema, eventLogSchema, notificationDeliverySchema, notificationRuleSchema, notificationSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { emitEvent } = await import('@/services/EventService');
const { listKinds } = await import('./inbox');
const { CORE_NOTIFICATION_RULES } = await import('./rules');

const ACCOUNT = 'acct-core-kinds';
const ORG = 'proj-core-kinds';
const OTHER = 'proj-core-kinds-other';
const ADA = 'usr-core-ada';
const BEN = 'usr-core-ben';

const PAYLOAD = {
  ownerUserId: BEN,
  ownerSource: 'team',
  count: 2,
  dueSoon: 2,
  held: 0,
  applied: 0,
  title: '2 decisions need you: 2 due soon',
  body: '• “Renew Northwind?” is due in 6h — then Approve applies unless you answer\n• “Publish the Contoso case study?” is due in 6h — then Approve applies unless you answer',
  link: '/dashboard/inbox',
  dedupe: `${BEN}:2026-10-08T12:00`,
};

beforeEach(async () => {
  await db.delete(notificationDeliverySchema);
  await db.delete(notificationSchema);
  await db.delete(notificationRuleSchema);
  await db.delete(eventLogSchema);
  await db.delete(projectSchema).where(eq(projectSchema.accountId, ACCOUNT));
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.accountId, ACCOUNT));
  await db.delete(userSchema).where(eq(userSchema.id, ADA));
  await db.delete(userSchema).where(eq(userSchema.id, BEN));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, ACCOUNT));
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-core-kinds' });
  await db.insert(userSchema).values([{ id: ADA, email: 'ada@northwind.example', name: 'Ada' }, { id: BEN, email: 'ben@northwind.example', name: 'Ben' }]);
  await db.insert(accountMembershipSchema).values([{ accountId: ACCOUNT, userId: ADA, role: 'admin' }, { accountId: ACCOUNT, userId: BEN, role: 'member' }]);
  await db.insert(projectSchema).values([
    { id: ORG, accountId: ACCOUNT, slug: 'northwind-ops', name: 'Northwind Ops', accountableUserId: ADA },
    { id: OTHER, accountId: ACCOUNT, slug: 'northwind-sales', name: 'Northwind Sales' },
  ]);
});

describe('decision-escalated — core\'s own kind', () => {
  it('reaches the owner the event names, with nothing declared, opening Needs you', async () => {
    await emitEvent({ orgId: ORG, type: 'decision.escalated', payload: PAYLOAD, dedupeKey: 'decision.escalated:1' });
    const rows = await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: BEN, kind: 'decision-escalated', title: PAYLOAD.title, eventType: 'decision.escalated' });
    expect(rows[0]!.link).toBe('/w/northwind-ops/dashboard/inbox');
    expect(rows[0]!.body).toMatch(/Renew Northwind/);
  });

  it('is one notification per escalation, never one per raise', async () => {
    await emitEvent({ orgId: ORG, type: 'decision.escalated', payload: PAYLOAD, dedupeKey: 'decision.escalated:1' });
    await emitEvent({ orgId: ORG, type: 'decision.escalated', payload: PAYLOAD, dedupeKey: 'decision.escalated:1:again' });

    expect(await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG))).toHaveLength(1);
  });

  it('a workspace that declares the same kind replaces it — `status: disabled` switches it off, there only', async () => {
    const [core] = CORE_NOTIFICATION_RULES;
    await db.insert(notificationRuleSchema).values({ orgId: ORG, kind: core!.kind, label: core!.label, event: core!.event, status: 'disabled', config: core! });

    await emitEvent({ orgId: ORG, type: 'decision.escalated', payload: PAYLOAD, dedupeKey: 'decision.escalated:1' });
    await emitEvent({ orgId: OTHER, type: 'decision.escalated', payload: { ...PAYLOAD, ownerUserId: ADA }, dedupeKey: 'decision.escalated:2' });

    expect(await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, ORG))).toHaveLength(0);
    expect((await db.select().from(notificationSchema).where(eq(notificationSchema.orgId, OTHER))).map(n => n.userId)).toEqual([ADA]);
  });

  it('is listed in settings like any declared kind, until a workspace declares its own', async () => {
    expect((await listKinds(ORG)).find(k => k.kind === 'decision-escalated')).toMatchObject({ source: 'core', status: 'active', label: 'Decisions due' });

    const [core] = CORE_NOTIFICATION_RULES;
    await db.insert(notificationRuleSchema).values({ orgId: ORG, kind: core!.kind, label: 'Overdue decisions', event: core!.event, source: 'workspace', config: { ...core!, label: 'Overdue decisions' } });

    expect((await listKinds(ORG)).filter(k => k.kind === 'decision-escalated')).toEqual([expect.objectContaining({ source: 'workspace', label: 'Overdue decisions' })]);
  });
});
