import type { McpUpdate, McpUpdatesDeps } from './mcpUpdates';
import { describe, expect, it, vi } from 'vitest';
import { askBrief, composeUpdate, LINE_MAX, oneLine, runMcpUpdatesJob, updatesOf } from './mcpUpdates';

const update = (over: Partial<McpUpdate> = {}): McpUpdate => ({ id: 'ACME-4|live:2.1.0', conversation: 41, text: 'Shipped: ACME-4 is live.', url: 'https://factory.example/r/release/rs_x', asks: false, ...over });

function deps(over: Partial<McpUpdatesDeps> & { updates?: McpUpdate[] } = {}) {
  const read = vi.fn<McpUpdatesDeps['read']>(over.read ?? (async (_o, _s, _t, ack) => (ack.length > 0 ? [] : over.updates ?? [update()])));
  const tell = vi.fn<McpUpdatesDeps['tell']>(over.tell ?? (async () => ({ said: true, channel: 'slack' })));
  const answer = vi.fn<McpUpdatesDeps['answer']>(over.answer ?? (async () => null));
  const sources: McpUpdatesDeps['sources'] = over.sources ?? (async () => [{ slug: 'factory', name: 'Factory', updatesTool: 'ticket_updates' }]);

  const watch = vi.fn<McpUpdatesDeps['watch']>(over.watch ?? (async () => undefined));

  return { sources, read, tell, answer, watch };
}

describe('updatesOf', () => {
  it('reads the structured answer, or the text one, and drops what is not well formed', () => {
    const good = { id: 'A|1', conversation: '41', text: ' hello ', url: 'https://x.example/a', asks: true };

    expect(updatesOf({ structuredContent: { updates: [good, { id: 'B', conversation: 'nope', text: 't' }, { id: '', conversation: 1, text: 't' }, { id: 'C', conversation: 2, text: '  ' }] } }))
      .toEqual([{ id: 'A|1', conversation: 41, text: 'hello', url: 'https://x.example/a', asks: true }]);
    expect(updatesOf({ content: [{ type: 'text', text: JSON.stringify({ updates: [{ id: 'A', conversation: 3, text: 't', url: 'http://plain.example' }] }) }] }))
      .toEqual([{ id: 'A', conversation: 3, text: 't', url: null, asks: false }]);
    expect(updatesOf({ content: [{ type: 'text', text: 'not json' }] })).toEqual([]);
  });
});

