/**
 * What the evidence says, derived by code from typed fields — pure, so every
 * threshold is pinned here: who counts as idle, when spend is not paying,
 * when rejections are a pattern, when escalations have an answer to learn,
 * when a team is behind and has a role to hire.
 */
import type { AgentSignals, OrgSignals, TeamSignals } from './signals';
import { describe, expect, it } from 'vitest';
import { deriveFindings } from './findings';

const NOW = new Date('2026-10-08T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function agent(over: Partial<AgentSignals> = {}): AgentSignals {
  return {
    slug: 'deal-desk',
    name: 'Deal Desk',
    description: 'Keeps Northwind deals moving.',
    teamSlug: 'revenue-ops',
    isWorkspaceLead: false,
    createdAt: ago(90),
    lastActiveAt: ago(1),
    turns: 40,
    failedTurns: 0,
    refusedTurns: 0,
    workerRuns: 0,
    failedRuns: 0,
    spentCents: 1_200,
    today: { spentCents: 300, hardCentsLimit: 10_000, blocked: false },
    decisions: [],
    rejectionNotes: [],
    asks: { filed: 0, answered: 0, byKind: {} },
    answeredAsks: [],
    ...over,
  };
}

function team(over: Partial<TeamSignals> = {}): TeamSignals {
  return {
    slug: 'revenue-ops',
    name: 'Revenue Ops',
    goal: 'More qualified pipeline from Kestrel Capital referrals.',
    agentSlugs: ['deal-desk'],
    primary: { label: 'Qualified referrals', value: 2, target: 10, attainment: 0.2, unit: 'referrals', window: '30d', provenance: 'human-confirmed' },
    unhired: [{ slug: 'seo-specialist', name: 'SEO Specialist', description: 'Finds search demand.' }],
    ...over,
  };
}

function signals(agents: AgentSignals[], teams: TeamSignals[] = []): OrgSignals {
  return { orgId: 'org_findings', workspace: { name: 'Northwind', goal: null, leadAgentSlug: null }, asOf: NOW, windowDays: 30, agents, teams };
}

const config = { idleDays: 14 };

describe('idle agents', () => {
  it('names an agent with no sign of work for the window, with a retirement it can file on its own', () => {
    const [f] = deriveFindings(signals([agent({ slug: 'scout', name: 'Kestrel Scout', lastActiveAt: ago(41) })]), config);

    expect(f).toMatchObject({ id: 'idle:scout', signal: 'idle', allowed: ['retire_agent'], fallback: { change: { kind: 'retire_agent', agentSlug: 'scout' } } });
    expect(f!.evidence[0]).toEqual({ label: 'Last run', value: '2026-08-28 (41 days ago)', href: '/dashboard/team-report/scout' });
    expect(f!.fallback!.headline).toBe('Retire Kestrel Scout — no runs in 41 days');
  });

  it('says "never" for an agent that has never run, rather than inventing a date', () => {
    const [f] = deriveFindings(signals([agent({ lastActiveAt: null, createdAt: ago(30) })]), config);

    expect(f!.evidence[0]!.value).toBe('never');
  });

  it('never names the workspace lead, an agent younger than the window, or one that ran inside it', () => {
    expect(deriveFindings(signals([agent({ isWorkspaceLead: true, lastActiveAt: null })]), config)).toEqual([]);
    expect(deriveFindings(signals([agent({ createdAt: ago(5), lastActiveAt: null })]), config)).toEqual([]);
    expect(deriveFindings(signals([agent({ lastActiveAt: ago(13) })]), config)).toEqual([]);
  });

  it('reads the workspace\'s own window', () => {
    expect(deriveFindings(signals([agent({ lastActiveAt: ago(20) })]), { idleDays: 30 })).toEqual([]);
  });
});

