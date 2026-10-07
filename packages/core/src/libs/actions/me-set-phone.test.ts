/**
 * me.set_phone: a person keeps their own mobile number from chat (Chris, 2026-10-07). Against
 * PGlite; every name and number is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { meSetPhoneAction } = await import('./me-set-phone');
const { personBehind } = await import('@/services/chat/conversationChannel');
const { eq } = await import('drizzle-orm');

const ORG = 'proj-phone-test';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-ph', name: 'T', slug: 't-ph' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-ph', slug: 'ph', name: 'Phone' } as never);
  await db.insert(userSchema).values([{ id: 'usr-dana', name: 'Dana', email: 'dana@northwind.example' }, { id: 'usr-lee', name: 'Lee', email: 'lee@northwind.example', phone: '+19705550111' }] as never);
  await db.insert(accountMembershipSchema).values([{ accountId: 'acct-ph', userId: 'usr-dana', role: 'admin' }, { accountId: 'acct-ph', userId: 'usr-lee', role: 'member' }]);
});

const phoneOf = async (id: string) => (await db.select({ phone: userSchema.phone }).from(userSchema).where(eq(userSchema.id, id)))[0]!.phone;

describe('me.set_phone', () => {
  it('keeps the asker\'s own number, read into E.164, and Undo puts the old one back', async () => {
    const ctx = { orgId: ORG, invokedBy: 'usr-dana' };
    const input = meSetPhoneAction.inputSchema.parse({ phone: '(970) 555-0100' });

    expect(await meSetPhoneAction.precheck!(ctx, input)).toBeUndefined();

    const out = await meSetPhoneAction.execute(ctx, input);

    expect(out).toMatchObject({ userId: 'usr-dana', phone: '+19705550100', previous: null });
    expect(await phoneOf('usr-dana')).toBe('+19705550100');
    // A text from it is Dana's now.
    expect(await personBehind(ORG, 'sms:+19705550100')).toMatchObject({ userId: 'usr-dana' });

    await meSetPhoneAction.undo!(ctx, input, out);

    expect(await phoneOf('usr-dana')).toBeNull();
  });

  it('refuses another member\'s number, a non-number, and a turn with no person behind it', async () => {
    expect(await meSetPhoneAction.precheck!({ orgId: ORG, invokedBy: 'usr-dana' }, { phone: '+1 970 555 0111' })).toMatch(/another member/);
    expect(await meSetPhoneAction.precheck!({ orgId: ORG, invokedBy: 'usr-dana' }, { phone: '555-0100' })).toMatch(/not a phone number/);
    expect(await meSetPhoneAction.precheck!({ orgId: ORG, invokedBy: 'agent:product-manager' }, { phone: '+19705550100' })).toMatch(/Only a person/);
  });
});
