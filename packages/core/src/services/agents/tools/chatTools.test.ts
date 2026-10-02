/**
 * The chat family's reads: present only for an agent with a chat source in
 * scope; a thread read as the provider gives it; a file saved as an image or
 * returned as text. The provider is a fake.
 */
import type { RuntimeContext } from '../types';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  readThread: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('@/services/chat/provider', async () => {
  const real = await vi.importActual<typeof import('@/services/chat/provider')>('@/services/chat/provider');
  return { ...real, chatProviderFor: async () => provider };
});
const saved = vi.hoisted(() => ({ calls: [] as Array<{ ext: string; contentType: string }> }));
vi.mock('@/libs/tools/artifacts/store', () => ({ saveArtifact: async (input: { ext: string; contentType: string }) => {
  saved.calls.push({ ext: input.ext, contentType: input.contentType });
  return { url: '/api/artifacts/org_1-abc.png' };
} }));

const { chatTools } = await import('./chatTools');

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds: Record<string, string> = {}): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'product-manager', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

describe('chatTools', () => {
  it('are present only for an agent whose sources include a chat', () => {
    expect(chatTools(ctxFor([]))).toHaveLength(0);
    expect(chatTools(ctxFor(['github', 'jira']))).toHaveLength(0);
    expect((chatTools(ctxFor(['slack'])) as unknown as Invokable[]).map(t => t.name)).toEqual(['chat_read_thread', 'chat_read_file']);
    expect((chatTools(ctxFor(['noco-chat'], { 'noco-chat': 'slack' })) as unknown as Invokable[]).map(t => t.name)).toEqual(['chat_read_thread', 'chat_read_file']);
  });

  it('chat_read_thread reads the thread a permalink names', async () => {
    provider.readThread.mockResolvedValueOnce({ ok: true, value: { channel: { id: 'C0REQ', name: 'requests' }, messages: [{ ts: '1727700000.000100', author: { id: 'U1', name: 'Dana' }, text: 'Export is broken', files: [{ id: 'F1', name: 'shot.png', mimeType: 'image/png', size: 10 }] }] } });
    const [t] = chatTools(ctxFor(['slack'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ permalink: 'https://northwind.slack.com/archives/C0REQ/p1727700000000100' }));

    expect(provider.readThread).toHaveBeenCalledWith({ channelId: 'C0REQ', threadTs: '1727700000.000100', limit: 50 });
    expect(out).toMatchObject({ ok: true, channel: { name: 'requests' }, messages: [{ text: 'Export is broken' }] });
    expect(out.note).toContain('chat_read_file');
  });

  it('chat_read_thread hands back the provider\'s reason when it could not read', async () => {
    provider.readThread.mockResolvedValueOnce({ ok: false, error: 'Reading this thread needs the `groups:history` scope on the Slack app; it was not granted.' });
    const [t] = chatTools(ctxFor(['slack'])) as unknown as Invokable[];
    const out = JSON.parse(await t!.invoke({ channel_id: 'G0PRIV', ts: '1.000001' }));

    expect(out).toEqual({ ok: false, error: expect.stringContaining('groups:history') });
  });

  it('chat_read_file stores an image and returns text for a text file', async () => {
    provider.readFile.mockResolvedValueOnce({ ok: true, value: { id: 'F1', name: 'shot.png', mimeType: 'image/png', size: 8, bytes: Buffer.from('PNGBYTES') } });
    const [, f] = chatTools(ctxFor(['slack'])) as unknown as Invokable[];
    const image = JSON.parse(await f!.invoke({ file_id: 'F1' }));

    expect(image).toMatchObject({ ok: true, id: 'F1', mimeType: 'image/png', url: '/api/artifacts/org_1-abc.png' });
    expect(saved.calls).toEqual([{ ext: 'png', contentType: 'image/png' }]);

    provider.readFile.mockResolvedValueOnce({ ok: true, value: { id: 'F2', name: 'numbers.csv', mimeType: 'text/csv', size: 11, bytes: Buffer.from('a,b\n1,2\n') } });
    const text = JSON.parse(await f!.invoke({ file_id: 'F2' }));

    expect(text).toMatchObject({ ok: true, id: 'F2', text: 'a,b\n1,2\n' });
  });

  it('chat_read_file finds the one file on a message named by permalink, and refuses two', async () => {
    provider.readThread.mockResolvedValueOnce({ ok: true, value: { channel: { id: 'C0REQ', name: null }, messages: [{ ts: '1727700000.000100', author: { id: 'U1', name: null }, text: '', files: [{ id: 'F1', name: 'a.png', mimeType: 'image/png', size: 1 }, { id: 'F2', name: 'b.png', mimeType: 'image/png', size: 1 }] }] } });
    const [, f] = chatTools(ctxFor(['slack'])) as unknown as Invokable[];
    const out = JSON.parse(await f!.invoke({ permalink: 'https://northwind.slack.com/archives/C0REQ/p1727700000000100' }));

    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('2 files'), files: [{ id: 'F1' }, { id: 'F2' }] });
  });
});
