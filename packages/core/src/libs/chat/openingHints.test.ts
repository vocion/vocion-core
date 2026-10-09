import type { HintInput } from './openingHints';
import { describe, expect, it } from 'vitest';
import { openingHints } from './openingHints';

const now = new Date('2026-10-09T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function input(over: Partial<HintInput> = {}): HintInput {
  return {
    now,
    person: { isAdmin: true, sessions: 8, messagesSent: 40 },
    workspace: { createdAt: new Date(now.getTime() - 90 * DAY), leadSpoken: 'the Revenue lead' },
    apps: [],
    connectors: [],
    waiting: [],
    next: null,
    dismissed: [],
    ...over,
  };
}

const factory = {
  slug: 'software-factory',
  name: 'Software Factory',
  installedAt: new Date(now.getTime() - 2 * DAY),
  installedByPerson: true,
  steps: [{ label: 'Connect GitHub', done: false, adminOnly: true }, { label: 'Add a product', done: false, adminOnly: false }, { label: 'Pick a repo', done: true, adminOnly: false }],
  blocksAgents: true,
  href: '/dashboard/chat?objective=connect-systems&app=software-factory',
};

describe('the opening hint (founder, 2026-10-09)', () => {
  it('says nothing when nothing is worth saying', () => {
    expect(openingHints(input())).toEqual([]);
  });

  it('leads with finishing setup, naming the steps left and the next one', () => {
    const [top] = openingHints(input({ apps: [factory], waiting: [{ kind: 'fyi', ageHours: 2, blocksRun: false }] }));

    // Action first, short enough to read whole at 390px; a prompt in the
    // person's voice, never a shortcut to a card (founder, 2026-10-09).
    expect(top).toMatchObject({ type: 'setup', label: 'Finish Software Factory setup · 2 steps →', action: { kind: 'send', prompt: 'Help me finish setting up Software Factory' } });
    expect(top!.reason).toMatch(/agents can't run/);
  });

  it('ranks a broken connection over one never made, and a busy one higher still', () => {
    const quiet = openingHints(input({ connectors: [{ slug: 'crm', name: 'HubSpot', state: 'needed', neededBy: 'Revenue', recentTouches: 0, href: '/x' }] }))[0]!;
    const broken = openingHints(input({ connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 0, href: '/x' }] }))[0]!;
    const busy = openingHints(input({ connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 3, touchNote: 'the Revenue lead couldn\'t read deals today', href: '/x' }] }))[0]!;

    expect(broken.score).toBeGreaterThan(quiet.score);
    expect(busy.score).toBeGreaterThan(broken.score);
    expect(busy.label).toBe('Reconnect HubSpot →');
    expect(busy.reason).toMatch(/^The HubSpot team connector stopped working/);
    expect(busy.action).toEqual({ kind: 'send', prompt: 'Help me reconnect the HubSpot team connector' });
    expect(quiet.label).toBe('Connect HubSpot →');
  });

  it('names a personal connector as personal', () => {
    const own = openingHints(input({ connectors: [{ slug: 'gmail', name: 'Gmail', kind: 'personal', state: 'expired', recentTouches: 0, href: '/x' }] }))[0]!;

    expect(own.reason).toBe('The Gmail personal connector stopped working.');
    expect(own.action).toEqual({ kind: 'send', prompt: 'Help me reconnect the Gmail personal connector' });
  });

  it('boosts a system agents tried and failed to use this week, and says so', () => {
    const tried = { slug: 'slack', name: 'Slack', state: 'needed' as const, recentTouches: 3, touchNote: 'Agents tried to use Slack 3 times this week and couldn\'t', href: '/x' };
    const untried = { ...tried, recentTouches: 0, touchNote: undefined, neededBy: 'Support' };
    const [top] = openingHints(input({ connectors: [tried] }));

    expect(top).toMatchObject({ type: 'connector', label: 'Connect Slack →', reason: 'Agents tried to use Slack 3 times this week and couldn\'t.' });
    expect(top!.score).toBeGreaterThan(openingHints(input({ connectors: [untried] }))[0]!.score);
  });

  it('offers up to three pills when each clears the bar, one per type; usually one', () => {
    const close = input({
      connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 0, href: '/x' }],
      waiting: [{ kind: 'approval', ageHours: 30, blocksRun: true }, { kind: 'approval', ageHours: 30, blocksRun: true }],
      next: { key: 'briefing', label: 'What needs my attention today?', prompt: 'Walk me through the latest briefing', reason: 'A new briefing came in this week.', weight: 1.9 },
    });
    const three = openingHints(close);

    expect(three.map(h => h.type)).toEqual(['connector', 'attention', 'next']);
    expect(three.every(h => h.score >= three[0]!.score * 0.85)).toBe(true);
    // One far ahead stands alone.
    expect(openingHints(input({ apps: [factory] }))).toHaveLength(1);
  });

  it('offers several starters at once, fitted to the workspace, in place of the generic tour', () => {
    const hints = openingHints(input({
      person: { isAdmin: true, sessions: 1, messagesSent: 0 },
      starters: [
        { key: 'a', label: 'What emails do I owe replies to?', prompt: 'What emails do I owe replies to?', reason: 'Gmail is connected.', weight: 1.3 },
        { key: 'b', label: 'Prep me for today\'s meetings', prompt: 'Prep me for today\'s meetings', reason: 'Calendar is connected.', weight: 1.25 },
        { key: 'c', label: 'What\'s waiting on me across Northwind?', prompt: 'What\'s waiting on me across Northwind?', reason: 'Every workspace.', weight: 1.2 },
      ],
    }));

    expect(hints.map(h => [h.type, h.label])).toEqual([
      ['starter', 'What emails do I owe replies to? →'],
      ['starter', 'Prep me for today\'s meetings →'],
      ['starter', 'What\'s waiting on me across Northwind? →'],
    ]);
    expect(openingHints(input({ person: { isAdmin: true, sessions: 1, messagesSent: 0 } }))[0]!.type).toBe('capability');
  });

  it('scales attention by count, what blocks a run, and age; an FYI is quieter', () => {
    const fyi = openingHints(input({ waiting: [{ kind: 'fyi', ageHours: 1, blocksRun: false }, { kind: 'fyi', ageHours: 1, blocksRun: false }] }))[0]!;
    const blocking = openingHints(input({ waiting: [{ kind: 'approval', ageHours: 30, blocksRun: true }, { kind: 'fyi', ageHours: 1, blocksRun: false }] }))[0]!;

    expect(blocking.score).toBeGreaterThan(fyi.score);
    expect(blocking.label).toBe('2 things need your attention →');
    expect(blocking.reason).toBe('1 is holding up work until you decide.');
  });

  it('offers the tour early and lets it fade after a few sessions or messages', () => {
    const first = openingHints(input({ person: { isAdmin: true, sessions: 1, messagesSent: 0 }, workspace: { createdAt: now, leadSpoken: 'Ava' } }))[0]!;

    expect(first).toMatchObject({ type: 'capability', label: 'What can the team do? →', action: { kind: 'send', prompt: 'What can you do?' } });
    expect(first.reason).toMatch(/Ava and the team/);
    expect(openingHints(input({ person: { isAdmin: true, sessions: 5, messagesSent: 2 } }))).toEqual([]);
    expect(openingHints(input({ person: { isAdmin: true, sessions: 1, messagesSent: 8 } }))).toEqual([]);
  });

  it('shows a second hint only of another type and within about 15% of the top', () => {
    const close = openingHints(input({
      connectors: [{ slug: 'crm', name: 'HubSpot', state: 'incomplete', recentTouches: 0, href: '/x' }],
      person: { isAdmin: true, sessions: 1, messagesSent: 0 },
      workspace: { createdAt: now, leadSpoken: 'Ava' },
    }));

    expect(close.map(h => h.type)).toEqual(['connector', 'capability']);

    const far = openingHints(input({ apps: [factory], waiting: [{ kind: 'fyi', ageHours: 1, blocksRun: false }] }));

    expect(far).toHaveLength(1);
  });

  it('never shows more than two', () => {
    const many = openingHints(input({
      apps: [{ ...factory, installedAt: null, installedByPerson: false, blocksAgents: false }],
      connectors: [{ slug: 'crm', name: 'HubSpot', state: 'incomplete', recentTouches: 0, href: '/x' }],
      waiting: Array.from({ length: 8 }, () => ({ kind: 'approval' as const, ageHours: 40, blocksRun: true })),
      next: { key: 'coverage', label: 'Pipeline coverage is under target — ask the team why', prompt: 'Why is pipeline coverage under target?', reason: 'Coverage is under target.' },
      person: { isAdmin: true, sessions: 1, messagesSent: 0 },
    }));

    expect(many.length).toBeLessThanOrEqual(2);
    expect(new Set(many.map(h => h.type)).size).toBe(many.length);
  });

  it('a brief already written opens where it is, and leads over the tour', () => {
    const [top] = openingHints(input({
      next: { key: 'rhythm:41', label: 'Your morning brief is ready', prompt: '', href: '/dashboard/chat?conversation=41', reason: 'Written for you just now.', weight: 1.9 },
      person: { isAdmin: false, sessions: 1, messagesSent: 0 },
    }));

    expect(top).toMatchObject({ key: 'next:rhythm:41', label: 'Your morning brief is ready →', action: { kind: 'open', href: '/dashboard/chat?conversation=41' } });
  });

  it('offers a member only what they can do: "ask an admin", and only when it blocks them', () => {
    const member = { isAdmin: false, sessions: 8, messagesSent: 40 };
    const blocked = openingHints(input({ person: member, apps: [factory] }))[0]!;

    expect(blocked.label).toBe('Ask an admin to finish Software Factory →');
    expect(blocked.action.kind).toBe('send');
    expect(openingHints(input({ person: member, apps: [{ ...factory, blocksAgents: false }] }))).toEqual([]);
    expect(openingHints(input({ person: member, connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 0, href: '/x' }] }))).toEqual([]);
    expect(openingHints(input({ person: member, connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 2, href: '/x' }] }))[0]!.label).toBe('Ask an admin to reconnect HubSpot →');
  });

  it('hides a dismissed item for 7 days, then lowers that type\'s weight for a while', () => {
    const base = input({ connectors: [{ slug: 'crm', name: 'HubSpot', state: 'broken', recentTouches: 0, href: '/x' }] });
    const fresh = openingHints(base)[0]!;

    expect(openingHints({ ...base, dismissed: [{ key: 'connector:crm', type: 'connector', at: new Date(now.getTime() - 2 * DAY) }] })).toEqual([]);

    const later = openingHints({ ...base, dismissed: [{ key: 'connector:crm', type: 'connector', at: new Date(now.getTime() - 9 * DAY) }] })[0]!;

    expect(later.key).toBe('connector:crm');
    expect(later.score).toBeLessThan(fresh.score);
  });
});

