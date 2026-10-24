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

describe('harness.routeModels survives the parse (ADR 0006)', () => {
  it('keeps the candidates a seat offers dynamic routing', () => {
    const routeModels = [
      { engine: 'claude-cli', model: 'claude-opus-5-5', about: 'Strong at hard debugging.', cost: 'high' },
      { engine: 'openhands', model: 'bedrock/us.anthropic.claude-sonnet-5-5', cost: 'low' },
    ];

    expect(AgentManifestSchema.parse({ ...base, harness: { routeModels } }).harness).toMatchObject({ routeModels });
  });

  it('refuses an unknown engine or cost, and more than twelve candidates', () => {
    expect(AgentManifestSchema.safeParse({ ...base, harness: { routeModels: [{ engine: 'devin' }] } }).success).toBe(false);
    expect(AgentManifestSchema.safeParse({ ...base, harness: { routeModels: [{ engine: 'openhands', cost: 'pricey' }] } }).success).toBe(false);
    expect(AgentManifestSchema.safeParse({ ...base, harness: { routeModels: Array.from({ length: 13 }, () => ({ engine: 'openhands' })) } }).success).toBe(false);
  });
});
