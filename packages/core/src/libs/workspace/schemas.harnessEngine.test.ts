import { describe, expect, it } from 'vitest';
import { AgentManifestSchema } from './schemas';

const base = { slug: 'task-engineer', name: 'Engineer', systemPrompt: 'Build the contract.' };

describe('harness.engine survives the parse (engine plan, Phase 2)', () => {
  it('keeps the engine and the engine model a seat names, so the worker gets them on the contract', () => {
    const parsed = AgentManifestSchema.parse({ ...base, harness: { runsOn: 'external-worker', model: 'claude-opus-5-5', engine: 'openhands', engineModel: 'bedrock/us.anthropic.claude-opus-5-5' } });

    expect(parsed.harness).toMatchObject({ model: 'claude-opus-5-5', engine: 'openhands', engineModel: 'bedrock/us.anthropic.claude-opus-5-5' });
  });

  it('refuses an engine the runner does not know', () => {
    expect(AgentManifestSchema.safeParse({ ...base, harness: { engine: 'devin' } }).success).toBe(false);
  });

  it('says nothing when the seat names no engine', () => {
    expect(AgentManifestSchema.parse({ ...base, harness: { model: 'claude-opus-5-5' } }).harness).not.toHaveProperty('engine');
  });
});
