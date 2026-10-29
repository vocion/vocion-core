import type { ConnectAskCheck, ConnectAskRow } from './connectAskGate';
import { describe, expect, it } from 'vitest';
import { connectAskVerdict, connectorsInSetupAsk, connectorsOfAsk, declined, markPublishStep, proposedAction, publishStepOf, SKIP_HOLD_MS } from './connectAskGate';

const NOW = new Date('2026-10-29T15:00:00Z');
const CONNECT_GITHUB = [{ id: 'connect:github', href: '/api/connect/github/start?connector=github' }, { id: 'paste:github', href: '/dashboard/connectors?add=github&paste=1' }];

function check(over: Partial<ConnectAskCheck> = {}): ConnectAskCheck {
  return { connector: 'github', name: 'GitHub', conversationId: 41, projectId: null, publishStep: false, publishOnly: false, requested: null, now: NOW, ...over };
}

function ask(over: Partial<ConnectAskRow> = {}): ConnectAskRow {
  return { id: 379, status: 'skipped', decision: null, options: CONNECT_GITHUB, objectRefs: [], conversationId: 41, createdAt: new Date(NOW.getTime() - 30_000), decidedAt: new Date(NOW.getTime() - 20_000), ...over };
}

describe('connectAskVerdict — GitHub only at publish', () => {
  it('an SEO agent researching never asks for GitHub, and is told what to do instead', () => {
    const v = connectAskVerdict([], check({ publishOnly: true }));

    expect(v.ok).toBe(false);
    expect(v.ok ? null : v.reason).toBe('publish_only');
    expect(v.ok ? '' : v.reply).toMatch(/only needed to publish/);
    expect(v.ok ? '' : v.reply).toMatch(/say in one line what you are doing instead/);
  });

  it('the publish step that needs it may ask', () => {
    expect(connectAskVerdict([], check({ publishOnly: true, publishStep: true, projectId: 12 })).ok).toBe(true);
  });

  it('an agent whose plugin does not hold GitHub back asks as before', () => {
    expect(connectAskVerdict([], check()).ok).toBe(true);
  });
});

describe('connectAskVerdict — one ask per system', () => {
  it('a skip in this conversation holds the next ask, with the existing state', () => {
    const v = connectAskVerdict([ask()], check());

    expect(v).toMatchObject({ ok: false, reason: 'declined', askId: 379 });
    expect(v.ok ? '' : v.reply).toMatch(/skipped connecting GitHub on Oct 29 \(ask #379\)/);
    expect(v.ok ? '' : v.reply).toMatch(/say in one line what you did instead/);
  });

  it('typed words in place of the card ("don\'t worry about github") count as declined', () => {
    expect(declined({ status: 'done', decision: 'other' })).toBe(true);
    expect(declined({ status: 'done', decision: 'connect:github' })).toBe(false);
    expect(connectAskVerdict([ask({ status: 'done', decision: 'other' })], check())).toMatchObject({ ok: false, reason: 'declined' });
  });

  it('a skip in another conversation does not hold this one', () => {
    expect(connectAskVerdict([ask({ conversationId: 99 })], check()).ok).toBe(true);
  });

  it('a skip holds seven days, then lapses', () => {
    const old = ask({ createdAt: new Date(NOW.getTime() - SKIP_HOLD_MS - 60_000), decidedAt: new Date(NOW.getTime() - SKIP_HOLD_MS - 1000) });

    expect(connectAskVerdict([old], check()).ok).toBe(true);
  });

  it('a skip before publishing does not hold the publish step', () => {
    expect(connectAskVerdict([ask()], check({ publishStep: true, projectId: 12 })).ok).toBe(true);
  });

  it('a skip at the publish step holds the next publish step of that project', () => {
    const atPublish = ask({ objectRefs: [{ type: 'data_room', id: '12' }, { type: 'connect_step', id: 'publish' }] });

    expect(connectAskVerdict([atPublish], check({ publishStep: true, projectId: 12, conversationId: 77 }))).toMatchObject({ ok: false, reason: 'declined' });
    expect(connectAskVerdict([atPublish], check({ publishStep: true, projectId: 13, conversationId: 77 })).ok).toBe(true);
  });

  it('a skip in a chat about the project holds that project\'s chats, but not its publish step', () => {
    const inChat = ask({ conversationId: 50, objectRefs: [{ type: 'data_room', id: '12' }] });

    expect(connectAskVerdict([inChat], check({ conversationId: 51, projectId: 12 }))).toMatchObject({ ok: false, reason: 'declined' });
    expect(connectAskVerdict([inChat], check({ conversationId: 51, projectId: 12, publishStep: true })).ok).toBe(true);
    expect(connectAskVerdict([inChat], check({ conversationId: 51, projectId: 13 })).ok).toBe(true);
  });

  it('an open ask is pointed to, never filed twice', () => {
    expect(connectAskVerdict([ask({ id: 381, status: 'open', decidedAt: null })], check())).toMatchObject({ ok: false, reason: 'open', askId: 381 });
  });

  it('only asks for this connector count', () => {
    const slack = ask({ options: [{ id: 'connect:slack', href: '/api/connect/slack/start?connector=slack' }] });

    expect(connectAskVerdict([slack], check()).ok).toBe(true);
  });

  it('a GitHub install waiting on an owner is said, not asked again', () => {
    const v = connectAskVerdict([], check({ requested: { at: new Date(NOW.getTime() - 3600_000), summary: 'Install requested: waiting for an owner of northwind-co to approve it' } }));

    expect(v).toMatchObject({ ok: false, reason: 'requested' });
    expect(v.ok ? '' : v.reply).toMatch(/waiting for an owner of northwind-co/);
  });
});

describe('connectorsOfAsk', () => {
  it('reads connect, paste, install and request options, and links', () => {
    expect(connectorsOfAsk(CONNECT_GITHUB)).toEqual(['github']);
    expect(connectorsOfAsk([{ id: 'install:github' }, { id: 'request:github' }])).toEqual(['github']);
    expect(connectorsOfAsk([{ id: 'start', href: '/dashboard/connectors?add=notion' }])).toEqual(['notion']);
    expect(connectorsOfAsk([{ id: 'yes' }])).toEqual([]);
  });
});

describe('connectorsInSetupAsk', () => {
  const connectors = [{ slug: 'github', name: 'GitHub' }, { slug: 'slack', name: 'Slack' }];

  it('names the system a hand-filed connect ask is for', () => {
    expect(connectorsInSetupAsk('Connect GitHub so I can publish?', [], connectors).map(c => c.slug)).toEqual(['github']);
    expect(connectorsInSetupAsk('Which site?', ['Log in with Slack'], connectors).map(c => c.slug)).toEqual(['slack']);
  });

  it('a setup question that connects nothing names nothing', () => {
    expect(connectorsInSetupAsk('Which GitHub folder holds the posts?', ['src/content/blog'], connectors)).toEqual([]);
  });
});

describe('the publish step', () => {
  it('is marked per turn, with its project', () => {
    const turn = {};

    expect(publishStepOf(turn, 'github')).toBeNull();

    markPublishStep(turn, 'github', 12);

    expect(publishStepOf(turn, 'github')).toEqual({ projectId: 12 });
    expect(publishStepOf({}, 'github')).toBeNull();
  });

  it('reads the action a proposal names', () => {
    expect(proposedAction('propose_action', { action_id: 'site.publish_page', action_input: { pageRecordId: 5 } })).toEqual({ actionId: 'site.publish_page', input: { pageRecordId: 5 } });
    expect(proposedAction('serp_search', { action_id: 'site.publish_page' })).toBeNull();
  });
});
