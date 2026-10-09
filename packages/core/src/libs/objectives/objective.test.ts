import { describe, expect, it } from 'vitest';
import { objectiveView, progressLine, readObjective, readSetupObjective, setupObjectiveFor, withLater } from './objective';

/**
 * Context mid-objective (founder, 2026-10-09): one line that says what the
 * conversation is in the middle of, which step of how many, read live from
 * the plugin's own setup; and the next visit's "Resume setting up …".
 * Fixtures are fictional.
 */

const STEPS = [
  { key: 'connector:github', label: 'Connect GitHub', done: true },
  { key: 'records:product', label: 'Create the first product record', done: false },
  { key: 'records:repo', label: 'Create the first repo record', done: false },
];
const running = { kind: 'setup' as const, plugin: 'software-factory', state: 'running' as const, startedAt: '2026-10-09T05:00:00.000Z' };

describe('an objective, read', () => {
  it('reads what it can and nothing it cannot', () => {
    expect(readObjective(running)).toEqual(running);
    expect(readObjective(null)).toBeNull();
    expect(readObjective({ kind: 'onboarding', plugin: 'x', state: 'running', startedAt: 'now' })).toBeNull();
    expect(readObjective({ kind: 'setup', plugin: '', state: 'running', startedAt: 'now' })).toBeNull();
    expect(readObjective({ kind: 'setup', plugin: 'x', state: 'paused', startedAt: 'now' })).toBeNull();
  });

  it('says where it is: the step you are on, of how many', () => {
    const view = objectiveView(12, running, { name: 'Software Factory', steps: STEPS })!;

    expect(view).toMatchObject({ conversationId: 12, name: 'Software Factory', state: 'running', done: 1, total: 3, current: 1 });
    expect(progressLine(view)).toBe('Setting up Software Factory · 2 of 3');
  });

  it('says it is paused when the person stopped it, and set up when every step is done', () => {
    const paused = objectiveView(12, { ...running, state: 'stopped' }, { name: 'Software Factory', steps: STEPS })!;

    expect(progressLine(paused)).toBe('Paused setting up Software Factory · 2 of 3');

    const done = objectiveView(12, { ...running, state: 'stopped' }, { name: 'Software Factory', steps: STEPS.map(s => ({ ...s, done: true })) })!;

    expect(done.state).toBe('done');
    expect(progressLine(done)).toBe('Software Factory is set up');
  });

  it('draws nothing for a plugin that is no longer on', () => {
    expect(objectiveView(12, running, null)).toBeNull();
    expect(objectiveView(12, running, { name: 'Software Factory', steps: [] })).toBeNull();
  });
});

describe('which plugin a setup objective is about', () => {
  const setups = [{ plugin: 'software-factory', complete: false }, { plugin: 'growth-loop', complete: false }, { plugin: 'company', complete: true }];

  it('is the one the agent named, when it is on and unfinished', () => {
    expect(setupObjectiveFor(setups, 'software-factory')).toBe('software-factory');
    expect(setupObjectiveFor(setups, 'company')).toBeNull();
    expect(setupObjectiveFor(setups, 'not-installed')).toBeNull();
  });

  it('is the only one left when none was named — never a guess between two', () => {
    expect(setupObjectiveFor(setups)).toBeNull();
    expect(setupObjectiveFor([setups[0]!, setups[2]!])).toBe('software-factory');
    expect(setupObjectiveFor([setups[2]!])).toBeNull();
  });
});

describe('optional extras, kept for later', () => {
  it('keeps each once, reads them back, and never counts them as steps', () => {
    const kept = withLater(withLater(running, [{ key: 'plugin:wiki', label: 'Turn on Wiki' }]), [{ key: 'plugin:wiki', label: 'Turn on Wiki' }, { key: 'plugin:red-team', label: 'Turn on Red team' }]);

    expect(kept.later).toEqual([{ key: 'plugin:wiki', label: 'Turn on Wiki' }, { key: 'plugin:red-team', label: 'Turn on Red team' }]);
    expect(readSetupObjective(kept)!.later).toHaveLength(2);
    expect(withLater(kept, [])).toBe(kept);

    const view = objectiveView(12, kept, { name: 'Software Factory', steps: STEPS })!;

    expect(view.total).toBe(3);
    expect(view.later.map(x => x.label)).toEqual(['Turn on Wiki', 'Turn on Red team']);
  });
});
