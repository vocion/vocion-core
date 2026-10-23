/**
 * A goal's arithmetic, pure: horizons, a view measure's progress (counted,
 * never ticked), milestones completed by their linked work and overridden by
 * the person, a sprint's weeks and scorecard, the stall clock, the next steps
 * and the conversation objective that points at a goal. Fixtures are fictional (Northwind Expo).
 */
import { describe, expect, it } from 'vitest';
import { completeFromLinks, horizonLabel, localDay, measureProblem, milestoneProgress, milestonesFrom, nextStepsFor, parseHorizon, quarterEnd, setMilestone, setSprintNote, setSprintValue, sprintProgress, sprintTargetsFrom, sprintWeeks, stalledFor, viewProgress, weakestTarget, weekOf } from './goal';
import { goalObjectiveView, progressLine, readObjective, readSetupObjective } from './objective';

const NOW = new Date('2026-10-09T15:00:00Z');

describe('a horizon', () => {
  it('reads a date or a quarter, in the words people write them', () => {
    expect(parseHorizon('2026-11-30', NOW)).toEqual({ kind: 'date', due: '2026-11-30' });
    expect(parseHorizon('2026-Q4', NOW)).toEqual({ kind: 'quarter', quarter: '2026-Q4' });
    expect(parseHorizon('q4 2026', NOW)).toEqual({ kind: 'quarter', quarter: '2026-Q4' });
    expect(parseHorizon('2026 Q1', NOW)).toEqual({ kind: 'quarter', quarter: '2026-Q1' });
    // A bare quarter already past this year is next year's.
    expect(parseHorizon('Q2', NOW)).toEqual({ kind: 'quarter', quarter: '2027-Q2' });
    expect(parseHorizon('Q4', NOW)).toEqual({ kind: 'quarter', quarter: '2026-Q4' });
    expect(parseHorizon('soon', NOW)).toBeNull();
  });

  it('says itself, and ends where the quarter does', () => {
    expect(horizonLabel({ kind: 'date', due: '2026-11-30' })).toBe('by Nov 30, 2026');
    expect(horizonLabel({ kind: 'quarter', quarter: '2026-Q4' })).toBe('in Q4 2026');
    expect(quarterEnd({ kind: 'quarter', quarter: '2026-Q4' }).toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });
});

describe('a view measure', () => {
  it('counts the rows marked done against the view, or against a target', () => {
    const measure = { kind: 'view' as const, view: 'northwind-expo-contacts', done: { reply_state: 'replied' }, unit: 'contacted' };

    expect(viewProgress(measure, { total: 40, done: 12 })).toMatchObject({ done: 12, total: 40, label: '12 of 40 contacted', ratio: 0.3 });
    expect(viewProgress({ ...measure, target: 30 }, { total: 40, done: 12 })).toMatchObject({ done: 12, total: 30, label: '12 of 30 contacted' });
    // No done facets: the view's own count against a target ("10 partners active").
    expect(viewProgress({ kind: 'view', view: 'active-partners', target: 10, unit: 'active' }, { total: 4, done: 0 })).toMatchObject({ done: 4, total: 10, label: '4 of 10 active' });
  });

  it('says it cannot be measured rather than guessing', () => {
    const p = viewProgress({ kind: 'view', view: 'active-partners' }, { total: 4, done: 0 });

    expect(p.ratio).toBeNull();
    expect(p.unmeasured).toMatch(/nothing to measure/);
    expect(measureProblem({ kind: 'view', view: 'active-partners' })).toMatch(/done facets|target/);
  });
});

describe('milestones', () => {
  const plan = milestonesFrom([
    { label: 'Draft the partner one-pager', link: { kind: 'artifact', id: '31' } },
    { label: 'Agree the referral terms', link: { kind: 'record', id: '77' } },
    { label: 'Brief the first three partners' },
  ]);

  it('takes 3 to 7', () => {
    expect(measureProblem({ kind: 'milestones', milestones: plan })).toBeNull();
    expect(measureProblem({ kind: 'milestones', milestones: plan.slice(0, 2) })).toMatch(/3 to 7/);
  });

  it('are done when their linked work completes, by the agent, and never un-done by a check', () => {
    const states = new Map([['artifact:31', 'complete' as const], ['record:77', 'open' as const]]);
    const after = completeFromLinks(plan, states, NOW);

    expect(after.map(m => m.done)).toEqual([true, false, false]);
    expect(after[0]).toMatchObject({ by: 'agent', doneAt: NOW.toISOString() });
    expect(milestoneProgress(after)).toMatchObject({ done: 1, total: 3, label: '1 of 3 milestones' });
    // Nothing moved: the same array back, so nothing is written.
    expect(completeFromLinks(after, states, NOW)).toBe(after);
  });

  it('keep the person\'s hand: their tick or untick locks the step against the agent and every check', () => {
    const unticked = setMilestone(plan, 'm1', false, 'usr-dana', NOW).milestones;
    const locked = setMilestone(unticked, 'm1', false, 'usr-dana', NOW);

    expect(unticked[0]!.locked).toBe(true);
    expect(locked.changed).toBe(false);
    // The work completing does not override the person.
    expect(completeFromLinks(unticked, new Map([['artifact:31', 'complete' as const]]), NOW)[0]!.done).toBe(false);
    // Nor may the agent.
    expect(setMilestone(unticked, 'm1', true, 'agent', NOW, 'ART-31 is written').refused).toMatch(/set .* themselves/);
  });

  it('the agent marks one done only with evidence', () => {
    expect(setMilestone(plan, 'm3', true, 'agent', NOW).refused).toMatch(/evidence/);

    const done = setMilestone(plan, 'm3', true, 'agent', NOW, 'CHAT-405: briefed Kestrel, Contoso and Acme');

    expect(done.changed).toBe(true);
    expect(done.milestones[2]).toMatchObject({ done: true, by: 'agent', evidence: 'CHAT-405: briefed Kestrel, Contoso and Acme' });
    expect(done.milestones[2]!.locked).toBeUndefined();
    expect(setMilestone(plan, 'm9', true, 'usr-dana', NOW).refused).toMatch(/No milestone/);
  });
});

describe('the stall clock and the next steps', () => {
  const base = { title: 'Follow up with Northwind Expo contacts', status: 'active' as const, nextSteps: [], createdAt: new Date('2026-09-01T00:00:00Z') };

  it('reads an active goal with no progress in a week as stalled', () => {
    expect(stalledFor({ ...base, progressAt: new Date('2026-09-30T00:00:00Z') }, NOW)).toBe(9);
    expect(stalledFor({ ...base, progressAt: new Date('2026-10-06T00:00:00Z') }, NOW)).toBeNull();
    expect(stalledFor({ ...base, status: 'paused', progressAt: null }, NOW)).toBeNull();
    // Never moved: counted from when it was set.
    expect(stalledFor({ ...base, progressAt: null }, NOW)).toBe(38);
  });

  it('proposes up to three prompts: the agent\'s own, else from where the goal stands', () => {
    const view = { ...base, measure: { kind: 'view' as const, view: 'northwind-expo-contacts', done: { reply_state: 'replied' } } };
    const steps = nextStepsFor(view, { done: 12, total: 40, ratio: 0.3, label: '12 of 40' }, 'Northwind Expo contacts');

    expect(steps[0]!.label).toBe('Take the next 5 in “Northwind Expo contacts”');
    expect(steps[0]!.prompt).toContain('Follow up with Northwind Expo contacts');
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(nextStepsFor({ ...view, nextSteps: [{ label: 'Draft the Kestrel note', prompt: 'Draft my note to Kestrel Capital' }] }, { done: 0, total: 1, ratio: 0, label: '' })).toEqual([{ label: 'Draft the Kestrel note', prompt: 'Draft my note to Kestrel Capital' }]);
    expect(nextStepsFor({ ...view, status: 'done' }, { done: 40, total: 40, ratio: 1, label: '' })).toEqual([]);
  });
});

describe('objectives gain a kind', () => {
  it('reads a goal objective, and a setup exactly as before', () => {
    const goal = { kind: 'goal', goalId: 12, state: 'running', startedAt: NOW.toISOString() };
    const setup = { kind: 'setup', plugin: 'software-factory', state: 'running', startedAt: NOW.toISOString() };

    expect(readObjective(goal)).toEqual(goal);
    expect(readObjective({ ...goal, goalId: 'twelve' })).toBeNull();
    expect(readObjective(setup)).toEqual(setup);
    expect(readSetupObjective(goal)).toBeNull();
    expect(readObjective({ kind: 'later-kind', state: 'running', startedAt: NOW.toISOString() })).toBeNull();
  });

  it('draws a goal on the strip with its progress and milestones', () => {
    const view = goalObjectiveView(9, { kind: 'goal', goalId: 12, state: 'running', startedAt: NOW.toISOString() }, {
      title: 'Build referral partner collateral',
      status: 'active',
      milestones: [{ key: 'm1', label: 'One-pager', done: true }, { key: 'm2', label: 'Deck', done: false }, { key: 'm3', label: 'Case study', done: false }],
      progress: { done: 1, total: 3, label: '1 of 3 milestones' },
    })!;

    expect(view).toMatchObject({ kind: 'goal', goalId: 12, current: 1, done: 1, total: 3 });
    expect(progressLine(view)).toBe('Goal: Build referral partner collateral · 1 of 3 milestones');
    expect(progressLine({ ...view, state: 'stopped' })).toBe('Paused · Build referral partner collateral · 1 of 3 milestones');
    expect(goalObjectiveView(9, { kind: 'goal', goalId: 12, state: 'running', startedAt: '' }, null)).toBeNull();
  });
});

describe('a sprint', () => {
  const END = { kind: 'date' as const, due: '2027-01-23' };
  const targets = sprintTargetsFrom([{ label: 'Discovery calls', perWeek: 3 }, { label: 'Partner touches', perWeek: 5, unit: 'touches' }]);
  const sprint = { kind: 'sprint' as const, starts: '2026-10-26', targets, weeks: [] };

  it('runs in weeks, each known by its Monday, whatever day it is read on', () => {
    expect(weekOf('2026-10-28')).toBe('2026-10-26');
    expect(weekOf('2026-11-01')).toBe('2026-10-26'); // a Sunday ends the week
    expect(weekOf('2026-11-02')).toBe('2026-11-02');
    expect(sprintWeeks('2026-10-26', END)).toHaveLength(13);
    // The person's day, in their zone: still Sunday on the coast when it is Monday in UTC.
    expect(localDay(new Date('2026-10-26T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-25');
    expect(localDay(new Date('2026-10-26T05:00:00Z'), 'Not/AZone')).toBe('2026-10-26');
  });

  it('takes 2 to 10 weekly targets, each a whole number a week, and a start before its end', () => {
    expect(measureProblem(sprint, END)).toBeNull();
    expect(measureProblem({ ...sprint, targets: targets.slice(0, 1) }, END)).toMatch(/2 to 10/);
    expect(measureProblem({ ...sprint, targets: sprintTargetsFrom(Array.from({ length: 11 }, (_, i) => ({ label: `Target ${i}`, perWeek: 1 }))) }, END)).toMatch(/2 to 10/);
    expect(measureProblem({ ...sprint, targets: sprintTargetsFrom(Array.from({ length: 10 }, (_, i) => ({ label: `Target ${i}`, perWeek: 1 }))) }, END)).toBeNull();
    expect(measureProblem({ ...sprint, targets: [targets[0]!, { ...targets[1]!, perWeek: 0 }] }, END)).toMatch(/whole number/);
    expect(measureProblem({ ...sprint, starts: '2027-02-01' }, END)).toMatch(/after it ends/);
    expect(measureProblem({ ...sprint, starts: '2026-02-30' }, END)).toMatch(/not a start date/);
  });

  it('logs a week with evidence; the person\'s number holds against the agent, and their clear lets it go', () => {
    const today = '2026-10-29';

    expect(setSprintValue(sprint, END, today, 't1', 2, 'agent', today).refused).toMatch(/evidence/);

    const logged = setSprintValue(sprint, END, today, 't1', 2, 'agent', today, '2 discovery calls on the calendar');

    expect(logged.changed).toBe(true);
    expect(logged.measure.weeks).toEqual([{ week: '2026-10-26', values: { t1: { value: 2, by: 'agent', evidence: '2 discovery calls on the calendar' } } }]);

    const mine = setSprintValue(logged.measure, END, today, 't1', 3, 'usr-dana', today);

    expect(mine.measure.weeks[0]!.values.t1).toMatchObject({ value: 3, by: 'usr-dana', locked: true });
    expect(setSprintValue(mine.measure, END, today, 't1', 1, 'agent', today, 'calendar').refused).toMatch(/themselves/);
    expect(setSprintValue(mine.measure, END, today, 't1', null, 'agent', today).refused).toMatch(/Only the person/);

    const cleared = setSprintValue(mine.measure, END, today, 't1', null, 'usr-dana', today);

    expect(cleared.measure.weeks).toEqual([]);
    // A week that has not started, or one outside the sprint, is refused by name.
    expect(setSprintValue(sprint, END, '2026-11-02', 't1', 1, 'usr-dana', today).refused).toMatch(/has not started/);
    expect(setSprintValue(sprint, END, '2026-10-19', 't1', 1, 'usr-dana', today).refused).toMatch(/outside the sprint/);
    expect(setSprintValue(sprint, END, today, 't9', 1, 'usr-dana', today).refused).toMatch(/No weekly target "t9"/);
  });

  it('reads as the week it is and the weekly targets met of those logged; a week nobody logged is a gap, not a miss', () => {
    expect(sprintProgress(sprint, END, '2026-10-27')).toMatchObject({ label: 'Week 1 of 13 · nothing logged yet', ratio: null, week: 1, weeks: 13 });
    expect(sprintProgress(sprint, END, '2026-10-20').label).toMatch(/^Starts Oct 26, 2026/);

    let m = setSprintValue(sprint, END, '2026-10-26', 't1', 3, 'usr-dana', '2026-11-04').measure;
    m = setSprintValue(m, END, '2026-10-26', 't2', 2, 'usr-dana', '2026-11-04').measure;
    m = setSprintNote(m, '2026-10-30', 'Two partners out this week.');

    expect(sprintProgress(m, END, '2026-11-04')).toMatchObject({ done: 1, total: 2, ratio: 0.5, label: 'Week 2 of 13 · 1 of 2 weekly targets met' });
    expect(m.weeks[0]!.note).toBe('Two partners out this week.');
    expect(weakestTarget(m)?.key).toBe('t2');

    const steps = nextStepsFor({ title: 'Sprint 2', measure: m, nextSteps: [], status: 'active' }, sprintProgress(m, END, '2026-11-04'), undefined, '2026-11-04');

    expect(steps.map(s => s.label)).toEqual(['Log this week\'s numbers', 'What would move Partner touches?', 'What is in the way?']);
  });

  it('keeps a target\'s key when it is re-planned, so its logged weeks stay put', () => {
    const next = sprintTargetsFrom([{ label: 'Partner touches', perWeek: 4 }, { label: 'Proposals sent', perWeek: 1 }], targets);

    expect(next.map(t => [t.key, t.label, t.perWeek])).toEqual([['t2', 'Partner touches', 4], ['t3', 'Proposals sent', 1]]);
  });
});
