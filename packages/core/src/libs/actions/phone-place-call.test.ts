import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNeverAuto } from './neverAuto';
import { phonePlaceCallAction } from './phone-place-call';

/** Placing a call: always a person's decision, never undone, from the workspace's Twilio account. Numbers on 555. */

const placed: unknown[] = [];

vi.mock('@/libs/twilio/client', () => ({
  twilioCredentialsFor: async (orgId: string) => (orgId === 'org_a' ? { accountSid: `AC${'a'.repeat(32)}`, authToken: 'a'.repeat(32) } : null),
  placeTwilioCall: async (creds: { accountSid: string }, call: unknown) => {
    placed.push({ account: creds.accountSid, call });
    return { ok: true, data: { sid: `CA${'9'.repeat(32)}`, status: 'queued' } };
  },
}));

afterEach(() => {
  placed.length = 0;
});

const input = { to: '(970) 555-0100', from: '+1 970 555 0199', say: 'Your Northwind order is ready for pickup.' };

describe('phone.place_call', () => {
  it('waits for a person every time, and no trust rule can release it', () => {
    expect(phonePlaceCallAction.approvalRequired).toBe(true);
    expect(phonePlaceCallAction.external).toBe(true);
    expect(phonePlaceCallAction.undo).toBeUndefined();
    expect(isNeverAuto(phonePlaceCallAction)).toBe(true);
  });

  it('refuses at the door a number it cannot dial, and a workspace with no phone account', async () => {
    await expect(phonePlaceCallAction.precheck!({ orgId: 'org_a' }, { ...input, to: '555-0100' })).resolves.toMatch(/not a phone number/);
    await expect(phonePlaceCallAction.precheck!({ orgId: 'org_none' }, input)).resolves.toMatch(/Connect Twilio/);
    await expect(phonePlaceCallAction.precheck!({ orgId: 'org_a' }, input)).resolves.toBeUndefined();
  });

  it('shows the words the call will say, editable, and marks it irreversible', async () => {
    const card = await phonePlaceCallAction.reviewCard!({ orgId: 'org_a' }, input);

    expect(card.badges).toContainEqual({ label: 'Irreversible', tone: 'warn' });
    expect(card.content).toEqual([{ kind: 'message', id: 'say', label: 'Message', body: input.say }]);
    expect(phonePlaceCallAction.applyContentEdits!(input, [{ id: 'say', body: 'Ready Friday.' }])).toMatchObject({ say: 'Ready Friday.' });
  });

  it('calls in E.164 from the workspace\'s own account', async () => {
    const out = await phonePlaceCallAction.execute({ orgId: 'org_a' }, input);

    expect(out).toMatchObject({ placed: true, callSid: `CA${'9'.repeat(32)}` });
    expect(placed).toEqual([{ account: `AC${'a'.repeat(32)}`, call: { from: '+19705550199', to: '+19705550100', say: input.say } }]);
  });
});
