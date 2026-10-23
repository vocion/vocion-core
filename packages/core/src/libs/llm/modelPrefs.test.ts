import { describe, expect, it } from 'vitest';
import { isDefaultModelPrefs, modelForStrength, readModelPrefs, shortModelName, thinkingBudgetFor } from './modelPrefs';

describe('model preferences', () => {
  it('balanced leaves the agent’s own model alone; fast and deep pick the vendor’s small and large', () => {
    expect(modelForStrength('anthropic', 'balanced')).toBeUndefined();
    expect(modelForStrength('anthropic', 'fast')).toBe('claude-haiku-4-5-20251001');
    expect(modelForStrength('anthropic', 'deep')).toBe('claude-opus-5-5');
    expect(modelForStrength('bedrock', 'fast')).toMatch(/^us\.anthropic\.claude-haiku/);
    expect(modelForStrength('scripted', 'deep')).toBeUndefined();
  });

  it('effort maps to a budget above Anthropic’s floor, off to none', () => {
    expect(thinkingBudgetFor('off')).toBeNull();
    expect(thinkingBudgetFor('low')).toBeGreaterThanOrEqual(1024);
    expect(thinkingBudgetFor('high')!).toBeGreaterThan(thinkingBudgetFor('medium')!);
  });

  it('reads prefs off a request or a row and defaults nonsense', () => {
    expect(readModelPrefs({ model_strength: 'deep', thinking_effort: 'high' })).toEqual({ strength: 'deep', effort: 'high', level: 'auto' });
    expect(readModelPrefs({ modelStrength: 'fast', thinkingEffort: null })).toEqual({ strength: 'fast', effort: 'off', level: 'auto' });
    expect(readModelPrefs({ strength: 'huge' })).toEqual({ strength: 'balanced', effort: 'off', level: 'auto' });
    expect(readModelPrefs({ effort_level: 'deep' }).level).toBe('deep');
    expect(readModelPrefs({ effort_level: 'enormous' }).level).toBe('auto');
    expect(isDefaultModelPrefs(readModelPrefs(null))).toBe(true);
  });

  it('names a model for a person', () => {
    expect(shortModelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(shortModelName('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('Haiku 4.5');
    expect(shortModelName('gpt-4o')).toBe('gpt-4o');
  });
});

describe('a model as a person reads it', () => {
  it('names the family and version, never the id', async () => {
    const { levelModelNames, modelName } = await import('./modelPrefs');

    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelName('us.anthropic.claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(modelName('claude-opus-5')).toBe('Opus 5');
    expect(modelName('gpt-4o')).toBe('GPT-4o');
    expect(levelModelNames('anthropic')).toEqual({ quick: 'Haiku 4.5', standard: null, deep: 'Opus 5.5' });
  });
});
