import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * gmail.send's basis and stale check: the thread as Gmail holds it, read
 * through the thread fetch the `get_gmail_thread` read-through uses (mocked
 * here), and the mailbox's sent mail to the recipient (fetch, stubbed).
 */
const fetchGmailThreadDoc = vi.fn();
const findReplyThread = vi.fn();
vi.mock('@/libs/sources/gmail', () => ({ fetchGmailThreadDoc: (...args: unknown[]) => fetchGmailThreadDoc(...args) }));
vi.mock('@/services/mail/replyThread', () => ({ findReplyThread: (...args: unknown[]) => findReplyThread(...args) }));
vi.mock('@/libs/sources/googleAuth', () => ({ resolveGoogleAccessToken: async () => 'access-token' }));

const { gmailSendAction } = await import('./gmail-send');

const CTX = { orgId: 'org_mail', credentials: { email: 'rowan@northwind.example' }, proposedAt: new Date('2026-10-28T09:00:00.000Z') };
const input = gmailSendAction.inputSchema.parse({ to: 'Dana Reyes <dana@kestrel.example>', subject: 'Re: Pilot scope', body: 'Thursday works.', threadId: 't-42', draft: true });

type Msg = { id: string; from: string; at: string | null; sent: boolean; draft: boolean };
const DANA = 'Dana Reyes <dana@kestrel.example>';
const ROWAN = 'Rowan Hale <rowan@northwind.example>';
const base: Msg[] = [
  { id: 'm1', from: DANA, at: '2026-10-27T15:00:00.000Z', sent: false, draft: false },
  { id: 'm2', from: ROWAN, at: '2026-10-27T16:00:00.000Z', sent: true, draft: false },
  { id: 'm3', from: DANA, at: '2026-10-28T08:30:00.000Z', sent: false, draft: false },
];
const basis = { threadId: 't-42', messageIds: ['m1', 'm2', 'm3'], latestMessageId: 'm3', latestAt: '2026-10-28T08:30:00.000Z' };

function threadHolds(messages: Msg[]) {
  fetchGmailThreadDoc.mockResolvedValue({ externalId: 'gmail-thread:t-42', title: 'Pilot scope', content: '', metadata: { kind: 'gmail-thread', threadId: 't-42', messages } });
}

/**
 * The sent-mail search answers with these ids, each sent at the given time.
 * @param hits
 */
function sentSearchHolds(hits: Array<{ id: string; at: string }>) {
  const f = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/messages?')) {
      return { ok: true, status: 200, json: async () => ({ messages: hits.map(h => ({ id: h.id })) }) } as unknown as Response;
    }
    const hit = hits.find(h => u.includes(`/messages/${h.id}`));
    return { ok: true, status: 200, json: async () => ({ internalDate: hit ? String(Date.parse(hit.at)) : undefined }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  fetchGmailThreadDoc.mockReset();
  findReplyThread.mockReset().mockResolvedValue(null);
  sentSearchHolds([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('gmail.send: basis', () => {
  it('records the thread\'s messages and its latest settled message, drafts aside', async () => {
    threadHolds([...base, { id: 'd1', from: ROWAN, at: '2026-10-28T08:45:00.000Z', sent: false, draft: true }]);
    const out = await gmailSendAction.basisFor!(CTX, input);

    expect(out).toEqual({ threadId: 't-42', messageIds: ['m1', 'm2', 'm3', 'd1'], latestMessageId: 'm3', latestAt: '2026-10-28T08:30:00.000Z' });
  });

  it('a new email (no thread) records no thread', async () => {
    const fresh = gmailSendAction.inputSchema.parse({ to: 'dana@kestrel.example', subject: 'Pilot scope', body: 'Hello.' });
    const out = await gmailSendAction.basisFor!(CTX, fresh);

    expect(out).toEqual({ threadId: null, messageIds: [], latestMessageId: null, latestAt: null });
    expect(fetchGmailThreadDoc).not.toHaveBeenCalled();
  });
});

describe('gmail.send: stillHolds', () => {
  it('holds when nothing moved', async () => {
    threadHolds(base);

    await expect(gmailSendAction.stillHolds!(CTX, input, basis)).resolves.toBeNull();
  });

  it('the other side wrote again: stale, kept open for a redraft, saying who and when', async () => {
    threadHolds([...base, { id: 'm4', from: DANA, at: '2026-10-30T11:00:00.000Z', sent: false, draft: false }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({ line: 'Dana Reyes wrote again on Oct 30', keepOpen: true, code: 'thread_moved' });
    expect(out?.href).toContain('#all/t-42');
  });

  it('the owner already replied from Gmail: stale, said separately, and not kept open', async () => {
    threadHolds([...base, { id: 'm4', from: ROWAN, at: '2026-10-29T10:00:00.000Z', sent: true, draft: false }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({ line: 'You already replied in this thread on Oct 29', code: 'already_replied' });
    expect(out?.keepOpen).toBeUndefined();
  });

  it('they wrote again after the owner replied: both are said', async () => {
    threadHolds([...base, { id: 'm4', from: ROWAN, at: '2026-10-29T10:00:00.000Z', sent: true, draft: false }, { id: 'm5', from: DANA, at: '2026-10-30T11:00:00.000Z', sent: false, draft: false }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Reyes wrote again on Oct 30, after you replied on Oct 29');
  });

  it('a draft appeared in the thread', async () => {
    threadHolds([...base, { id: 'd1', from: ROWAN, at: '2026-10-29T12:00:00.000Z', sent: false, draft: true }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({ line: 'There is already a draft in this thread, saved on Oct 29', keepOpen: true, code: 'draft_exists' });
  });

  it('the owner emailed them in another thread since', async () => {
    threadHolds(base);
    const f = sentSearchHolds([{ id: 'x9', at: '2026-10-29T14:00:00.000Z' }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({ line: 'You emailed dana@kestrel.example on Oct 29, after this was drafted', code: 'emailed_since' });
    expect(decodeURIComponent(String((f.mock.calls[0] as unknown as [string])[0]))).toContain('in:sent to:dana@kestrel.example after:');
  });

  it('an email the owner sent after the inbound message but before the draft is not news to the draft', async () => {
    threadHolds(base);
    // Sent at 08:45: after Dana's 08:30 message, before the 09:00 draft.
    const f = sentSearchHolds([{ id: 'x9', at: '2026-10-28T08:45:00.000Z' }]);

    await expect(gmailSendAction.stillHolds!(CTX, input, basis)).resolves.toBeNull();
    expect(decodeURIComponent(String((f.mock.calls[0] as unknown as [string])[0]))).toContain(`after:${Math.floor(CTX.proposedAt.getTime() / 1000)}`);
  });

  it('a sent hit from before the basis on the same day does not count', async () => {
    threadHolds(base);
    sentSearchHolds([{ id: 'x9', at: '2026-10-28T08:00:00.000Z' }]);

    await expect(gmailSendAction.stillHolds!(CTX, input, basis)).resolves.toBeNull();
  });

  it('with no basis, compares against when it was proposed', async () => {
    threadHolds([...base, { id: 'm4', from: DANA, at: '2026-10-28T10:00:00.000Z', sent: false, draft: false }]);
    const out = await gmailSendAction.stillHolds!(CTX, input, null);

    expect(out?.line).toBe('Dana Reyes wrote again on Oct 28');
  });

  it('a Gmail that cannot be read throws, which core reads as "still holds"', async () => {
    fetchGmailThreadDoc.mockRejectedValue(new Error('Gmail thread fetch failed: 503'));

    await expect(gmailSendAction.stillHolds!(CTX, input, basis)).rejects.toThrow(/503/);
  });
});
