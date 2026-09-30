import type { ConfigureInput } from './configurePlan';
import { describe, expect, it } from 'vitest';
import { attentionItems, chosenTab, measureChange, planConfigure } from './configurePlan';

/**
 * The Configure page, from its reads — a fictional plugin ("Kestrel desk")
 * with two seats, three skills, three automations, two trust rules, two
 * learnings, two measures and three changes. Nothing here names a real
 * plugin, agent or action: the plan is the same for any of them.
 */

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

function fixture(over: Partial<ConfigureInput> = {}): ConfigureInput {
  return {
    pluginName: 'Kestrel desk',
    seats: [
      { slug: 'desk-lead', name: 'Desk lead', seat: 'Kestrel desk · Lead', role: 'lead', model: 'model-large', owns: ['Every ask answered in a day'], lastRunAt: hoursAgo(3), overBudget: null },
      { slug: 'desk-checker', name: 'Desk checker', seat: 'Kestrel desk · QA', role: 'specialist', model: 'model-small', owns: [], lastRunAt: null, overBudget: null },
    ],
    skills: [
      { slug: 'read-the-ask', name: 'Reading the ask', kind: 'skill', source: 'plugin', updatedAt: hoursAgo(48), drifted: false },
      { slug: 'write-the-reply', name: 'Writing the reply', kind: 'skill', source: 'override', updatedAt: hoursAgo(24), drifted: false },
      { slug: 'house-tone', name: 'House tone', kind: 'playbook', source: 'plugin', updatedAt: null, drifted: false },
    ],
    automations: [
      { slug: 'desk-daily', name: 'Daily sweep', trigger: 'Every day at 06:00 (UTC)', does: 'Sweeps the open asks.', disabled: false, paused: null, last: { at: hoursAgo(6), status: 'ok', error: null, failedToStart: false } },
      { slug: 'desk-on-file', name: 'On filing', trigger: 'On object.created', does: 'Triages a new ask.', disabled: false, paused: null, last: { at: hoursAgo(1), status: 'ok', error: null, failedToStart: false } },
      { slug: 'desk-weekly', name: 'Weekly note', trigger: 'Every Monday (UTC)', does: 'Writes the weekly note.', disabled: false, paused: { by: 'Mara Okafor', at: hoursAgo(30), note: 'holiday' }, last: null },
    ],
    trust: [
      { key: 'desk.file_ask', name: 'File an ask', parent: null, runsOnItsOwn: true, rungLabel: 'Execute within bounds', minConfidence: 0.8, risk: 'low', flagged: false },
      { key: 'desk.send_reply', name: 'Send a reply', parent: null, runsOnItsOwn: false, rungLabel: 'Execute with approval', minConfidence: 1, risk: 'high', flagged: false },
    ],
    learnings: [
      { id: 'rule:1', text: 'Quote the asker\'s own words back in the first line.', status: 'adopted', at: hoursAgo(20), step: 'desk-replies', origin: 'Review feedback' },
      { id: 'candidate:2', text: 'Never promise a date.', status: 'pending', at: hoursAgo(2), step: 'desk-replies', origin: 'Learning queue' },
    ],
    measures: [
      { id: 'desk/answered', label: 'Asks answered', teamName: 'Kestrel desk', unit: 'asks', target: 10, direction: 'higher', window: '7d', value: 12, previous: 8, improving: true, sourceLabel: 'review decisions' },
      { id: 'desk/minutes', label: 'Minutes to first reply', teamName: 'Kestrel desk', unit: undefined, target: 30, direction: 'lower', window: '7d', value: 40, previous: 32, improving: false, sourceLabel: 'worker reports' },
    ],
    changes: [
      { id: 'control:1', what: 'Paused Weekly note', who: 'Mara Okafor', at: hoursAgo(30), href: '/dashboard/automation/desk-weekly' },
      { id: 'apply:2', what: 'Workspace applied · 3 changes', who: 'Mara Okafor', at: hoursAgo(5), href: '/dashboard/workspace' },
      { id: 'policy:desk.file_ask', what: 'File an ask → Execute within bounds', who: 'Vocion', at: hoursAgo(50), href: '/dashboard/autonomy' },
    ],
    ...over,
  };
}

