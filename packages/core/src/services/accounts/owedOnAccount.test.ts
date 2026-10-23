/**
 * "What do I owe on <client>?" (2026-10-23): the answer lived in Review — a
 * post-call follow-up email another agent drafted, approved and sitting in
 * Gmail Drafts with the presented deck attached — and the lead never saw it.
 * The account read joins an account to every kind of open work by its
 * addresses, domains and data room. Fixtures are fictional.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { createDataRoom } = await import('@/services/DataRoomService');
const { addressesIn, attachmentLine, namedAddresses, nextMoveFor, readOwedOnAccount, resolveAccount, touchesAccount } = await import('./owedOnAccount');
const { renderOwed } = await import('@/services/agents/tools/owedOnAccount');
const { FINISH_THE_READ } = await import('@/services/agents/finishTheRead');

const ORG = 'proj_owed_kestrel';
const USER = 'user_owed_alex';
const NOW = new Date('2026-10-23T20:00:00Z');

describe('the account, as typed facts', () => {
  it('reads addresses and company domains from what the person named, never a personal host as a company', () => {
    expect(namedAddresses('dana@kestrel.example and kestrel-cap.example')).toEqual({ emails: ['dana@kestrel.example'], domains: ['kestrel.example', 'kestrel-cap.example'] });
    expect(namedAddresses('lee@gmail.com')).toEqual({ emails: ['lee@gmail.com'], domains: [] });
    expect(namedAddresses('Kestrel')).toEqual({ emails: [], domains: [] });
  });

  it('reads the addresses a structured value carries, and none quoted in its prose', () => {
    expect(addressesIn({ to: 'Dana Reyes <dana@kestrel.example>, lee@kestrel.example', cc: 'sam@northwind.example', body: 'loop in pat@elsewhere.example' }).sort()).toEqual(['dana@kestrel.example', 'lee@kestrel.example', 'sam@northwind.example']);
    expect(addressesIn({ externalAttendees: ['dana@kestrel.example'], why: 'mentions pat@elsewhere.example' })).toEqual(['dana@kestrel.example']);
  });

  it('touches the account by domain, by exact address, or by its room id', () => {
    const id = { domains: ['kestrel.example'], emails: ['pat@gmail.com'], room: { id: 7, title: 'Kestrel', client: 'Kestrel' } };

    expect(touchesAccount({ to: 'dana@kestrel.example' }, id)).toBe(true);
    expect(touchesAccount({ to: 'pat@gmail.com' }, id)).toBe(true);
    expect(touchesAccount({ roomId: 7, title: 'follow-up' }, id)).toBe(true);
    expect(touchesAccount({ to: 'someone@gmail.com' }, id)).toBe(false);
    expect(touchesAccount({ subject: 'Kestrel follow-up' }, id)).toBe(false);
  });

  it('says the one move that finishes each kind of run', () => {
    expect(nextMoveFor({ actionId: 'meeting.draft_followup', status: 'pending', input: {} })).toBe('approve to draft the call\'s follow-up');
    expect(nextMoveFor({ actionId: 'gmail.send', status: 'pending', input: { draft: true } })).toBe('approve to put the draft in Gmail');
    expect(nextMoveFor({ actionId: 'gmail.send', status: 'failed', input: {} })).toMatch(/press it again/);
    expect(attachmentLine([{ artifactId: 12, title: 'Deck.pdf', stale: null }])).toBe('Attaches Deck.pdf (#12)');
  });

  it('every agent is told to finish its reads, and where owed work lives', () => {
    expect(FINISH_THE_READ).toContain('Never end by offering to read something you could read now');
    expect(FINISH_THE_READ).toContain('owed_on_account');
  });
});

describe('what is owed on an account', () => {
  let roomId = 0;
  let pdfId = 0;
  let deckId = 0;

  beforeAll(async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct_owed', name: 'Northwind', slug: 'northwind-owed' });
    await db.insert(userSchema).values({ id: USER, email: 'alex@northwind.example', name: 'Alex Rivera' });
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_owed', slug: 'revenue-owed', name: 'Revenue Team' });
    const room = await createDataRoom(ORG, USER, { title: 'Kestrel Capital — AI rollout', client: 'Kestrel Capital', aliases: ['Kestrel'], domains: ['kestrel.example'], cast: [{ name: 'Dana Reyes', email: 'dana@kestrel.example' }] });
    roomId = room.id;
    // The presented deck, edited after its PDF was printed: v3 now, PDF of v2.
    const [deck] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'deck', title: 'Kestrel proposal review', spec: {}, currentVersion: 3 }).returning();
    deckId = deck!.id;
    const [pdf] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'file', title: 'Kestrel proposal review.pdf', spec: { exportedFrom: { artifactId: deckId, version: 2, format: 'pdf' } }, currentVersion: 1 }).returning();
    pdfId = pdf!.id;
    await db.insert(actionRunSchema).values([
      // The post-call follow-up, approved as a Gmail draft: the person still sends it.
      { orgId: ORG, actionId: 'gmail.send', status: 'done', input: { to: 'dana@kestrel.example, lee@kestrel.example', cc: 'sam@northwind.example', subject: 'Thank you, and the scope you are taking back', body: 'Dana, Lee, …', draft: true, attachments: [{ artifactId: pdfId }] }, result: { link: 'https://mail.google.com/mail/u/alex%40northwind.example/#drafts?compose=abc123', linkLabel: 'Open in Gmail' }, proposal: { agentSlug: 'revenue-lead' }, createdAt: new Date('2026-10-23T15:00:00Z'), executedAt: new Date('2026-10-23T18:00:00Z') },
      // The call's follow-up card from meeting-followup, waiting on Review.
      { orgId: ORG, actionId: 'meeting.draft_followup', status: 'pending', input: { documentId: 1, meetingKey: 'alex@northwind.example:2026-10-22T20:00:00.000Z', title: 'Proposal review', externalAttendees: 'dana@kestrel.example', roomId }, proposal: { agentSlug: 'followup-writer' }, createdAt: new Date('2026-10-22T22:00:00Z') },
      // A draft that failed on a permission, to be pressed again.
      { orgId: ORG, actionId: 'gmail.send', status: 'failed', input: { to: 'lee@kestrel.example', subject: 'Intro', body: 'Hi', draft: true }, error: 'Gmail draft failed: 403 insufficient scopes', createdAt: new Date('2026-10-21T15:00:00Z') },
      // Not this account.
      { orgId: ORG, actionId: 'gmail.send', status: 'pending', input: { to: 'pat@bellwater.example', subject: 'Hello', body: 'mentions dana@kestrel.example' }, createdAt: new Date('2026-10-22T15:00:00Z') },
      // Sent, not a draft: nothing owed.
      { orgId: ORG, actionId: 'gmail.send', status: 'done', input: { to: 'dana@kestrel.example', subject: 'Agenda', body: 'x', draft: false }, createdAt: new Date('2026-10-20T15:00:00Z') },
    ]);
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'follow-up', label: 'Follow-up' }).returning();
    await db.insert(businessObjectSchema).values([
      { orgId: ORG, typeId: type!.id, title: 'Send Kestrel the security answers', status: 'open', metadata: { contact: 'lee@kestrel.example' } },
      { orgId: ORG, typeId: type!.id, title: 'Done already', status: 'done', metadata: { contact: 'lee@kestrel.example' } },
      { orgId: ORG, typeId: type!.id, title: 'Someone else', status: 'open', metadata: { contact: 'pat@bellwater.example' } },
    ]);
  });

  it('resolves a company name to its room, domains and cast', async () => {
    const id = await resolveAccount(ORG, 'Kestrel');

    expect(id.room?.id).toBe(roomId);
    expect(id.domains).toContain('kestrel.example');
    expect(id.emails).toContain('dana@kestrel.example');
  });

  it('finds the unsent draft first, then Review, then the rows owed — and says the deck changed since its PDF', async () => {
    const read = await readOwedOnAccount({ orgId: ORG, about: 'Kestrel', now: NOW });
    const sections = read.items.map(i => i.section);

    expect(sections[0]).toBe('draft');
    expect(read.items[0]).toMatchObject({ next: 'send the Gmail draft', href: expect.stringContaining('#drafts?compose=abc123'), by: 'revenue-lead' });
    expect(read.items[0]!.detail).toContain(`v2; it is at v3 now`);
    expect(read.items.filter(i => i.section === 'review').map(i => i.next)).toEqual([expect.stringMatching(/press it again/), 'approve to draft the call\'s follow-up']);
    expect(read.items.filter(i => i.section === 'follow_up').map(i => i.title)).toEqual(['Send Kestrel the security answers']);
    expect(read.items.some(i => i.title.includes('Hello') || i.title.includes('Agenda'))).toBe(false);
  });

  it('reads by domain alone, and renders each item with its next move and link', async () => {
    const read = await readOwedOnAccount({ orgId: ORG, about: 'kestrel.example', now: NOW });
    const text = renderOwed(read, 'America/Los_Angeles');

    expect(text).toContain('Drafts waiting for you to send (1):');
    expect(text).toContain('next: send the Gmail draft');
    expect(text).toContain('In Review (2):');
    expect(text).toContain('Follow-ups owed (1):');
  });

  it('says plainly when nothing ties the name to the records', async () => {
    const read = await readOwedOnAccount({ orgId: ORG, about: 'Zephyr', now: NOW });

    expect(read.items).toEqual([]);
    expect(read.unavailable[0]).toMatch(/Nothing ties "Zephyr"/);
  });
});
