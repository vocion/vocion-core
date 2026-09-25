import { describe, expect, it } from 'vitest';
import { liveOf } from './featureReport';

const NOW = new Date('2026-09-25T03:10:00Z');
const base = { id: 7, agentSlug: 'send-engineer', kind: 'worker', attempt: 1, cents: 12, model: null, summary: null, error: null, createdAt: new Date('2026-09-25T03:00:00Z'), claimedAt: new Date('2026-09-25T03:02:00Z'), completedAt: null, input: {}, result: null };

describe('watch the build', () => {
  it('a running run shows its step, elapsed, quiet time and the last eight lines', () => {
    const live = liveOf({ ...base, status: 'running', heartbeatAt: new Date('2026-09-25T03:07:00Z'), progress: { step: 'running typecheck', log: Array.from({ length: 20 }, (_, i) => `l${i}`) } }, NOW);

    expect(live).toEqual({ step: 'running typecheck', lastLine: 'l19', log: ['l12', 'l13', 'l14', 'l15', 'l16', 'l17', 'l18', 'l19'], sinceSec: 480, quietSec: 180 });
  });

  it('is nothing once the run is over, and says nothing it does not know', () => {
    expect(liveOf({ ...base, status: 'completed', progress: { step: 'done' } }, NOW)).toBeNull();
    expect(liveOf({ ...base, status: 'running', progress: {} }, NOW)).toEqual({ step: null, lastLine: null, log: [], sinceSec: 480, quietSec: null });
  });
});
