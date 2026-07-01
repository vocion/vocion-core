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
});
