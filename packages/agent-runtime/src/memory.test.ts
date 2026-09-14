/**
 * Long-term memory namespacing.
 *
 * `retrieveLongTerm` trusts whatever `actorId` it is handed as the sole
 * namespace key (`/facts/<actorId>`, `/preferences/<actorId>`) — this module
 * has no notion of org on its own. The org-scoping fix lives in the CALLER
 * (runtime.ts folds orgId into actorId before it ever reaches here), so what
 * this file pins is the contract this module promises that caller: two
 * different actorId strings must never resolve to the same namespace, and a
 * failure to run either strategy's query must never take down the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();

/** Stand-ins for the SDK's command classes: real usage is `new Command({...})`, so these must be constructible. */
class FakeBedrockAgentCoreClient {
  send = send;
}
class FakeRetrieveMemoryRecordsCommand {
  input: unknown;
  constructor(input: unknown) {
    this.input = input;
  }
}

vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: FakeBedrockAgentCoreClient,
  RetrieveMemoryRecordsCommand: FakeRetrieveMemoryRecordsCommand,
}));

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.VOCION_AGENTCORE_MEMORY_ID = 'mem-123';
  send.mockReset();
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.resetModules();
});

describe('retrieveLongTerm namespacing', () => {
  it('queries namespaces scoped to the actor id it is given, not a bare user id', async () => {
    send.mockResolvedValue({ memoryRecordSummaries: [] });
    const { retrieveLongTerm } = await import('./memory.js');

    await retrieveLongTerm('org_a-user_1', 'what does the customer prefer?');

    const namespacesQueried = send.mock.calls.map(([command]) => (command as { input: { namespace: string } }).input.namespace);

    expect(namespacesQueried).toEqual(['/facts/org_a-user_1', '/preferences/org_a-user_1']);
  });

  it('gives two orgs sharing a user id disjoint namespaces, so their long-term memories cannot collide', async () => {
    send.mockResolvedValue({ memoryRecordSummaries: [{ content: { text: 'fact' } }] });
    const { retrieveLongTerm } = await import('./memory.js');

    await retrieveLongTerm('org_a-user_1', 'query');
    const namespacesForOrgA = send.mock.calls.map(([command]) => (command as { input: { namespace: string } }).input.namespace);

    send.mockClear();
    await retrieveLongTerm('org_b-user_1', 'query');
    const namespacesForOrgB = send.mock.calls.map(([command]) => (command as { input: { namespace: string } }).input.namespace);

    expect(namespacesForOrgA).not.toEqual(namespacesForOrgB);
  });

  it('returns records from whichever namespace succeeds when the other strategy query rejects', async () => {
    send
      .mockRejectedValueOnce(new Error('facts strategy not configured'))
      .mockResolvedValueOnce({ memoryRecordSummaries: [{ content: { text: 'likes concise replies' } }] });
    const { retrieveLongTerm } = await import('./memory.js');

    const records = await retrieveLongTerm('org_a-user_1', 'query');

    expect(records).toEqual(['likes concise replies']);
  });

  it('returns an empty array, not a thrown error, when every namespace query fails', async () => {
    send.mockRejectedValue(new Error('network unreachable'));
    const { retrieveLongTerm } = await import('./memory.js');

    const records = await retrieveLongTerm('org_a-user_1', 'query');

    expect(records).toEqual([]);
  });
});
