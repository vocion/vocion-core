import type { PendingCard, ThreadApprovalDeps } from './slackApproval';
import type { ChatInbound } from '@/libs/surfaces/types';
import { describe, expect, it, vi } from 'vitest';
import { approvalFromThread, askedInLastMessage, cardTitle, settledNote } from './slackApproval';

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
    withdraw: vi.fn(async () => true),
    ...over,
  };
}

describe('a reply in the Slack thread decides the card waiting there (backlog 057)', () => {
  it('approves as the member whose email is on the Slack profile, and says so', async () => {
    const d = deps();
    const out = await approvalFromThread('org_n', inbound, 474, d);

    expect(out).toEqual({ decided: true, verb: 'approve', runId: 7049, title: 'Merge Keyboard shortcuts in the library', reply: 'Approved by Chris: "Merge Keyboard shortcuts in the library". It ran; Undo is in Vocion.' });
    expect(d.decide).toHaveBeenCalledWith('org_n', 7049, 'approve', 'usr-1', 'ship it');
  });

  it('reads a short reply against the agent\'s ask, which in a thread was its last message', async () => {
    const d = deps();
    await approvalFromThread('org_n', { ...inbound, text: 'yes' }, 474, d, 'One more hold: the cost check. Reply build it to start.');

    expect(d.consent).toHaveBeenCalledWith('org_n', 'yes', 'approve proposal #7049: Merge Keyboard shortcuts in the library', 'One more hold: the cost check. Reply build it to start.');
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

describe('a reply settles only the ask it answers (2026-11-11)', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 17, minute));
  // The agent asked at 17:27; the thread then moved on: it said more, and the person wrote again.
  const stale: PendingCard = { runId: 881, actionId: 'mcp.act', input: { summary: 'Pass on the yes to build the export ticket, with a condition.' }, title: 'Pass on the yes to build the export ticket, with a condition.', createdAt: at(27), filedHere: true, filedBy: 'agent:factory-desk' };
  const movedOn = [
    { role: 'user', createdAt: at(26) },
    { role: 'assistant', createdAt: at(28) },
    { role: 'assistant', createdAt: at(55) },
  ];

  it('does not run an older proposal on a later "approve", and withdraws it so no queue runs it either', async () => {
    const d = deps({ pending: vi.fn(async () => [stale]), consent: vi.fn(async () => ({ said: true, quote: 'then approve' })) });
    const out = await approvalFromThread('org_n', { ...inbound, text: 'for the import ticket make sure the design covers the API, then approve. then approve the billing and export tickets' }, 474, d, 'The export ticket moved to review.', movedOn);

    expect(d.decide).not.toHaveBeenCalled();
    expect(d.consent).not.toHaveBeenCalled();
    expect(d.withdraw).toHaveBeenCalledWith('org_n', stale, expect.stringContaining('the thread moved on'));
    expect(out).toEqual({ decided: false, reply: null, withdrawn: [stale] });
  });

  it('reads a proposal as stale once the person has written since, or the agent has said something after asking', () => {
    expect(askedInLastMessage(stale, [{ role: 'user', createdAt: at(26) }, { role: 'assistant', createdAt: at(28) }])).toBe(true);
    expect(askedInLastMessage(stale, [{ role: 'assistant', createdAt: at(28) }, { role: 'user', createdAt: at(40) }, { role: 'assistant', createdAt: at(41) }])).toBe(false);
    expect(askedInLastMessage(stale, movedOn)).toBe(false);
    // A card with no filing time on it cannot be called stale.
    expect(askedInLastMessage(card, movedOn)).toBe(true);
  });

  it('still settles the ask in the agent\'s latest message, and leaves alone a stale card the agent did not file here', async () => {
    const current: PendingCard = { ...stale, runId: 902, createdAt: at(56) };
    const followed: PendingCard = { ...stale, runId: 870, filedHere: false, filedBy: 'factory:planner' };
    const d = deps({ pending: vi.fn(async () => [current, stale, followed]) });
    const out = await approvalFromThread('org_n', { ...inbound, text: 'yes' }, 474, d, 'Reply yes to pass it on.', [...movedOn, { role: 'assistant', createdAt: at(57) }]);

    expect(d.decide).toHaveBeenCalledTimes(1);
    expect(d.decide).toHaveBeenCalledWith('org_n', 902, 'approve', 'usr-1', 'ship it');
    expect(d.withdraw).toHaveBeenCalledTimes(1);
    expect(d.withdraw).toHaveBeenCalledWith('org_n', stale, expect.any(String));
    expect(out).toMatchObject({ decided: true, runId: 902, withdrawn: [stale] });
  });
});

describe('what a proposal is called, and what the turn after a reply is told', () => {
  it('names a proposal by its summary when it has no title, never by its action and number', () => {
    expect(cardTitle('mcp.act', 881, { summary: 'Pass on the yes to build the export ticket. It carries one condition.' })).toBe('Pass on the yes to build the export ticket');
    expect(cardTitle('git.merge', 7049, { title: 'Merge it', summary: 'Other words.' })).toBe('Merge it');
    expect(cardTitle('git.merge', 7049, {})).toBe('git.merge #7049');
  });

  it('tells the turn what ran on their word and what it returned, so it is neither repeated nor asked again', () => {
    const note = settledNote({ decided: true, verb: 'approve', runId: 902, title: 'Pass on the yes to build the export ticket.', reply: 'Approved by Chris: "Pass on the yes to build the export ticket.". It ran; Undo is in Vocion.', result: '{"status":"building"}' });

    expect(note).toContain('proposal #902, "Pass on the yes to build the export ticket."');
    expect(note).toContain('What it returned: {"status":"building"}');
    expect(note).toContain('Do not run it, propose it or ask about it again');
    expect(note).toContain('do everything else their message asks');
  });

  it('tells the turn what was withdrawn and not run, and says nothing when nothing was settled', () => {
    const note = settledNote({ decided: false, reply: null, withdrawn: [{ runId: 881, actionId: 'mcp.act', input: {}, title: 'Pass on the yes' }] });

    expect(note).toContain('NOT run');
    expect(note).toContain('proposal #881 "Pass on the yes"');
    expect(settledNote(null)).toBe('');
  });
});
