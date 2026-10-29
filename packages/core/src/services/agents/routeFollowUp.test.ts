/**
 * A FOLLOW-UP THAT TURNS TO ANOTHER SEAT'S WORK MOVES THERE (2026-10-29).
 *
 * In a revenue workspace the person opened a thread on the marketing
 * briefing, which the marketing lead answered, then wrote "no I want to do
 * lead and email follow up". The thread stayed with the marketing lead, which
 * answered about ad spend. A follow-up still stays by default (conversation
 * 349, `router.test.ts`); it moves only when a model read, told who the thread
 * is with, confidently picks another seat. The case is fictional: Northwind's
 * revenue team.
 */
import type { RoutableAgent, RouteReader } from './router';
import { describe, expect, it, vi } from 'vitest';
import { FOLLOW_UP_MOVE_BAR, followUpDecision, routeFollowUp } from './router';
import { readRoute } from './routeRead';

const director: RoutableAgent = {
  slug: 'revenue-director',
  name: 'Revenue director',
  description: 'Leads the revenue team: the week across pipeline, marketing and follow-up.',
  handles: ['weekly review', 'gtm status'],
};
const marketing: RoutableAgent = {
  slug: 'marketing-lead',
  name: 'Marketing lead',
  description: 'Runs paid and organic marketing: campaigns, ad spend, the marketing briefing.',
  handles: ['campaigns', 'ads', 'marketing briefing'],
};
const followUp: RoutableAgent = {
  slug: 'follow-up-coordinator',
  name: 'Follow-up coordinator',
  description: 'Works the inbound leads: who is owed a reply, drafts the follow-up emails, logs them on the contact.',
  handles: ['lead follow-up', 'email follow-up', 'owed replies'],
  tools: ['gmail_drafts', 'crm'],
};
const curator: RoutableAgent = { slug: 'wiki-curator', name: 'Wiki curator', description: 'Tends the wiki on Fridays.', initiative: 'low' };
const ROSTER = [director, marketing, followUp, curator];
const BRIEFING = 'Marketing update, Thu Oct 29: paid search is 18% over plan; the webinar list is the risk.';
const MESSAGE = 'no I want to do lead and email follow up';

const thread = { agentSlug: 'marketing-lead', lastReply: BRIEFING };
const route = (read: RouteReader, extra: { timeoutMs?: number } = {}) =>
  routeFollowUp({ orgId: 'org_follow', agents: ROSTER, message: MESSAGE, thread, leadSlug: director.slug, surface: 'chat' }, { owners: async () => ({}), read, ...extra });

/**
 * A model bound to the one report tool, answering with these fields.
 * @param args - The fields it reports.
 * @param seen - Collects the system and human prompts it was sent.
 */
function modelSaying(args: Record<string, unknown>, seen: string[] = []) {
  return {
    bindTools: (tools: Array<{ name: string }>) => ({
      invoke: async (messages: Array<{ content: unknown }>) => {
        seen.push(...messages.map(m => String(m.content)));
        return { tool_calls: [{ name: tools[0]!.name, args }] };
      },
    }),
  } as never;
}

describe('the reference case: a correction toward another seat\'s work leaves the thread', () => {
  it('the structural rule alone keeps it with the marketing lead: the specimen', () => {
    expect(followUpDecision({ agents: ROSTER, message: MESSAGE, threadAgent: 'marketing-lead', surface: 'chat' })).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread' });
  });

  it('moves to the seat that owns follow-up on a confident read, told who the thread is with and what it said', async () => {
    const seen: string[] = [];
    const model = modelSaying({ chosen: 'follow-up-coordinator', confidence: 0.88, reason: 'They turned from the briefing to lead and email follow-up, which the coordinator owns.' }, seen);
    const decision = await route(input => readRoute(input, model));

    expect(decision).toMatchObject({ chosen: 'follow-up-coordinator', defaulted: false, decidedBy: 'model', confidence: 0.88, surface: 'chat' });
    expect(decision?.reason).toMatch(/^The thread was with marketing-lead, and this follow-up turned to work follow-up-coordinator owns/);

    const [system, human] = seen;

    expect(system).toMatch(/follow-up message in a conversation that is already with one of them/);
    expect(human).toContain('The conversation is with marketing-lead.');
    expect(human).toContain(BRIEFING);
    expect(human).toContain(`The person's follow-up:\n${MESSAGE}`);
  });

  it('the first turn\'s read is unchanged: no thread, the first-turn prompt', async () => {
    const seen: string[] = [];
    await readRoute({ orgId: 'org_follow', message: MESSAGE, agents: ROSTER, leadSlug: director.slug }, modelSaying({ chosen: 'follow-up-coordinator', confidence: 0.9, reason: 'x' }, seen));

    expect(seen[0]).toMatch(/answers the first message of a new conversation/);
    expect(seen[1]).not.toContain('The conversation is with');
  });
});

