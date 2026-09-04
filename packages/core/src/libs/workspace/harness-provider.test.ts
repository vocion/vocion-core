/**
 * The harness block's `provider` stays absent unless an author writes one.
 *
 * This looks like a triviality and is not. The parsed harness object is stored
 * verbatim as the agent's `harnessConfig`, so a schema default lands in the
 * database as though the author had typed it. While `provider` defaulted to
 * `local`, every agent that came through workspace YAML carried an explicit
 * `local` — which would make the Bedrock-implies-AgentCore default in
 * `AgentService` unreachable for exactly the agents it was written for.
 */
import { describe, expect, it } from 'vitest';
import { AgentManifestSchema } from './schemas';

function parseHarness(harness: Record<string, unknown> | undefined): Record<string, unknown> {
  const parsed = AgentManifestSchema.parse({
    slug: 'sales-assistant',
    name: 'Sales Assistant',
    systemPrompt: 'Be helpful.',
    ...(harness ? { harness } : {}),
  });
  return (parsed.harness ?? {}) as Record<string, unknown>;
}

describe('agent harness provider', () => {
  it('leaves provider unset when the author names none', () => {
    expect(parseHarness({ modelProvider: 'bedrock' }).provider).toBeUndefined();
  });

  it('leaves provider unset when there is no harness block at all', () => {
    expect(parseHarness(undefined).provider).toBeUndefined();
  });

  it('keeps an explicit local, so opting out of the Bedrock default is expressible', () => {
    expect(parseHarness({ provider: 'local', modelProvider: 'bedrock' }).provider).toBe('local');
  });

  it('keeps an explicit runtime', () => {
    expect(parseHarness({ provider: 'runtime' }).provider).toBe('runtime');
  });

  it('keeps an explicit agentcore', () => {
    expect(parseHarness({ provider: 'agentcore' }).provider).toBe('agentcore');
  });

  it('rejects a provider it does not recognise', () => {
    expect(() => parseHarness({ provider: 'lambda' })).toThrow();
  });
});