describe('mcp-updates', () => {
  it('tells the conversation once, keyed by source and update, then acknowledges it', async () => {
    const d = deps();

    expect(await runMcpUpdatesJob('org_1', {}, d)).toEqual({ sources: 1, told: 1, waiting: 0, failed: [] });
    expect(d.tell).toHaveBeenCalledWith('org_1', 41, 'Shipped: ACME-4 is live.', { key: 'mcp:factory:ACME-4|live:2.1.0', url: 'https://factory.example/r/release/rs_x' });
    expect(d.read).toHaveBeenLastCalledWith('org_1', 'factory', 'ticket_updates', ['ACME-4|live:2.1.0']);
    expect(d.answer).not.toHaveBeenCalled();
  });

  it('an update that asks goes to the agent first; a provider with no parts is posted in the agent\'s words', async () => {
    const asks = update({ id: 'ACME-4|wait:brief:t1', text: 'ACME-4 needs you.', asks: true });
    const d = deps({ updates: [asks], answer: vi.fn(async () => ({ words: 'The factory asked which plan; the thread said Pro, so I answered Pro.', acted: true })) });
    await runMcpUpdatesJob('org_1', {}, d);

    expect(d.answer).toHaveBeenCalledWith('org_1', 41, askBrief('Factory', 'factory', asks), 'factory');
    expect(d.tell.mock.calls[0]?.[2]).toBe('The factory asked which plan; the thread said Pro, so I answered Pro.');
  });

  it('a question is never dropped: when the agent cannot run, the provider\'s words are said', async () => {
    const d = deps({ updates: [update({ text: 'ACME-4 needs you.', asks: true })], answer: vi.fn(async () => {
      throw new Error('over budget');
    }) });
    await runMcpUpdatesJob('org_1', {}, d);

    expect(d.tell.mock.calls[0]?.[2]).toBe('ACME-4 needs you.');
  });

  it('acknowledges what was already said or has nobody left to hear it, and keeps what could not be said', async () => {
    const said = deps({ tell: vi.fn(async () => ({ said: false as const, reason: 'already said here' })) });

    expect(await runMcpUpdatesJob('org_1', {}, said)).toMatchObject({ told: 0, waiting: 0 });
    expect(said.read).toHaveBeenCalledTimes(2);

    const down = deps({ tell: vi.fn(async () => ({ said: false as const, reason: 'not said: slack is down' })) });

    expect(await runMcpUpdatesJob('org_1', {}, down)).toMatchObject({ told: 0, waiting: 1 });
    expect(down.read).toHaveBeenCalledTimes(1);
  });

  it('a source that fails is named and the others still run', async () => {
    const d = deps({ sources: async () => [{ slug: 'broken', name: 'Broken', updatesTool: 'u' }, { slug: 'factory', name: 'Factory', updatesTool: 'ticket_updates' }] });
    d.read.mockImplementationOnce(async () => {
      throw new Error('MCP request failed.');
    });

    expect(await runMcpUpdatesJob('org_1', {}, d)).toEqual({ sources: 2, told: 1, waiting: 0, failed: ['broken: MCP request failed.'] });
  });

  it('the sweep renews where the provider pings; a ping-driven read touches only its source and registers nothing', async () => {
    const sources = async () => [{ slug: 'factory', name: 'Factory', updatesTool: 'ticket_updates', watchTool: 'watch_updates' }, { slug: 'other', name: 'Other', updatesTool: 'u' }];
    const sweep = deps({ sources });

    expect(await runMcpUpdatesJob('org_1', {}, sweep)).toMatchObject({ sources: 2 });
    expect(sweep.watch.mock.calls).toEqual([['org_1', 'factory', 'watch_updates']]);

    const pinged = deps({ sources });

    expect(await runMcpUpdatesJob('org_1', { source: 'factory' }, pinged)).toMatchObject({ sources: 1 });
    expect(pinged.watch).not.toHaveBeenCalled();
    expect(pinged.read.mock.calls.every(c => c[1] === 'factory')).toBe(true);
  });

  it('a provider that refuses the registration is named, and its updates are still read', async () => {
    const d = deps({ sources: async () => [{ slug: 'factory', name: 'Factory', updatesTool: 'ticket_updates', watchTool: 'watch_updates' }], watch: vi.fn(async () => {
      throw new Error('the address must be https');
    }) });

    expect(await runMcpUpdatesJob('org_1', {}, d)).toEqual({ sources: 1, told: 1, waiting: 0, failed: ['factory: could not register for pings (the address must be https)'] });
  });
});

