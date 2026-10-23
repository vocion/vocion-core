/**
 * A QUIET SEAT NEVER TAKES AN UNADDRESSED MESSAGE, AND THE REVIEW QUEUE IS THE
 * LEAD'S (2026-10-23).
 *
 * On a workspace's Review queue a person asked "can we kill all these old
 * recommendations? anything older than 5 days?" and the first-turn router
 * sent it to the wiki curator: a seat authored `initiative: low`, which
 * tends pages on Fridays and volunteers nothing. Two structural rules now
 * hold: a quiet seat is not a candidate for a message nobody addressed, and
 * on the Review queue the lead answers the first turn and hands off.
 *
 * The roster is fictional: Northwind's revenue workspace.
 */
import type { RoutableAgent } from './router';
import { describe, expect, it, vi } from 'vitest';
import { workspaceWidePage } from '@/libs/chat/workspacePages';
import { routeFirstTurn, unaddressedSeats, workspacePageDecision } from './router';

const lead: RoutableAgent = { slug: 'northwind-revenue-lead', name: 'Revenue lead', description: 'Runs the revenue workspace.' };
const curator: RoutableAgent = { slug: 'wiki-curator', name: 'Wiki curator', description: 'Keeps the wiki small: merges duplicates and prunes what nobody reads.', handles: ['prune the wiki'], initiative: 'low' };
const sdr: RoutableAgent = { slug: 'sdr-coordinator', name: 'SDR coordinator', description: 'Works the outbound queue.' };
const MESSAGE = 'can we kill all these old recommendations? anything older than 5 days?';

describe('a quiet seat and an unaddressed message', () => {
  it('leaves a low-initiative seat out of the candidates, never the lead', () => {
    expect(unaddressedSeats([lead, curator, sdr], lead.slug).map(a => a.slug)).toEqual([lead.slug, sdr.slug]);
    expect(unaddressedSeats([{ ...lead, initiative: 'low' }, curator], lead.slug).map(a => a.slug)).toEqual([lead.slug]);
  });

  it('never shows the model read a quiet seat, and routes to the lead when only it is left', async () => {
    const read = vi.fn(async (input: { agents: RoutableAgent[] }) => ({ chosen: input.agents.at(-1)!.slug, confidence: 0.9, reason: 'fits' }));

    const withSdr = await routeFirstTurn({ orgId: 'org_nw', agents: [lead, curator, sdr], message: MESSAGE, leadSlug: lead.slug, surface: 'chat' }, { owners: async () => ({}), intake: async () => null, read });

    expect(read.mock.calls[0]![0].agents.map(a => a.slug)).toEqual([lead.slug, sdr.slug]);
    expect(withSdr?.chosen).toBe(sdr.slug);

    const onlyCurator = await routeFirstTurn({ orgId: 'org_nw', agents: [lead, curator], message: MESSAGE, leadSlug: lead.slug, surface: 'chat' }, { owners: async () => ({}), intake: async () => null, read });

    expect(onlyCurator).toMatchObject({ chosen: lead.slug, decidedBy: 'roster' });
  });
});

describe('the Review queue is the lead\'s', () => {
  it('names the queue by its path, with or without the workspace prefix, and not a decision\'s own page', () => {
    expect(workspaceWidePage('/w/revenue/dashboard/inbox')).toBe('Review queue');
    expect(workspaceWidePage('/dashboard/inbox?tab=open')).toBe('Review queue');
    expect(workspaceWidePage('/dashboard/inbox/412')).toBeNull();
    expect(workspaceWidePage('/dashboard/chat')).toBeNull();
  });

  it('gives the first turn to the lead there, unless the person names a seat', () => {
    expect(workspacePageDecision({ agents: [lead, curator, sdr], message: MESSAGE, pagePath: '/w/revenue/dashboard/inbox', leadSlug: lead.slug, surface: 'chat' })).toMatchObject({ chosen: lead.slug, decidedBy: 'page' });
    expect(workspacePageDecision({ agents: [lead, curator, sdr], message: '@wiki-curator prune the stale pages', pagePath: '/w/revenue/dashboard/inbox', leadSlug: lead.slug, surface: 'chat' })).toMatchObject({ chosen: curator.slug, decidedBy: 'named' });
    expect(workspacePageDecision({ agents: [lead, curator], message: MESSAGE, pagePath: '/dashboard/chat', leadSlug: lead.slug, surface: 'chat' })).toBeNull();
  });
});
