import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { askSchema } = await import('@/models/Schema');
const { recordConnectAttempt } = await import('@/libs/connect/attempts');
const { claimsConnection, connectionTruthNote, connectionTurnNote, connectorsOfOptions } = await import('./connectionTruth');
const { connectionFloor } = await import('@/services/agents/effort');

const ORG = 'org_connect_truth';
const CONVERSATION = 41;

/** A sign-in card for GitHub, the way `escalate.ts` docks an `offer_connection` card. */
const GITHUB_CARD = [
  { id: 'connect:github', label: 'Log in with GitHub', href: '/api/connect/github/start?connector=github&returnTo=%2Fdashboard%2Fchat' },
  { id: 'paste:github', label: 'Use an API key instead', href: '/dashboard/connectors?add=github&paste=1' },
];

beforeAll(async () => {
  await db.insert(askSchema).values({ orgId: ORG, kind: 'setup', title: 'Connect GitHub', conversationId: CONVERSATION, options: GITHUB_CARD, status: 'open' } as never);
  // A walk for HubSpot in another conversation: never read here.
  await db.insert(askSchema).values({ orgId: ORG, kind: 'setup', title: 'Connect your team connectors', conversationId: CONVERSATION + 1, options: [{ id: 'start', label: 'Start', href: '/dashboard/chat?objective=connect-systems&named=hubspot' }], status: 'open' } as never);
});

describe('which systems a connect card asked for', () => {
  it('reads the sign-in card\'s options, a walk\'s named systems, and a link\'s connector', () => {
    expect(connectorsOfOptions(GITHUB_CARD)).toEqual(['github']);
    expect(connectorsOfOptions([{ id: 'start', href: '/dashboard/chat?objective=connect-systems&named=hubspot,slack' }])).toEqual(['hubspot', 'slack']);
    expect(connectorsOfOptions([{ id: 'approve' }, { id: 'reject' }])).toEqual([]);
  });
});

describe('a message that says it connected', () => {
  it('reads "it said it did connect", "done" and "I signed in" as a claim, and a complaint as none', () => {
    expect(claimsConnection('It said it did connect')).toBe(true);
    expect(claimsConnection('done')).toBe(true);
    expect(claimsConnection('ok I signed in to GitHub')).toBe(true);
    expect(claimsConnection('it is connected now')).toBe(true);
    expect(claimsConnection('it did not connect, the window closed')).toBe(false);
    expect(claimsConnection('what can you read from our repos?')).toBe(false);
  });
});

describe('the live state on the turn (2026-10-29)', () => {
  it('says GitHub is NOT connected, with why, when the person says it connected and nothing came back', async () => {
    const out = await connectionTurnNote({ orgId: ORG, conversationId: CONVERSATION, message: 'It said it did connect' });

    expect(out.claimed).toBe(true);
    expect(out.note).toContain('GitHub (github): NOT connected.');
    expect(out.note).toContain('No sign-in for it has come back to Vocion since the card went up');
    expect(out.note).toContain('Never say it is connected');
    // Only this conversation's cards: the HubSpot walk is another conversation's.
    expect(out.note).not.toContain('HubSpot');
  });

  it('gives the failed sign-in\'s own reason when one came back', async () => {
    await recordConnectAttempt({ orgId: ORG, userId: 'usr-truth', provider: 'github', providerLabel: 'GitHub', connector: 'github', ok: false, reason: 'access_denied' });
    const out = await connectionTurnNote({ orgId: ORG, conversationId: CONVERSATION, message: 'done' });

    expect(out.note).toMatch(/The last sign-in failed (just now|1 minute ago)/);
  });

  it('says nothing in a conversation that asked for no connection', async () => {
    const out = await connectionTurnNote({ orgId: ORG, conversationId: 999, message: 'It said it did connect' });

    expect(out).toEqual({ note: '', claimed: false });
  });

  it('says connected only when the state reads it', () => {
    const note = connectionTruthNote([{ connector: 'github', name: 'GitHub', connected: true, attempt: null, askedAt: null }], { claimed: true });

    expect(note).toContain('GitHub (github): connected.');
    expect(note).not.toContain('NOT connected');
  });

  it('keeps a turn about a claimed connection off Quick, and leaves every other turn alone', () => {
    expect(connectionFloor({ level: 'quick', reason: 'short reply' }, true)).toMatchObject({ level: 'standard', reason: 'checking a connection' });
    expect(connectionFloor({ level: 'quick', reason: 'short reply' }, false)).toMatchObject({ level: 'quick' });
    expect(connectionFloor({ level: 'deep', reason: 'big' }, true)).toMatchObject({ level: 'deep' });
  });
});

describe('a GitHub install waiting on an owner', () => {
  it('reads as requested and waiting, never as connected or failed, and is not asked again', () => {
    const now = new Date('2026-10-29T15:00:00Z');
    const note = connectionTruthNote([{ connector: 'github', name: 'GitHub', connected: false, askedAt: new Date(now.getTime() - 600_000), attempt: { ok: false, at: new Date(now.getTime() - 120_000), reason: 'installation_requested', summary: 'Install requested: waiting for an owner of northwind-co to approve it' } }], { claimed: false, now });

    expect(note).toContain('GitHub (github): NOT connected. Install requested: waiting for an owner of northwind-co to approve it (requested 2 minutes ago)');
    expect(note).toContain('Do not ask again');
    expect(note).not.toContain('failed');
  });
});
