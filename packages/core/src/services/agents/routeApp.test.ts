/**
 * AN APP'S CHAT ROUTES WITHIN THE APP; A THREAD CHANGES HANDS (2026-10-29).
 *
 * In a workspace with the SEO app, the person asked in the app's chat to
 * "connect to Github for our client projects". The router sent it to the
 * workspace's generic lead ("connecting an external system is workspace
 * setup"), and three follow-ups stayed there by rule, so the generic lead
 * planned the SEO team's pages and took the plan's sign-off itself. The case
 * is fictional: Fernhill, an agency with an SEO team.
 */
import type { AppScope, RoutableAgent, RouteReader } from './router';
import { describe, expect, it, vi } from 'vitest';
import { APP_EXIT_BAR, appRoster, plainFollowUp, ROUTE_CONFIDENCE_BAR, routeFirstTurn, routeFollowUp, withTeams } from './router';
import { appLine, readRoute } from './routeRead';

const workspaceLead: RoutableAgent = {
  slug: 'workspace-lead',
  name: 'Lead',
  description: 'Runs this workspace for the people in it: answers what nobody else is asked, hands work to the teammate who owns it, and sets the workspace up.',
  handles: ['setting up this workspace', 'connecting a system'],
  initiative: 'high',
};
const strategist: RoutableAgent = { slug: 'seo-strategist', name: 'SEO strategist', description: 'Plans and briefs SEO pages for every client; leads the SEO team.', team: 'seo' };
const analyst: RoutableAgent = { slug: 'serp-analyst', name: 'SERP analyst', description: 'Researches what ranks on Google and finds keywords.', team: 'seo', tools: ['serp_search', 'keyword_metrics'] };
const writer: RoutableAgent = { slug: 'seo-writer', name: 'SEO writer', description: 'Writes the pages in the client\'s voice.', team: 'seo' };
const adsLead: RoutableAgent = { slug: 'ads-manager', name: 'Ads manager', description: 'Runs paid campaigns.', team: 'ads' };
const TEAMS = [{ slug: 'seo', lead: 'seo-strategist' }, { slug: 'ads', lead: 'ads-manager' }];
const ROSTER = withTeams([workspaceLead, strategist, analyst, writer, adsLead], TEAMS);
const SEO: AppScope = { id: 'seo', name: 'SEO', teams: ['seo'], leadSlug: 'seo-strategist', outsideSlug: 'workspace-lead' };

const firstTurn = (message: string, read: RouteReader) =>
  routeFirstTurn({ orgId: 'org_fernhill', agents: ROSTER, message, leadSlug: 'seo-strategist', surface: 'chat', app: SEO }, { owners: async () => ({}), intake: async () => null, jev: async () => null, read });

describe('an app\'s chat: the first turn routes within the app', () => {
  it('the app\'s seats and the workspace lead are the candidates; another app\'s seats are not', () => {
    const scoped = appRoster(ROSTER, SEO);

    expect(scoped?.lead).toBe('seo-strategist');
    expect(scoped?.outside).toBe('workspace-lead');
    expect(scoped?.seats.map(a => a.slug).sort()).toEqual(['seo-strategist', 'seo-writer', 'serp-analyst', 'workspace-lead']);
  });

  it('setup the app needs is the app lead\'s: the reference case', async () => {
    let offered: string[] = [];
    const d = await firstTurn('connect to Github for our client projects', async (input) => {
      offered = input.agents.map(a => a.slug);
      return { chosen: 'workspace-lead', confidence: 0.8, reason: 'Connecting an external system is workspace setup.' };
    });

    expect(offered).not.toContain('ads-manager');
    expect(d).toMatchObject({ chosen: 'seo-strategist', defaulted: true, decidedBy: 'model', app: 'seo' });
    expect(d?.reason).toMatch(new RegExp(`the bar to leave the app is ${APP_EXIT_BAR}`));
  });

  it('the read is told it is in the app\'s chat and who owns what the app needs', async () => {
    const seen: string[] = [];
    const model = {
      bindTools: (tools: Array<{ name: string }>) => ({
        invoke: async (messages: Array<{ content: unknown }>) => {
          seen.push(...messages.map(m => String(m.content)));
          return { tool_calls: [{ name: tools[0]!.name, args: { chosen: 'seo-strategist', confidence: 0.9, reason: 'The SEO app needs its repository connected.' } }] };
        },
      }),
    } as never;
    const d = await firstTurn('connect to Github for our client projects', input => readRoute(input, model));

    expect(d).toMatchObject({ chosen: 'seo-strategist', defaulted: false, app: 'seo' });
    expect(seen[1]).toContain(appLine({ name: 'SEO', leadSlug: 'seo-strategist', outsideSlug: 'workspace-lead' }));
    expect(seen[1]).toContain('- seo-strategist (SEO strategist) — the lead — leads the seo team');
  });

  it('the workspace lead answers what is clearly outside every app', async () => {
    const d = await firstTurn('invite my business partner to this workspace', async () => ({ chosen: 'workspace-lead', confidence: 0.92, reason: 'Inviting a teammate is workspace work no app does.' }));

    expect(d).toMatchObject({ chosen: 'workspace-lead', decidedBy: 'model', app: 'seo' });
  });

  it('a keyword fallback that lands outside the app comes back to the app lead', async () => {
    const d = await firstTurn('connecting a system for setting up this workspace', async () => {
      throw new Error('rate limited');
    });

    expect(d).toMatchObject({ chosen: 'seo-strategist', decidedBy: 'keywords', app: 'seo' });
  });

  it('routes the whole roster when the app\'s lead is not here', async () => {
    let offered: string[] = [];
    await routeFirstTurn(
      { orgId: 'org_fernhill', agents: ROSTER.filter(a => a.slug !== 'seo-strategist'), message: 'plan pages', leadSlug: 'workspace-lead', surface: 'chat', app: SEO },
      { owners: async () => ({}), intake: async () => null, jev: async () => null, read: async (input) => {
        offered = input.agents.map(a => a.slug);
        return { chosen: 'serp-analyst', confidence: 0.9, reason: 'x' };
      } },
    );

    expect(offered).toContain('ads-manager');
  });
});

