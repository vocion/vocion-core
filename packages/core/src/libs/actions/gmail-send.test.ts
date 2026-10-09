import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findReplyThread = vi.fn();
vi.mock('@/services/mail/replyThread', () => ({ findReplyThread: (...args: unknown[]) => findReplyThread(...args) }));

const { gmailSendAction, withSignature } = await import('./gmail-send');
const { nameOf, splitRecipients } = await import('@/libs/mail/recipients');

function res(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function parse(input: Record<string, unknown>) {
  return gmailSendAction.inputSchema.parse(input);
}
/**
 * The RFC 822 text a draft or send carried.
 * @param call
 */
function sentRaw(call: unknown[]): string {
  const init = call[1] as { body: string };
  const body = JSON.parse(init.body) as { raw?: string; message?: { raw: string } };
  return Buffer.from(body.raw ?? body.message!.raw, 'base64url').toString('utf8');
}

const THREAD = {
  threadId: 't-42',
  subject: 'Phase 2 priorities',
  href: 'https://mail.google.com/mail/u/rowan%40northwind.example/#all/t-42',
  counterpart: 'Dana Reyes <dana@kestrel.example>',
  mailbox: 'rowan@northwind.example',
  lastMessageAt: '2026-10-08T18:14:00.000Z',
  messages: [{ from: 'Dana Reyes <dana@kestrel.example>', at: '2026-10-08T18:14:00.000Z', snippet: 'Can we get everyone on a call early next week?' }],
  matchedBy: 'id' as const,
};

beforeEach(() => findReplyThread.mockReset().mockResolvedValue(null));

afterEach(() => vi.unstubAllGlobals());

describe('gmailSendAction', () => {
  it('sends a message as the connected user', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({ id: 'msg1', threadId: 't1' }));
    vi.stubGlobal('fetch', f);

    const out = await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'a@b.com', subject: 'Hi', body: 'hello' }));

    expect(out).toMatchObject({ mode: 'sent', messageId: 'msg1', to: 'a@b.com', link: 'https://mail.google.com/mail/#all/t1' });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('/messages/send');
  });

  it('creates a draft when draft:true (never sends), with a link to it', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({ id: 'draft1', message: { id: 'm1' } }));
    vi.stubGlobal('fetch', f);

    const out = await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x', email: 'rowan@northwind.example' } }, parse({ to: 'a@b.com', body: 'hi', draft: true }));

    expect(out).toMatchObject({ mode: 'draft', draftId: 'draft1', link: 'https://mail.google.com/mail/u/rowan%40northwind.example/#drafts?compose=m1' });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('/drafts');
    expect(f.mock.calls.some(c => String(c[0]).includes('/send'))).toBe(false);
  });

  it('threads a reply under the thread\'s last message: threadId, In-Reply-To and References', async () => {
    const f = vi.fn(async (url: string, _init?: RequestInit) => (url.includes('/threads/')
      ? res({ messages: [
          { payload: { headers: [{ name: 'Message-ID', value: '<a1@kestrel.example>' }] } },
          { payload: { headers: [{ name: 'Message-ID', value: '<a2@kestrel.example>' }, { name: 'References', value: '<a1@kestrel.example>' }] } },
        ] })
      : res({ id: 'draft9', message: { id: 'm9', threadId: 't-42' } })));
    vi.stubGlobal('fetch', f);

    const out = await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'Dana Reyes <dana@kestrel.example>', subject: 'Re: Phase 2 priorities', body: 'Monday works.', draft: true, threadId: 't-42', signature: 'Rowan Pike\nNorthwind' }));

    const draftCall = f.mock.calls.find(c => String(c[0]).endsWith('/drafts'))!;
    const posted = JSON.parse((draftCall[1] as { body: string }).body) as { message: { threadId?: string } };

    expect(posted.message.threadId).toBe('t-42');

    const raw = sentRaw(draftCall);

    expect(raw).toContain('In-Reply-To: <a2@kestrel.example>');
    expect(raw).toContain('References: <a1@kestrel.example> <a2@kestrel.example>');
    // The signature rides under the body, once.
    expect(raw).toMatch(/Monday works\.\r?\n\r?\nRowan Pike\nNorthwind$/);
    expect(out).toMatchObject({ mode: 'draft', threaded: true, threadId: 't-42' });
  });

  it('a reply proposed without a thread id still threads, by its recipient and Re: subject', async () => {
    findReplyThread.mockResolvedValue({ ...THREAD, matchedBy: 'subject' });
    const f = vi.fn(async (url: string, _init?: RequestInit) => (url.includes('/threads/')
      ? res({ messages: [{ payload: { headers: [{ name: 'Message-ID', value: '<a2@kestrel.example>' }] } }] })
      : res({ id: 'd', message: { id: 'm' } })));
    vi.stubGlobal('fetch', f);

    await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'dana@kestrel.example', subject: 'Re: Phase 2 priorities', body: 'ok', draft: true }));

    expect(findReplyThread).toHaveBeenCalledWith('o', { threadId: undefined, to: 'dana@kestrel.example', subject: 'Re: Phase 2 priorities' });
    expect(String(f.mock.calls[0]![0])).toContain('/threads/t-42');
  });

  it('keeps Gmail\'s refusal word for word, so the card can read it and Details can show it', async () => {
    const body = { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } };
    vi.stubGlobal('fetch', vi.fn(async () => res(body, false, 403)));

    await expect(gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'a@b.com', body: 'hi', draft: true }))).rejects.toThrow(/^Gmail draft failed: 403 .*ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
  });

  it('refuses without credentials', async () => {
    await expect(gmailSendAction.execute({ orgId: 'o' }, parse({ to: 'a@b.com', body: 'hi' }))).rejects.toThrow(/credentials/);
  });

  it('presents a reply draft as the outbound artifact: who, the thread, the copy, the signature — never "Send 1"', async () => {
    findReplyThread.mockResolvedValue(THREAD);

    const card = await gmailSendAction.reviewCard!({ orgId: 'o' }, parse({ to: 'dana@kestrel.example', cc: 'Iris Nakamura <iris@kestrel.example>', subject: 'Re: Phase 2 priorities', body: 'hello', draft: true, threadId: 't-42', signature: 'Rowan' }));

    expect(card.title).toBe('Draft a reply to Dana Reyes');
    expect(card.object?.title).toBe('Draft a reply to Dana Reyes');
    expect(card.content).toEqual([{ kind: 'email', id: 'message', label: 'Email', subject: 'Re: Phase 2 priorities', body: 'hello' }]);
    expect(JSON.stringify(card)).not.toMatch(/Send 1/);
    expect(card.outbound).toMatchObject({
      channel: 'email',
      mode: 'draft',
      to: ['dana@kestrel.example'],
      cc: ['Iris Nakamura <iris@kestrel.example>'],
      from: 'rowan@northwind.example',
      recipientsEditable: true,
      signature: 'Rowan',
      thread: { subject: 'Phase 2 priorities', messages: THREAD.messages },
      doneLabel: 'Draft created',
      openLabel: 'Open in Gmail',
    });
    expect(card.verbs).toEqual({ approve: 'Create draft in Gmail', reject: 'Reject' });
  });

  it('says what will happen: a new email sent, not a draft, is "Send an email to …" with Send', async () => {
    const card = await gmailSendAction.reviewCard!({ orgId: 'o' }, parse({ to: 'Rowan Pike <rowan@tideline.example>', subject: 'Hi', body: 'hello' }));

    expect(card.title).toBe('Send an email to Rowan Pike');
    expect(card.outbound?.thread).toBeUndefined();
    expect(card.verbs).toEqual({ approve: 'Send', reject: 'Reject' });
  });

  it('maps content edits back onto subject, body and recipients and nothing else', () => {
    const input = parse({ to: 'a@b.com', subject: 'Hi', body: 'hello', cc: 'c@b.com' });

    const edited = gmailSendAction.applyContentEdits!(input, [{ id: 'message', body: 'rewritten', cc: 'c@b.com, Dana Reyes <dana@kestrel.example>' }]);

    expect(edited).toMatchObject({ to: 'a@b.com', cc: 'c@b.com, Dana Reyes <dana@kestrel.example>', subject: 'Hi', body: 'rewritten' });
    // Emptying To is not a recipient change; emptying Cc is.
    expect(gmailSendAction.applyContentEdits!(input, [{ id: 'message', to: '', cc: '' }])).toMatchObject({ to: 'a@b.com', cc: undefined });
    // An edit against an id the card never issued changes nothing.
    expect(gmailSendAction.applyContentEdits!(input, [{ id: 'other', body: 'x' }])).toEqual(input);
  });

  it('undoes a draft by deleting it, and refuses to promise an unsend', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({}, true, 204));
    vi.stubGlobal('fetch', f);
    const input = parse({ to: 'a@b.com', body: 'hi', draft: true });

    expect(gmailSendAction.canUndo!({ mode: 'draft', draftId: 'd1' })).toBe(true);
    expect(gmailSendAction.canUndo!({ mode: 'sent', messageId: 'm1' })).toBe(false);
    await expect(gmailSendAction.undo!({ orgId: 'o', credentials: { token: 'x' } }, input, { mode: 'draft', draftId: 'd1' })).resolves.toEqual({ deletedDraftId: 'd1' });
    expect(f.mock.calls[0]![0]).toContain('/drafts/d1');
    expect((f.mock.calls[0]![1] as { method: string }).method).toBe('DELETE');
    await expect(gmailSendAction.undo!({ orgId: 'o', credentials: { token: 'x' } }, input, { mode: 'sent' })).rejects.toThrow(/cannot be unsent/);
  });

  it('dedups on the recipient, not the wording, so a re-firing automation cannot stack drafts', () => {
    // The model rewrites the subject every pass; the recipient is the identity.
    const a = gmailSendAction.dedupKeyFor!(parse({ to: 'dana.reyes@kestrelcapital.example', subject: 'AWS reconnect — next steps', body: 'x' }));
    const b = gmailSendAction.dedupKeyFor!(parse({ to: ' Dana.Reyes@KestrelCapital.Example ', subject: 'Kestrel + Northwind intros', body: 'y', draft: true }));
    const named = gmailSendAction.dedupKeyFor!(parse({ to: 'Dana Reyes <dana.reyes@kestrelcapital.example>', body: 'z' }));

    expect(a).toBe('gmail.send:dana.reyes@kestrelcapital.example');
    expect(b).toBe(a);
    expect(named).toBe(a);
    // A different recipient is a different queue item.
    expect(gmailSendAction.dedupKeyFor!(parse({ to: 'other@b.com', subject: 'Hi', body: 'x' }))).not.toBe(a);
  });
});

describe('recipients and signature', () => {
  it('splits on commas outside angle brackets and reads names', () => {
    expect(splitRecipients('a@x.example, "Reyes, Dana" <d@y.example>')).toEqual(['a@x.example', '"Reyes, Dana" <d@y.example>']);
    expect(nameOf('"Reyes, Dana" <d@y.example>')).toBe('Dana Reyes');
    expect(nameOf('Dana Reyes <d@y.example>')).toBe('Dana Reyes');
    expect(nameOf('d@y.example')).toBeNull();
  });

  it('adds the signature once, in the body\'s own format', () => {
    expect(withSignature('Hi', 'Rowan')).toBe('Hi\n\nRowan');
    expect(withSignature('Hi\n\nRowan', 'Rowan')).toBe('Hi\n\nRowan');
    expect(withSignature('<p>Hi</p>', 'Rowan\nNorthwind')).toBe('<p>Hi</p><p>Rowan<br>Northwind</p>');
    expect(withSignature('Hi', undefined)).toBe('Hi');
  });
});