describe('an ordinary follow-up stays', () => {
  it('stays when the read keeps the thread\'s agent, with its reason', async () => {
    const d = await route(async () => ({ chosen: 'marketing-lead', confidence: 0.95, reason: 'They ask which campaign is over plan, in the briefing it just gave.' }));

    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread', confidence: 0.95 });
    expect(d?.reason).toMatch(/stays with marketing-lead: They ask which campaign/);
  });

  it(`stays when the read leans to another seat below ${FOLLOW_UP_MOVE_BAR}, and says what it leaned to`, async () => {
    const d = await route(async () => ({ chosen: 'follow-up-coordinator', confidence: 0.6, reason: 'Maybe follow-up.' }));

    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread', confidence: 0.6 });
    expect(d?.candidates[0]?.slug).toBe('follow-up-coordinator');
    expect(d?.reason).toMatch(/leaned to follow-up-coordinator at 0.6/);
  });

  it('stays when the read names an agent not on the roster', async () => {
    const d = await route(async () => ({ chosen: 'sdr-bot', confidence: 0.9, reason: 'x' }));

    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread' });
    expect(d?.reason).toMatch(/named sdr-bot, which is not an active agent here/);
  });

  it('never moves to a quiet seat, which answers only when named', async () => {
    let offered: string[] = [];
    const d = await route(async (input) => {
      offered = input.agents.map(a => a.slug);
      return { chosen: 'wiki-curator', confidence: 0.9, reason: 'x' };
    });

    expect(offered).not.toContain('wiki-curator');
    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread' });
  });

  it('keeps a quiet seat\'s own thread on the roster it reads', async () => {
    let offered: string[] = [];
    await routeFollowUp(
      { orgId: 'org_follow', agents: ROSTER, message: 'and the old pages?', thread: { agentSlug: 'wiki-curator' }, leadSlug: director.slug, surface: 'chat' },
      { owners: async () => ({}), read: async (input) => {
        offered = input.agents.map(a => a.slug);
        return { chosen: 'wiki-curator', confidence: 0.9, reason: 'continues' };
      } },
    );

    expect(offered).toContain('wiki-curator');
  });

  it('stays when the read fails, and records why', async () => {
    const d = await route(async () => {
      throw new Error('rate limited');
    });

    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread', fallback: 'rate limited' });
  });

  it('stays when the read is slow, and aborts it', async () => {
    let aborted = false;
    const d = await route(input => new Promise((resolve) => {
      input.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      setTimeout(() => resolve({ chosen: 'follow-up-coordinator', confidence: 1, reason: 'late' }), 5_000);
    }), { timeoutMs: 50 });

    expect(aborted).toBe(true);
    expect(d).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread', fallback: 'timed out after 50 ms' });
  });

  it('is null when the thread\'s agent is gone, and reads nothing when it is the only seat', async () => {
    const read = vi.fn();

    expect(await routeFollowUp({ orgId: 'org_follow', agents: [{ ...marketing, active: false }, director], message: MESSAGE, thread, surface: 'chat' }, { read })).toBeNull();
    expect(await routeFollowUp({ orgId: 'org_follow', agents: [marketing, curator], message: MESSAGE, thread, leadSlug: 'marketing-lead', surface: 'chat' }, { read })).toMatchObject({ chosen: 'marketing-lead', decidedBy: 'thread' });
    expect(read).not.toHaveBeenCalled();
  });
});