const follow = (message: string, read: RouteReader, extra: { agentSlug?: string; chip?: boolean; openCard?: boolean; app?: AppScope | null } = {}) =>
  routeFollowUp(
    { orgId: 'org_fernhill', agents: ROSTER, message, thread: { agentSlug: extra.agentSlug ?? 'workspace-lead', lastReply: 'Github is connected for the client projects.' }, leadSlug: 'seo-strategist', surface: 'chat', app: extra.app === undefined ? SEO : extra.app, chip: extra.chip, openCard: extra.openCard },
    { owners: async () => ({}), read },
  );

describe('a follow-up that turns to a team\'s domain is handed off', () => {
  it('hands the thread to the team\'s lead, visibly: the reference case', async () => {
    const d = await follow('find me keywords to build seo pages for', async () => ({ chosen: 'serp-analyst', confidence: 0.82, reason: 'Keyword research for SEO pages is the SEO team\'s.' }));

    expect(d).toMatchObject({ chosen: 'seo-strategist', decidedBy: 'handoff', handedFrom: 'workspace-lead', confidence: 0.82, app: 'seo' });
    expect(d?.reason).toMatch(/so it goes to seo-strategist, who leads that team/);
  });

  it(`a lead on no team hands domain work over at ${ROUTE_CONFIDENCE_BAR}: its job is delegating`, async () => {
    const d = await follow('AI agents for business automation build seo pages for this keyword', async () => ({ chosen: 'seo-strategist', confidence: 0.6, reason: 'Planning pages for a keyword.' }));

    expect(d).toMatchObject({ chosen: 'seo-strategist', decidedBy: 'handoff' });
  });

  it('a team\'s seat moves only on a confident read', async () => {
    const d = await follow('what do the ads cost us this month', async () => ({ chosen: 'ads-manager', confidence: 0.6, reason: 'Ad spend.' }), { agentSlug: 'serp-analyst', app: null });

    expect(d).toMatchObject({ chosen: 'serp-analyst', decidedBy: 'thread' });
  });

  it('the team\'s lead keeps work its own team owns', async () => {
    const d = await follow('write the first three pages from the briefs', async () => ({ chosen: 'seo-writer', confidence: 0.95, reason: 'Writing pages.' }), { agentSlug: 'seo-strategist' });

    expect(d).toMatchObject({ chosen: 'seo-strategist', decidedBy: 'thread', confidence: 0.95 });
    expect(d?.reason).toMatch(/leads the team that owns it/);
  });
});

describe('a plain follow-up stays, and costs no model call', () => {
  it.each([
    ['a short reply', 'Approve the keyword plan', {}],
    ['a chip the turn offered', 'Draft the briefs for all three pages now', { chip: true }],
    ['an answer to the open card', 'the second option, but keep the title', { openCard: true }],
  ])('%s', async (_case, message, extra) => {
    const read = vi.fn();
    const d = await follow(message, read, { agentSlug: 'seo-strategist', ...extra });

    expect(read).not.toHaveBeenCalled();
    expect(d).toMatchObject({ chosen: 'seo-strategist', decidedBy: 'thread' });
  });

  it('tells a plain follow-up from a change of direction', () => {
    expect(plainFollowUp('yes')).toBe(true);
    expect(plainFollowUp('Approve the keyword plan')).toBe(true);
    expect(plainFollowUp('ok, go with the second title and keep the intro short')).toBe(true);
    expect(plainFollowUp('find me keywords to build seo pages for')).toBe(false);
    // "no …" may be a correction toward another seat's work: it is read.
    expect(plainFollowUp('no I want to do lead and email follow up')).toBe(false);
    expect(plainFollowUp('find me keywords to build seo pages for', { chip: true })).toBe(true);
  });
});