describe('spend', () => {
  const agreeing = [{ subjectKey: 'hubspot.update', decided: 10, rejected: 0, withRecommendation: 10, agreed: 9 }];
  const disagreeing = [{ subjectKey: 'hubspot.update', decided: 10, rejected: 7, withRecommendation: 10, agreed: 2 }];

  it('raises the cap of an agent stopped at it while people accept its work', () => {
    const [f] = deriveFindings(signals([agent({ today: { spentCents: 10_000, hardCentsLimit: 10_000, blocked: true }, decisions: agreeing })]), config);

    expect(f).toMatchObject({ signal: 'spend', allowed: ['set_budget'], fallback: { change: { kind: 'set_budget', agentSlug: 'deal-desk', dailyCents: 15_000 } } });
  });

  it('halves the cap of an agent spending on work people turn down, and lets the judge choose otherwise', () => {
    const [f] = deriveFindings(signals([agent({ spentCents: 4_000, decisions: disagreeing })]), config);

    expect(f).toMatchObject({ signal: 'spend', allowed: ['set_budget', 'retire_agent', 'adopt_rule'], fallback: { change: { kind: 'set_budget', dailyCents: 5_000 } } });
  });

  it('says nothing about spend with too few decisions to read, or too little money to matter', () => {
    expect(deriveFindings(signals([agent({ spentCents: 4_000, decisions: [{ subjectKey: 'x', decided: 3, rejected: 3, withRecommendation: 3, agreed: 0 }] })]), config).filter(f => f.signal === 'spend')).toEqual([]);
    expect(deriveFindings(signals([agent({ spentCents: 100, decisions: disagreeing })]), config).filter(f => f.signal === 'spend')).toEqual([]);
  });
});

describe('rejections and escalations', () => {
  const rejected = [{ subjectKey: 'gmail.send', decided: 6, rejected: 4, withRecommendation: 6, agreed: 2 }];

  it('finds a kind people keep turning down — only when they said why', () => {
    // Under the spend floor, so the only thing to find is the pattern itself.
    expect(deriveFindings(signals([agent({ spentCents: 100, decisions: rejected })]), config)).toEqual([]);

    const [f] = deriveFindings(signals([agent({ spentCents: 100, decisions: rejected, rejectionNotes: ['gmail.send: too long for a first touch'] })]), config);

    expect(f).toMatchObject({ id: 'rejections:deal-desk:gmail.send', allowed: ['adopt_rule'], fallback: null });
    expect(f!.facts).toContain('rejection note — gmail.send: too long for a first touch');
    expect(f!.evidence[0]!.href).toBe('/dashboard/inbox?tab=decided&kind=proposal&agents=deal-desk&actionKind=gmail.send');
  });

  it('finds an agent asking by habit when the answers give a rule something to learn from', () => {
    const asks = { filed: 6, answered: 5, byKind: { input: 5, ruling: 1 } };

    expect(deriveFindings(signals([agent({ asks })]), config)).toEqual([]);

    const [f] = deriveFindings(signals([agent({ asks, answeredAsks: [{ title: 'Which price list for Contoso?', decision: 'other', note: 'Always the EU list' }] })]), config);

    expect(f).toMatchObject({ signal: 'escalations', allowed: ['adopt_rule'] });
    expect(f!.facts.at(-1)).toBe('asked "Which price list for Contoso?" — answered other: Always the EU list');
  });
});

describe('teams behind on their measure', () => {
  it('offers the roles the catalog has for the team, and nothing else', () => {
    const [f] = deriveFindings(signals([agent()], [team()]), config);

    expect(f).toMatchObject({ id: 'measures:revenue-ops', allowed: ['hire_agent'], catalog: [{ slug: 'seo-specialist' }], fallback: null });
    expect(f!.evidence[0]!.value).toBe('2 referrals of 10 referrals (20%) over 30d — human-confirmed');
  });

  it('is silent for a team on target, with nothing to hire, or whose measure could not be read', () => {
    expect(deriveFindings(signals([], [team({ primary: { ...team().primary!, attainment: 0.8 } })]), config)).toEqual([]);
    expect(deriveFindings(signals([], [team({ unhired: [] })]), config)).toEqual([]);
    expect(deriveFindings(signals([], [team({ primary: null })]), config)).toEqual([]);
  });
});

describe('ordering', () => {
  it('puts the strongest first, and gives an idle agent one card rather than several', () => {
    const findings = deriveFindings(signals([
      agent({ slug: 'a', lastActiveAt: ago(60), decisions: [{ subjectKey: 'gmail.send', decided: 6, rejected: 4, withRecommendation: 6, agreed: 2 }], rejectionNotes: ['gmail.send: no'] }),
      agent({ slug: 'b', spentCents: 100, decisions: [{ subjectKey: 'gmail.send', decided: 6, rejected: 4, withRecommendation: 6, agreed: 2 }], rejectionNotes: ['gmail.send: no'] }),
    ], [team()]), config);

    expect(findings.map(f => f.id)).toEqual(['idle:a', 'rejections:b:gmail.send', 'measures:revenue-ops']);
  });
});
