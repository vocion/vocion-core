import { describe, expect, it } from 'vitest';
import { AgentManifestSchema } from './schemas';

const base = { slug: 'task-engineer', name: 'Engineer', systemPrompt: 'Build the contract.' };

describe('harness.effort survives the parse (2026-09-30: "Engineer should run on opus 5.5 high")', () => {
  it('keeps the effort a seat names, so the worker gets it on model_policy', () => {
    const parsed = AgentManifestSchema.parse({ ...base, harness: { runsOn: 'external-worker', model: 'claude-opus-5-5', effort: 'high' } });

    expect(parsed.harness).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
  });

  it('refuses an effort the models do not take', () => {
    expect(AgentManifestSchema.safeParse({ ...base, harness: { effort: 'extreme' } }).success).toBe(false);
  });
});
