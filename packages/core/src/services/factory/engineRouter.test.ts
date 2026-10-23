/**
 * Which engine builds a task (ADR 0005): a chain of policies, static today,
 * with room in front for a dynamic one, inside the installation's fence.
 */
import type { EngineRoutePolicy, TaskFeatures } from './engineRouter';
import { describe, expect, it } from 'vitest';
import { allowedEngines, complexityOf, engineIdOf, routeEngine, staticPolicy } from './engineRouter';

const base: TaskFeatures = { seat: 'task-engineer', taskEngine: null, seatEngine: null, riskClass: 'ui', repo: 'kestrel/app', plannedPaths: 2, complexity: 'small', estimatedCents: null };

describe('the static policy', () => {
  it('takes the task\'s own engine first', () => {
    const r = routeEngine({ ...base, taskEngine: { id: 'claude-cli', model: 'x' }, seatEngine: { id: 'openhands' } }, { allowed: null });

    expect(r).toMatchObject({ engine: { id: 'claude-cli', model: 'x' }, policy: 'static' });
  });

  it('then the seat\'s harness.engine', () => {
    const r = routeEngine({ ...base, seatEngine: { id: 'openhands' } }, { allowed: null });

    expect(r.engine).toEqual({ id: 'openhands' });
    expect(r.reason).toContain('task-engineer');
  });

  it('else the default, said as null so the contract stays as it was', () => {
    const r = routeEngine(base, { allowed: null });

    expect(r.engine).toBeNull();
    expect(engineIdOf(r.engine)).toBe('claude-cli');
  });
});

describe('the chain', () => {
  it('asks a dynamic policy first, and falls through when it passes', () => {
    const cheapForSmall: EngineRoutePolicy = { name: 'complexity', route: f => (f.complexity === 'small' ? { engine: { id: 'openhands' }, policy: 'complexity', reason: 'small change' } : null) };

    expect(routeEngine(base, { policies: [cheapForSmall, staticPolicy], allowed: null })).toMatchObject({ engine: { id: 'openhands' }, policy: 'complexity' });
    expect(routeEngine({ ...base, complexity: 'large' }, { policies: [cheapForSmall, staticPolicy], allowed: null }).policy).toBe('static');
  });

  it('keeps a choice inside the installation\'s fence', () => {
    const r = routeEngine(base, { allowed: ['openhands'] });

    expect(r.engine).toEqual({ id: 'openhands' });
    expect(r.reason).toContain('allows only openhands');
  });
});

describe('the fence and the size', () => {
  it('reads the fence from a comma list, ignoring what no runner knows', () => {
    expect(allowedEngines('openhands, devin')).toEqual(['openhands']);
    expect(allowedEngines('')).toBeNull();
    expect(allowedEngines(undefined)).toBeNull();
  });

  it('sizes a change by files and lines', () => {
    expect(complexityOf(2, 40)).toBe('small');
    expect(complexityOf(5)).toBe('medium');
    expect(complexityOf(2, 900)).toBe('large');
    expect(complexityOf(12)).toBe('large');
  });
});
