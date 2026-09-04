/**
 * How the harness block's target survives parsing.
 *
 * Two things are being pinned. First, the field is `runsOn` now, `provider`
 * is its old name, and both are read — a parent project's workspace file may
 * go a long time without being updated, and an apply that rejected it would
 * break a client deploy this repo cannot see.
 *
 * Second, and less obvious: when the author names nothing, the key must be
 * ABSENT from the parsed block, not present-and-defaulted. The block is stored
 * verbatim as the agent's `harnessConfig`, so a schema default would land in
 * the database as though it had been typed, and `defaultHarnessTargetFor`
 * would never fire for the Bedrock agents it was written for.
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

describe('harness runsOn', () => {
  it('reads the canonical names', () => {
    expect(parseHarness({ runsOn: 'in-process' }).runsOn).toBe('in-process');
    expect(parseHarness({ runsOn: 'agentcore-container' }).runsOn).toBe('agentcore-container');
    expect(parseHarness({ runsOn: 'aws-managed-harness' }).runsOn).toBe('aws-managed-harness');
  });

  it('normalises a pre-rename value written under the new key', () => {
    expect(parseHarness({ runsOn: 'runtime' }).runsOn).toBe('agentcore-container');
  });

  it('reads the old key and normalises it — an un-updated parent project still applies', () => {
    expect(parseHarness({ provider: 'agentcore' }).runsOn).toBe('aws-managed-harness');
    expect(parseHarness({ provider: 'local' }).runsOn).toBe('in-process');
  });

  it('does not re-emit the old key, so nothing downstream sees two spellings', () => {
    const harness = parseHarness({ provider: 'runtime' });

    expect(harness.runsOn).toBe('agentcore-container');
    expect('provider' in harness).toBe(false);
  });

  it('prefers the new key when an author somehow wrote both', () => {
    expect(parseHarness({ runsOn: 'in-process', provider: 'agentcore' }).runsOn).toBe('in-process');
  });

  it('leaves the key absent when the author named nothing', () => {
    const harness = parseHarness({ modelProvider: 'bedrock' });

    expect('runsOn' in harness).toBe(false);
    expect('provider' in harness).toBe(false);
  });

  it('leaves the key absent when there is no harness block at all', () => {
    expect('runsOn' in parseHarness(undefined)).toBe(false);
  });

  it('rejects a target it does not recognise', () => {
    expect(() => parseHarness({ runsOn: 'lambda' })).toThrow();
  });

  it('rejects a model vendor in the target field', () => {
    expect(() => parseHarness({ runsOn: 'bedrock' })).toThrow();
  });
});