describe('planConfigure', () => {
  it('draws one tab per declared relation, each with its count, in the declared order', () => {
    const view = planConfigure(fixture(), undefined, { now: NOW });

    expect(view.tabs.map(t => [t.key, t.label, t.count])).toEqual([
      ['seats', 'Seats', 2],
      ['skills', 'Skills & playbooks', 3],
      ['automations', 'Automations', 3],
      ['trust', 'Trust rules', 2],
      ['learned', 'Learned', 2],
      ['measures', 'Measures', 2],
    ]);
    expect(view.active).toBe('seats');
  });

  it('keeps only the tabs a page declares, under its own labels', () => {
    const view = planConfigure(fixture(), { tabs: [{ kind: 'automations' }, { kind: 'seats', label: 'Agents' }], aside: [{ kind: 'changes' }] }, { now: NOW });

    expect(view.tabs.map(t => [t.key, t.label])).toEqual([['automations', 'Automations'], ['seats', 'Agents']]);
    expect(view.aside.map(a => a.kind)).toEqual(['changes']);
  });

  it('reads the tab from the URL, and falls back to the first for a tab the page does not show', () => {
    expect(planConfigure(fixture(), undefined, { tab: 'trust', now: NOW }).active).toBe('trust');
    expect(planConfigure(fixture(), undefined, { tab: ['learned', 'seats'], now: NOW }).active).toBe('learned');
    expect(chosenTab(['seats', 'skills'], 'measures')).toBe('seats');
    expect(chosenTab(['skills', 'seats'], undefined)).toBe('skills');
  });

  it('opens a seat in the preview pane and keeps it a link to the agent', () => {
    const seats = planConfigure(fixture(), undefined, { now: NOW }).tabs.find(t => t.key === 'seats')!;
    const lead = seats.rows[0]!;

    expect(lead.preview).toEqual({ type: 'agent', id: 'desk-lead' });
    expect(lead.href).toBe('/dashboard/agents/desk-lead');
    // The plugin's name is the page's, so the seat drops it; the seats differ
    // in role, so the lead says it is one.
    expect(lead.facts).toEqual(['Lead', 'Lead', 'model-large', 'Owns Every ask answered in a day']);
    expect(lead.figure).toBe('3 hours ago');
    // A seat that never ran shows no figure rather than a dash that says so.
    expect(seats.rows[1]!.figure).toBeNull();
  });

  it('marks the workspace\'s overrides apart from what the plugin ships', () => {
    const skills = planConfigure(fixture(), undefined, { now: NOW }).tabs.find(t => t.key === 'skills')!;

    expect(skills.rows.map(r => r.chip?.label)).toEqual([undefined, 'Workspace override', undefined]);
    expect(skills.note).toBe('1 override in the workspace');
  });

  it('says an automation failed to start, with its reason, and counts it on the tab', () => {
    const input = fixture();
    input.automations[1]!.last = { at: hoursAgo(1), status: 'error', error: 'matched object.created and could not start: mission not found\nstack…', failedToStart: true };
    const automations = planConfigure(input, undefined, { now: NOW }).tabs.find(t => t.key === 'automations')!;
    const row = automations.rows.find(r => r.id === 'desk-on-file')!;

    expect(row.chip).toEqual({ label: 'Failed to start', tone: 'bad' });
    expect(row.facts).toContain('matched object.created and could not start: mission not found');
    expect(automations.note).toBe('1 failing · 1 paused');
    expect(automations.rows.find(r => r.id === 'desk-weekly')!.chip).toEqual({ label: 'Paused', tone: 'warn' });
  });

  it('draws a chip only where an automation is out of the ordinary', () => {
    const input = fixture();
    input.automations[2]!.paused = null;
    const rows = planConfigure(input, undefined, { now: NOW }).tabs.find(t => t.key === 'automations')!.rows;

    // A healthy fire is its time; one that never fired says so in the same place.
    expect(rows.find(r => r.id === 'desk-daily')).toMatchObject({ chip: null, figure: '6 hours ago' });
    expect(rows.find(r => r.id === 'desk-weekly')).toMatchObject({ chip: null, figure: 'Never fired' });
  });

  it('says which action classes run on their own and which ask', () => {
    const trust = planConfigure(fixture(), undefined, { now: NOW }).tabs.find(t => t.key === 'trust')!;

    expect(trust.rows.map(r => r.chip?.label)).toEqual(['Runs on its own', 'Asks']);
    expect(trust.note).toBe('1 run on their own · 1 ask');
    expect(trust.rows[0]!.facts).toContain('above 80% confidence');
    // The raw policy key is trust.yaml's spelling, not a row's.
    expect(trust.rows[0]!.facts).not.toContain('desk.file_ask');
  });

  it('says where each learning came from', () => {
    const learned = planConfigure(fixture(), undefined, { now: NOW }).tabs.find(t => t.key === 'learned')!;

    expect(learned.rows.map(r => r.facts[0])).toEqual(['Review feedback', 'Learning queue']);
    expect(learned.note).toBe('1 to decide');
    expect(learned.rows[0]!.href).toBe('/dashboard/learnings/desk-replies');
  });
});