// Chris, 2026-11-10, reading a thread on his phone: nine long messages, bare links, how-to lines.
describe('what the thread reads is built from parts', () => {
  const parts = { headline: '🟠 **[ACME-4](https://factory.example/t/ACME-4)** Brief ready for approval · _Mic audio_', links: [{ label: 'Brief', url: 'https://factory.example/t/ACME-4' }, { label: 'Recording', url: 'https://video.example/v/abc' }] };

  it('an ask is the headline, the agent\'s one line and the links: three lines whatever the agent wrote', () => {
    const long = `Chris: I'd approve. It now covers the phone app.\n\nWhat the Brief covers:\n- a\n- b\nThe cost is $17.\nMention me with approve.`;
    const out = composeUpdate(update({ asks: true, ...parts }), { words: long, acted: false });

    expect(out.text).toBe(`${parts.headline}\nChris: I'd approve. It now covers the phone app.\n[Brief](https://factory.example/t/ACME-4) · [Recording](https://video.example/v/abc)`);
    expect(out.text.split('\n')).toHaveLength(3);
  });

  it('news is the headline, its note and its links, with the picture; no agent is asked', async () => {
    const live = update({ headline: '✅ **[ACME-4](https://factory.example/t/ACME-4)** shipped in 2.1.0 · _Mic audio_', note: '📱 Not checked by the factory, needs a person: record on an iPhone', links: [{ label: 'What shipped', url: 'https://factory.example/r/release/rs_x' }], images: [{ url: 'https://factory.example/r/release/rs_x/shot/ACME-4/0', caption: 'Mic audio' }] });
    const d = deps({ updates: [live] });
    await runMcpUpdatesJob('org_1', {}, d);

    expect(d.answer).not.toHaveBeenCalled();
    expect(d.tell.mock.calls[0]?.[2]).toBe(`${live.headline}\n${live.note}\n[What shipped](https://factory.example/r/release/rs_x)`);
    expect(d.tell.mock.calls[0]?.[3]).toMatchObject({ files: [{ url: 'https://factory.example/r/release/rs_x/shot/ACME-4/0', caption: 'Mic audio' }] });
  });

  it('when the agent answered the provider itself, its line is the news and the stale ask is not posted', () => {
    const out = composeUpdate(update({ asks: true, ...parts }), { words: 'The factory asked which app; the recording is from the phone, so I answered the phone app.', acted: true });

    expect(out.text).toBe('The factory asked which app; the recording is from the phone, so I answered the phone app.\n[Brief](https://factory.example/t/ACME-4) · [Recording](https://video.example/v/abc)');
  });

  it('the agent\'s line is its first line, whole: a long one keeps the sentences that fit, or is left out', () => {
    expect(oneLine('  \n- one\ntwo')).toBe('- one');
    expect(oneLine(null)).toBeNull();

    const fits = `Chris: I'd approve. ${'It covers the phone app. '.repeat(20)}`;

    expect(oneLine(fits)!.length).toBeLessThanOrEqual(LINE_MAX);
    expect(oneLine(fits)).toMatch(/^Chris: I'd approve\. It covers the phone app\./);
    expect(oneLine('x'.repeat(LINE_MAX + 50))).toBeNull();
    expect(composeUpdate(update({ asks: true, ...parts }), { words: 'x'.repeat(400), acted: false }).text.split('\n')).toHaveLength(2);
  });

  it('keeps only well-formed parts: https links and pictures, one-line headline and note', () => {
    const [u] = updatesOf({ structuredContent: { updates: [{ id: 'A', conversation: 3, text: 't', headline: 'two\nlines', note: '  n  ', links: [{ label: 'Brief', url: 'https://a.example' }, { label: 'x', url: 'http://plain.example' }, { url: 'https://nolabel.example' }], images: [{ url: 'https://img.example/a.png', caption: 'c' }, { url: '/relative.png' }] }] } });

    expect(u).toMatchObject({ headline: 'two lines', note: 'n', links: [{ label: 'Brief', url: 'https://a.example' }], images: [{ url: 'https://img.example/a.png', caption: 'c' }] });
  });

  it('carries the provider\'s card to the thread: the page as a preview, never as a second link', async () => {
    const card = { title: 'ACME-4 · Brief ready for approval: Mic audio', url: 'https://factory.example/r/ticket/ts_x', description: 'The recording has no voice.', image: 'https://cdn.example/poster.jpg' };
    const [parsed] = updatesOf({ structuredContent: { updates: [{ id: 'A', conversation: 41, text: 't', headline: 'h', preview: card }, { id: 'B', conversation: 41, text: 't', preview: { title: 'x', url: 'http://plain.example' } }] } });

    expect(parsed?.preview).toEqual({ title: card.title, url: card.url, description: card.description, imageUrl: card.image });
    expect(updatesOf({ structuredContent: { updates: [{ id: 'B', conversation: 41, text: 't', preview: { title: 'x', url: 'http://plain.example' } }] } })[0]?.preview).toBeUndefined();

    const d = deps({ updates: [parsed!] });
    await runMcpUpdatesJob('org_1', {}, d);

    expect(d.tell.mock.calls[0]?.[2]).toBe('h');
    expect(d.tell.mock.calls[0]?.[3]).toMatchObject({ preview: { title: card.title, url: card.url, imageUrl: card.image } });
  });
});
