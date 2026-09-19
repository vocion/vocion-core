import type { PluginContents } from '@/libs/workspace/plugins';
import type { MeasureReading } from '@/services/team-report';
import { describe, expect, it } from 'vitest';
import { actionPill, learningPill, planPluginPanel, truncateRule } from './pluginPanelPlan';

/**
 * The plugin outcome panel's view model, on fixtures — no database, no
 * filesystem. Fictional cast only (Northwind, Kestrel): the plugin here is a
 * made-up `briefings` one, so the test proves the panel is driven by the
 * manifest rather than by the three plugins core happens to ship.
 */

const contents = (over: Partial<PluginContents> = {}): PluginContents => ({
  agents: [],
  skills: [],
  playbooks: [],
  objectTypes: [],
  missions: [],
  automations: [],
  teams: [],
  pages: [],
  hasTrust: false,
  hasReadme: false,
  ...over,
});

function reading(key: string, label: string, value: number | null): MeasureReading {
  return {
    measure: {
      key,
      label,
      dimension: 'outcome',
      target: 10,
      window: '7d',
      direction: 'higher',
      unit: 'briefs',
      source: { kind: 'agent-reported', counts: key },
    },
    value,
    previous: null,
    provenance: 'agent-reported',
    sourceLabel: 'worker reports',
    asOf: null,
    freshness: { asOf: null, ageMs: 0, stale: false, note: null },
    attainment: value === null ? null : value / 10,
    met: value !== null && value >= 10,
    delta: null,
    trend: null,
    improving: null,
    unavailableReason: value === null ? 'no reading yet' : null,
    unavailableKind: value === null ? 'unconfigured' : null,
  };
}

describe('planPluginPanel', () => {
  const base = {
    pluginName: 'Briefings',
    contents: contents({ agents: ['brief-writer', 'brief-editor'], skills: ['morning-brief'], playbooks: ['house-voice'] }),
    teams: [{ slug: 'briefings', name: 'Briefings' }],
    readings: new Map([
      ['briefings/briefs_sent', reading('briefs_sent', 'Briefs sent', 7)],
      // A reading for a team this plugin does not own never reaches the panel.
      ['revenue/qualified_referrals', reading('qualified_referrals', 'Qualified referrals', 3)],
    ]),
    agents: [{ slug: 'brief-writer', name: 'Brief Writer', description: 'Writes the morning brief.' }],
    learnings: [],
    actions: [],
  };

  it('titles itself after the plugin and keeps only that plugin’s readings', () => {
    const view = planPluginPanel(base);

    expect(view.title).toBe('How Briefings is doing');
    expect(view.measures.map(m => m.id)).toEqual(['briefings/briefs_sent']);
    expect(view.measures[0]!.teamName).toBe('Briefings');
    expect(view.measures[0]!.reading).toBe(base.readings.get('briefings/briefs_sent'));
  });

  it('lists every declared agent, naming the ones apply has written and falling back to the slug', () => {
    const view = planPluginPanel(base);

    expect(view.agents).toEqual([
      { slug: 'brief-writer', name: 'Brief Writer', description: 'Writes the morning brief.', profileHref: '/dashboard/agents/brief-writer', chatHref: '/dashboard/chat?agent=brief-writer' },
      { slug: 'brief-editor', name: 'Brief editor', description: null, profileHref: '/dashboard/agents/brief-editor', chatHref: '/dashboard/chat?agent=brief-editor' },
    ]);
  });

  it('says where each skill and playbook is overridden — the customise door, not a second copy of it', () => {
    const view = planPluginPanel(base);

    expect(view.skills).toEqual([
      { slug: 'morning-brief', label: 'Morning brief', href: '/dashboard/skills/morning-brief', hint: 'override at workspace/skills/morning-brief' },
      { slug: 'house-voice', label: 'House voice', href: '/dashboard/skills/house-voice', hint: 'override at workspace/playbooks/house-voice' },
    ]);
  });

  it('says nothing has been learned only when there is neither a learning nor a decision', () => {
    expect(planPluginPanel(base).nothingLearned).toBe(true);

    const taught = planPluginPanel({
      ...base,
      learnings: [{ id: 4, text: 'Name the Kestrel Capital owner in the first line.', status: 'approved', at: new Date('2026-09-17T10:00:00Z'), step: 'brief-writing' }],
      actions: [{ id: 9, title: 'Send the Northwind brief', status: 'done', at: new Date('2026-09-18T08:00:00Z') }],
    });

    expect(taught.nothingLearned).toBe(false);
    expect(taught.learnings[0]!.text).toBe('Name the Kestrel Capital owner in the first line.');
    expect(taught.actions[0]).toMatchObject({ id: 9, title: 'Send the Northwind brief', status: 'done' });
  });

  it('is empty, not broken, for a plugin that ships nothing', () => {
    const view = planPluginPanel({ ...base, contents: contents(), teams: [], readings: new Map(), agents: [] });

    expect(view).toMatchObject({ measures: [], agents: [], skills: [], nothingLearned: true });
  });
});

describe('rule text and status pills', () => {
  it('cuts a long rule on a word boundary and leaves a short one alone', () => {
    expect(truncateRule('  Keep it   short. ')).toBe('Keep it short.');

    const long = `Always open with the owner and the stage, then the one number that moved, ${'and never pad the brief with restated context '.repeat(3)}`;
    const cut = truncateRule(long);

    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(121);
    expect(cut).not.toMatch(/\s…$/);
  });

  it('reads an approved candidate as adopted, and names the three ends a decided action reaches', () => {
    expect(learningPill('approved')).toEqual({ status: 'completed', label: 'Adopted' });
    expect(learningPill('rejected')).toEqual({ status: 'rejected', label: 'Rejected' });
    expect(learningPill('pending')).toEqual({ status: 'pending', label: 'Pending' });

    expect(actionPill('done')).toEqual({ status: 'completed', label: 'Executed' });
    expect(actionPill('rejected')).toEqual({ status: 'rejected', label: 'Rejected' });
    expect(actionPill('undone')).toEqual({ status: 'cancelled', label: 'Undone' });
  });
});
