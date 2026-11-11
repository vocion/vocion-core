import type { McpUpdate, McpUpdatesDeps } from './mcpUpdates';
import { describe, expect, it, vi } from 'vitest';
import { askBrief, runMcpUpdatesJob, updatesOf } from './mcpUpdates';

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

  it('an update that asks goes to the agent first, and the thread hears the agent', async () => {
    const d = deps({ updates: [update({ id: 'ACME-4|wait:brief:t1', text: 'ACME-4 needs you.', asks: true })], answer: vi.fn(async () => 'The factory asked which plan; the thread said Pro, so I answered Pro.') });
    await runMcpUpdatesJob('org_1', {}, d);

    expect(d.answer).toHaveBeenCalledWith('org_1', 41, askBrief('Factory', 'factory', update({ id: 'ACME-4|wait:brief:t1', text: 'ACME-4 needs you.', asks: true })));
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
