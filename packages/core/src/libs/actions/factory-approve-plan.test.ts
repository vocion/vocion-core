import { describe, expect, it } from 'vitest';
import { factoryApprovePlanAction, planConfidence } from './factory-approve-plan';

const complete = {
  approach: 'Read the status in the core package and render it on the page.',
  components: ['apps/web — renders it', 'packages/core — reads it'],
  alternatives: ['Compute it in the page: duplicates the rule.'],
  verification: 'The page shows it; a test covers the read.',
  dataImpact: 'None.',
  ruleTriggers: ['the allowed paths span 2 packages (apps/web, packages/core), so an architectural boundary is being crossed'],
};

describe('how sure the factory is of a plan (backlog 038)', () => {
  it('approves a complete plan for work a revert can undo', () => {
    expect(planConfidence(complete)).toEqual({ confidence: 0.9, gaps: [] });
  });

  it('asks about a plan with a gap, or for work a revert cannot undo', () => {
    expect(planConfidence({ ...complete, alternatives: [] })).toMatchObject({ confidence: 0.6, gaps: ['nothing considered and rejected'] });
    expect(planConfidence({ ...complete, ruleTriggers: ['the risk class is schema, which is irreversible'] })).toMatchObject({ confidence: 0.6, gaps: ['the rule named a risk class a revert cannot undo'] });
  });

  it('is its own trust key, one card per plan', () => {
    expect(factoryApprovePlanAction.id).toBe('factory.approve_plan');
    expect(factoryApprovePlanAction.dedupKeyFor?.({ planId: 9, reason: 'x' })).toBe('factory.approve_plan:9');
    expect(typeof factoryApprovePlanAction.undo).toBe('function');
  });
});