describe('a setup the person started and left (its objective)', () => {
  it('offers to resume it where it stands, in its conversation, over starting one', () => {
    const [top] = openingHints(input({ apps: [{ ...factory, resume: { conversationId: 12 } }] }));

    expect(top).toMatchObject({
      key: 'setup:software-factory',
      type: 'setup',
      label: 'Resume Software Factory setup →',
      reason: '2 steps left; next: Connect GitHub.',
      action: { kind: 'open', href: '/dashboard/chat?conversation=12' },
      resumes: 12,
    });

    const fresh = openingHints(input({ apps: [factory] }))[0]!;

    expect(top!.score).toBeGreaterThan(fresh.score);
  });

  it('is hidden by the same dismissal as the setup hint it replaces', () => {
    const hints = openingHints(input({ apps: [{ ...factory, resume: { conversationId: 12 } }], dismissed: [{ key: 'setup:software-factory', type: 'setup', at: new Date(now.getTime() - DAY) }] }));

    expect(hints.some(h => h.type === 'setup')).toBe(false);
  });

  it('says nothing once it is set up', () => {
    expect(openingHints(input({ apps: [{ ...factory, steps: factory.steps.map(s => ({ ...s, done: true })), resume: { conversationId: 12 } }] })).some(h => h.type === 'setup')).toBe(false);
  });
});

describe('every hint is a prompt or a page, never a card', () => {
  it('sends the person\'s own words for anything that would raise a card; only an existing thread or a page opens', () => {
    const hints = openingHints(input({
      apps: [factory, { ...factory, slug: 'gtm', name: 'GTM', resume: { conversationId: 9 } }],
      connectors: [{ slug: 'hubspot', name: 'HubSpot', state: 'broken', recentTouches: 3, href: '/x' }],
      waiting: [{ kind: 'approval', ageHours: 30, blocksRun: true }],
      dismissed: [],
    }));
    const all = [...hints, ...openingHints(input({ apps: [factory] })), ...openingHints(input({ connectors: [{ slug: 'hubspot', name: 'HubSpot', state: 'broken', recentTouches: 3, href: '/x' }] }))];

    for (const h of all) {
      if (h.action.kind === 'open') {
        // A thread that already exists, or a page — never the chat with a card to dock.
        expect(h.action.href).toMatch(/^\/dashboard\/(chat\?conversation=\d+|inbox)$/);
      }
    }

    expect(all.some(h => h.action.kind === 'send')).toBe(true);
  });
});
