import { afterEach, describe, expect, it, vi } from 'vitest';
import { gmailSendAction } from './gmail-send';

function res(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' } as unknown as Response;
}
function parse(input: Record<string, unknown>) {
  return gmailSendAction.inputSchema.parse(input);
}

afterEach(() => vi.unstubAllGlobals());

describe('gmailSendAction', () => {
  it('sends a message as the connected user', async () => {
    const f = vi.fn(async () => res({ id: 'msg1', threadId: 't1' }));
    vi.stubGlobal('fetch', f);

    const out = await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'a@b.com', subject: 'Hi', body: 'hello' }));

    expect(out).toMatchObject({ mode: 'sent', messageId: 'msg1', to: 'a@b.com' });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('/messages/send');
  });

  it('creates a draft when draft:true (never sends)', async () => {
    const f = vi.fn(async () => res({ id: 'draft1', message: { id: 'm1' } }));
    vi.stubGlobal('fetch', f);

    const out = await gmailSendAction.execute({ orgId: 'o', credentials: { token: 'x' } }, parse({ to: 'a@b.com', body: 'hi', draft: true }));

    expect(out).toMatchObject({ mode: 'draft', draftId: 'draft1' });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain('/drafts');
  });

  it('refuses without credentials', async () => {
    await expect(gmailSendAction.execute({ orgId: 'o' }, parse({ to: 'a@b.com', body: 'hi' }))).rejects.toThrow(/credentials/);
  });

  it('presents the email as typed card content with per-object verbs', async () => {
    const card = await gmailSendAction.reviewCard!({ orgId: 'o' }, parse({ to: 'a@b.com', subject: 'Hi', body: 'hello' }));

    expect(card.content).toEqual([{ kind: 'email', id: 'message', label: 'Send 1', subject: 'Hi', body: 'hello' }]);
    expect(card.verbs).toEqual({ approve: 'Approve & send', reject: 'Reject' });
  });

  it('maps content edits back onto subject/body and nothing else', () => {
    const input = parse({ to: 'a@b.com', subject: 'Hi', body: 'hello', cc: 'c@b.com' });

    const edited = gmailSendAction.applyContentEdits!(input, [{ id: 'message', body: 'rewritten' }]);

    expect(edited).toMatchObject({ to: 'a@b.com', cc: 'c@b.com', subject: 'Hi', body: 'rewritten' });
    // An edit against an id the card never issued changes nothing.
    expect(gmailSendAction.applyContentEdits!(input, [{ id: 'other', body: 'x' }])).toEqual(input);
  });

  it('dedups on the recipient, not the wording, so a re-firing automation cannot stack drafts', () => {
    // The model rewrites the subject every pass; the recipient is the identity.
    const a = gmailSendAction.dedupKeyFor!(parse({ to: 'hilhow@amazon.com', subject: 'AWS reconnect — next steps', body: 'x' }));
    const b = gmailSendAction.dedupKeyFor!(parse({ to: ' HilHow@Amazon.com ', subject: 'DaGen + CloudSmart intros', body: 'y', draft: true }));

    expect(a).toBe('gmail.send:hilhow@amazon.com');
    expect(b).toBe(a);
    // A different recipient is a different queue item.
    expect(gmailSendAction.dedupKeyFor!(parse({ to: 'other@b.com', subject: 'Hi', body: 'x' }))).not.toBe(a);
  });
});
