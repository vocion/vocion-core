import { describe, expect, it } from 'vitest';
import { clampAutonomyLevel, taskNeedsApproval } from './autonomy';

describe('mission autonomy', () => {
  it('gates external actions at low autonomy, allows them at level 3+', () => {
    expect(taskNeedsApproval({ type: 'action' }, 1)).toBe(true);
    expect(taskNeedsApproval({ type: 'action' }, 2)).toBe(true);
    expect(taskNeedsApproval({ type: 'action' }, 3)).toBe(false);
  });

  it('never auto-gates internal work (analysis/creative/synthesis)', () => {
    expect(taskNeedsApproval({ type: 'analysis' }, 1)).toBe(false);
    expect(taskNeedsApproval({ type: 'synthesis' }, 1)).toBe(false);
    expect(taskNeedsApproval({ type: 'artifact' }, 2)).toBe(false);
  });

  it('honors an explicit approvalRequired flag regardless of level', () => {
    expect(taskNeedsApproval({ type: 'analysis', approvalRequired: true }, 5)).toBe(true);
  });

  it('clamps autonomy levels to 1..5', () => {
    expect(clampAutonomyLevel(undefined)).toBe(1);
    expect(clampAutonomyLevel(0)).toBe(1);
    expect(clampAutonomyLevel(9)).toBe(5);
    expect(clampAutonomyLevel(3)).toBe(3);
  });
});
