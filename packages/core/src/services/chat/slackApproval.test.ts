import type { PendingCard, ThreadApprovalDeps } from './slackApproval';
import type { ChatInbound } from '@/libs/surfaces/types';
import { describe, expect, it, vi } from 'vitest';
import { approvalFromThread } from './slackApproval';

const inbound: ChatInbound = { surface: 'slack', teamId: 'T1', channelId: 'C7', threadRef: '1.001', messageRef: '1.009', externalUserId: 'U9', text: 'ship it', isDirect: false };
const card: PendingCard = { runId: 7049, actionId: 'git.merge', input: { title: 'Merge Keyboard shortcuts in the library' }, title: 'Merge Keyboard shortcuts in the library' };

function deps(over: Partial<ThreadApprovalDeps> = {}): ThreadApprovalDeps {
  return {
    pending: vi.fn(async () => [card]),
    decisionSentence: vi.fn(async (_o: string, c: PendingCard, verb: 'approve' | 'reject') => `${verb} proposal #${c.runId}: ${c.title}`),
    consent: vi.fn(async (_o: string, _w: string, decision: string) => ({ said: decision.startsWith('approve'), quote: 'ship it' })),
    member: vi.fn(async () => ({ userId: 'usr-1', name: 'Chris', email: 'chris@northwind.example' })),
    decide: vi.fn(async () => ({ ok: true, what: 'It ran; Undo is in Vocion.' })),
    signInHint: (_surface: string, email: string | null) => `the email on your Slack profile (${email})`,
    ...over,
  };
}

describe('a reply in the Slack thread decides the card waiting there (backlog 057)', () => {
  it('approves as the member whose email is on the Slack profile, and says so', async () => {
    const d = deps();
    const out = await approvalFromThread('org_n', inbound, 474, d);

    expect(out).toEqual({ decided: true, verb: 'approve', runId: 7049, reply: 'Approved by Chris: "Merge Keyboard shortcuts in the library". It ran; Undo is in Vocion.' });
    expect(d.decide).toHaveBeenCalledWith('org_n', 7049, 'approve', 'usr-1', 'ship it');
  });

  it('decides nothing for a Slack user Vocion does not know, and says what to do', async () => {
    const d = deps({ member: vi.fn(async () => ({ userId: null, email: 'someone@elsewhere.example' })) });
    const out = await approvalFromThread('org_n', inbound, 474, d);

    expect(out).toMatchObject({ decided: false });
    expect(out!.reply).toContain('someone@elsewhere.example');
    expect(d.decide).not.toHaveBeenCalled();
  });

  it('reads a hold too, and falls through to a turn when the words decide nothing or no card waits', async () => {
    const hold = deps({ consent: vi.fn(async (_o: string, _w: string, decision: string) => ({ said: decision.startsWith('reject'), quote: 'hold it' })), decide: vi.fn(async () => ({ ok: true, what: 'It is held; the work goes back with your words as the note.' })) });

    expect(await approvalFromThread('org_n', { ...inbound, text: 'hold it' }, 474, hold)).toMatchObject({ decided: true, verb: 'reject' });
    expect(await approvalFromThread('org_n', { ...inbound, text: 'what does this change?' }, 474, deps({ consent: vi.fn(async () => ({ said: false, quote: null })) }))).toBeNull();
    expect(await approvalFromThread('org_n', inbound, 474, deps({ pending: vi.fn(async () => []) }))).toBeNull();
  });
});

describe('the same reply on another medium', () => {
  it('asks the medium who the sender is, and says how to become known there (email)', async () => {
    const member = vi.fn(async () => ({ userId: null, email: 'dana@northwind.example' }));
    const d = deps({ member, signInHint: (surface, email) => `${surface}:${email}` });
    const out = await approvalFromThread('org_a', { ...inbound, surface: 'email', externalUserId: 'dana@northwind.example' }, 12, d);

    expect(member).toHaveBeenCalledWith('org_a', 'dana@northwind.example', 'email');
    expect(out).toMatchObject({ decided: false, reply: expect.stringContaining('email:dana@northwind.example') });
  });
});