describe('the sidebar', () => {
  it('carries every measure with its direction and the change against the prior window', () => {
    const health = planConfigure(fixture(), undefined, { now: NOW }).aside.find(a => a.kind === 'health');

    expect(health?.kind === 'health' && health.items.map(i => [i.label, i.value, i.target, i.change])).toEqual([
      ['Asks answered', '12 asks', 'target ≥ 10 asks', { label: '↑ 50% vs last week', tone: 'ok' }],
      // Up is BAD when lower is better: the colour follows the measure.
      ['Minutes to first reply', '40', 'target ≤ 30', { label: '↑ 25% vs last week', tone: 'bad' }],
    ]);
  });

  it('draws no change for a measure with no prior window, and no colour where nothing says which way is good', () => {
    const [m] = fixture().measures;

    expect(measureChange({ ...m!, previous: null })).toBeNull();
    expect(measureChange({ ...m!, previous: 12 })).toEqual({ label: '= last week', tone: 'muted' });
    expect(measureChange({ ...m!, improving: null })?.tone).toBe('muted');
    expect(measureChange({ ...m!, previous: 0 })?.label).toBe('↑ 12 asks vs last week');
  });

  it('hides Needs attention when nothing needs a person', () => {
    const view = planConfigure(fixture(), undefined, { now: NOW });

    expect(attentionItems(fixture())).toEqual([]);
    expect(view.aside.map(a => a.kind)).toEqual(['health', 'changes']);
  });

  it('lists what needs a person as links: an errored automation, a seat over budget, a drifted override, a demotion, an unread measure', () => {
    const input = fixture();
    input.automations[0]!.last = { at: hoursAgo(1), status: 'error', error: 'boom', failedToStart: false };
    input.seats[1]!.overBudget = { spentCents: 1200, limitCents: 1000 };
    input.skills[1]!.drifted = true;
    input.trust[1]!.flagged = true;
    input.measures[1]!.value = null;
    const attention = planConfigure(input, undefined, { now: NOW }).aside.find(a => a.kind === 'attention');

    expect(attention?.kind === 'attention' && attention.items.map(i => [i.label, i.detail, i.href])).toEqual([
      ['Daily sweep', 'Errored on its last run', '/dashboard/automation/desk-daily'],
      ['Desk checker', 'Over budget — new runs are refused', '/dashboard/agents/desk-checker'],
      ['Writing the reply', 'Your override is behind the plugin', '/dashboard/skills/write-the-reply'],
      ['Send a reply', 'Demoted itself — asks again', '/dashboard/autonomy'],
      ['Minutes to first reply', 'Nothing reads it yet — connect a source', '/dashboard/team-report'],
    ]);
  });

  it('names a seat without the plugin\'s own name, and drops a role every seat shares', () => {
    const input = fixture();
    input.seats = input.seats.map(s => ({ ...s, role: 'lead' }));
    input.seats[1]!.seat = 'Kestrel desk · Desk checker';
    const rows = planConfigure(input, undefined, { now: NOW }).tabs.find(t => t.key === 'seats')!.rows;

    expect(rows[0]!.facts).toEqual(['Lead', '', 'model-large', 'Owns Every ask answered in a day']);
    // A seat that only repeats the agent's name says nothing.
    expect(rows[1]!.facts[0]).toBe('');
  });

  it('a paused automation that last errored is not asking for anyone', () => {
    const input = fixture();
    input.automations[2]!.last = { at: hoursAgo(40), status: 'error', error: 'boom', failedToStart: false };

    expect(attentionItems(input)).toEqual([]);
  });

  it('lists recent changes newest first, with who and when', () => {
    const changes = planConfigure(fixture(), undefined, { now: NOW }).aside.find(a => a.kind === 'changes');

    expect(changes?.kind === 'changes' && changes.items.map(i => [i.label, i.who, i.when])).toEqual([
      ['Workspace applied · 3 changes', 'Mara Okafor', '5 hours ago'],
      ['Paused Weekly note', 'Mara Okafor', '1 day ago'],
      ['File an ask → Execute within bounds', 'Vocion', '2 days ago'],
    ]);
  });

  it('draws no health block for a plugin that declares no measures', () => {
    const view = planConfigure(fixture({ measures: [], changes: [] }), undefined, { now: NOW });

    expect(view.aside).toEqual([]);
  });
});
