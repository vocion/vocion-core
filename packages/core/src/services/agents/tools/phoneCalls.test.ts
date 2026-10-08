import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { PHONE_CALL_TOOL, PHONE_CALLS_TOOL, phoneCallTools, telephonyInScope } from './phoneCalls';

/** The call-log tools: present only with a phone source in scope, answered by whichever account it is. */

vi.mock('@/libs/twilio/client', () => ({
  twilioCredentialsFor: async () => ({ accountSid: `AC${'a'.repeat(32)}`, authToken: 'a'.repeat(32) }),
  listTwilioCalls: async () => ({ ok: true, data: { calls: [{ sid: `CA${'1'.repeat(32)}`, from: '+19705550100', to: '+19705550199', direction: 'inbound', status: 'completed', startTime: '2026-10-07T10:00:00.000Z', endTime: null, durationSeconds: 60, answeredBy: null, callerName: null }], nextPage: null } }),
}));
vi.mock('@/libs/vonage/client', () => ({
  vonageCredentialsFor: async () => ({ apiKey: 'k', apiSecret: 's', signatureSecret: null, signatureMethod: 'sha256' }),
  listVonageCalls: async () => ({ ok: true, data: [{ id: 'vcall-1', from: '+19705550101', to: '+19705550199', direction: 'inbound', status: 'completed', startTime: '2026-10-08T09:00:00.000Z', endTime: null, durationSeconds: 30, price: null }] }),
}));

function ctx(sources: string[], kinds: Record<string, string>, allowed?: string[]): RuntimeContext {
  return { orgId: 'org_a', connectorSources: sources, sourceKinds: kinds, ...(allowed ? { allowedSourceSlugs: allowed } : {}), harnessConfig: {} } as unknown as RuntimeContext;
}

describe('phone_calls / phone_call', () => {
  it('are present only with a phone source in scope, and narrowed by the person\'s source ACL', () => {
    expect(phoneCallTools(ctx(['slack'], { slack: 'slack' }))).toEqual([]);
    expect(phoneCallTools(ctx(['calls'], { calls: 'twilio-voice' })).map(t => t.name)).toEqual([PHONE_CALLS_TOOL, PHONE_CALL_TOOL]);
    expect(telephonyInScope(ctx(['calls', 'vonage'], { calls: 'twilio-voice', vonage: 'vonage' }, ['vonage']))).toEqual(['vonage']);
  });

  it('list both accounts\' calls together, newest first', async () => {
    const [list] = phoneCallTools(ctx(['calls', 'vonage'], { calls: 'twilio-voice', vonage: 'vonage' }));
    const out = JSON.parse(await list!.invoke({}) as string);

    expect(out.ok).toBe(true);
    expect(out.calls.map((c: { provider: string; id: string }) => [c.provider, c.id])).toEqual([['vonage', 'vcall-1'], ['twilio', `CA${'1'.repeat(32)}`]]);
  });

  it('refuses a number it cannot read, in words', async () => {
    const [list] = phoneCallTools(ctx(['calls'], { calls: 'twilio-voice' }));

    expect(JSON.parse(await list!.invoke({ number: '555' }) as string)).toMatchObject({ ok: false, error: expect.stringMatching(/country code/) });
  });
});
