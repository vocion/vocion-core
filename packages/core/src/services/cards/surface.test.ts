/**
 * A card that said it would be filed says whether it was (conversation 349,
 * 2026-09-28: card_378208d4 surfaced with filing on, the filing's error was
 * swallowed, no action run followed, and the card kept reading "Waiting on
 * you").
 */
import type { AgentEvent } from '@/services/agents/types';
import type { FiledCard } from '@/services/chat/autoPropose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardFromRecommendation, CardSchema } from '@/libs/cards/card';
import { RunCollector } from '@/services/chat/runCollector';
import { AUTO_FILE_MS, surfaceCard } from './surface';

const card = () => cardFromRecommendation({ label: 'File request: export the viewer list', actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Export the viewer list' } } as never, 'card_test');

async function surfaced(file: () => Promise<FiledCard | null>) {
  const events: AgentEvent[] = [];
  const collector = new RunCollector();
  await surfaceCard(card(), { write: e => events.push(e), collector, file, where: { conversationId: 1, agentSlug: 'product-manager' } });
  const updates = events.filter((e): e is Extract<AgentEvent, { type: 'card_update' }> => e.type === 'card_update');
  const stored = collector.finalise().runs.find(r => r.type === 'card') as { state?: string; reason?: string; runId?: number } | undefined;
  return { updates, stored };
}

describe('a card filed under done-for-you', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    warn.mockClear();
    vi.useRealTimers();
  });

  it('says it was filed, with its run', async () => {
    const { updates, stored } = await surfaced(async () => ({ runId: 42, status: 'pending' }));

    expect(updates).toEqual([{ type: 'card_update', cardId: 'card_test', runId: 42, state: 'filed' }]);
    expect(stored).toMatchObject({ runId: 42, state: 'filed' });
  });

  it('says it was NOT filed, and why, when the filing throws — live and stored', async () => {
    const { updates, stored } = await surfaced(async () => {
      throw new Error('Not proposed: this request fails the "why" bar');
    });

    expect(updates).toEqual([{ type: 'card_update', cardId: 'card_test', state: 'unfiled', reason: 'Not proposed: this request fails the "why" bar' }]);
    expect(stored).toMatchObject({ state: 'unfiled', reason: 'Not proposed: this request fails the "why" bar' });
    expect(stored?.runId).toBeUndefined();
  });

  it('says it was not filed when the filing comes back with no run', async () => {
    const { updates } = await surfaced(async () => null);

    expect(updates[0]).toMatchObject({ state: 'unfiled' });
  });

  it('a slow filing still reports when it lands', async () => {
    vi.useFakeTimers();
    const events: AgentEvent[] = [];
    let land: (f: FiledCard) => void = () => {};
    const done = surfaceCard(card(), { write: e => events.push(e), file: () => new Promise<FiledCard>((resolve) => {
      land = resolve;
    }), where: { conversationId: 1, agentSlug: 'product-manager' } });
    await vi.advanceTimersByTimeAsync(AUTO_FILE_MS + 1);
    await done;

    expect(events.filter(e => e.type === 'card_update')).toHaveLength(0);

    land({ runId: 7, status: 'pending' });
    await vi.waitFor(() => expect(events.filter(e => e.type === 'card_update')).toEqual([{ type: 'card_update', cardId: 'card_test', runId: 7, state: 'filed' }]));
  });

  it('puts a link card\'s why on the ledger the reload reads (#1080)', async () => {
    const collector = new RunCollector();
    const link = CardSchema.parse({ id: 'card_link', kind: 'link', title: 'Connect GitHub', rationale: 'So the factory can read the repos.', actions: [], source: { tool: 'offer_connection' }, href: '/dashboard/connectors?add=github', state: 'proposed' });
    await surfaceCard(link, { write: () => {}, collector, where: { conversationId: 1, agentSlug: 'workspace-lead' } });

    expect(collector.finalise().runs.find(r => r.type === 'card')).toMatchObject({ rationale: 'So the factory can read the repos.', href: '/dashboard/connectors?add=github' });
  });
});

describe('a card whose run lives in another workspace', () => {
  it('goes on the ledger naming that workspace, and is never filed again here', async () => {
    const events: AgentEvent[] = [];
    const collector = new RunCollector();
    const file = vi.fn();
    const workspace = { id: 'proj-revenue', slug: 'revenue', name: 'Northwind Revenue' };
    const card = CardSchema.parse({ id: 'card_run9', kind: 'action', title: 'Send the order form', actions: [{ label: 'Send', actionId: 'email.send' }], runId: 9, state: 'filed', workspace });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await surfaceCard(card, { write: e => events.push(e), collector, file, where: { conversationId: 1, agentSlug: 'assistant' } });

    expect(file).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'card', card }]);
    expect(collector.finalise().runs.find(r => r.type === 'card')).toMatchObject({ id: 'card_run9', runId: 9, state: 'filed', workspace });
  });
});
