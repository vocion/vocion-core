/**
 * What partitions the compiled-graph cache.
 *
 * The cache exists because building a graph is expensive and the result is
 * identical for every request with the same agent definition. That was safe
 * while the graph held nothing caller-specific. It now reaches a Bedrock
 * credential through a per-invocation ref, so the key has to keep two tenants
 * apart even when their agent definitions are byte-identical — which is a
 * realistic case, since demo and template agents are copied between orgs.
 */
import type { InvocationRequest } from './contract.js';
import { describe, expect, it } from 'vitest';
import { definitionHash } from './loop.js';

function request(overrides: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    version: 1,
    agent: { slug: 'sales-assistant', name: 'Sales Assistant', systemPrompt: 'Be helpful.' },
    message: 'hello',
    tools: { endpoint: 'https://core.example.com/api/internal/agent-tools', catalog: [], claim: 'claim-abc' },
    trace: { orgId: 'org_a', userId: 'user_1' },
    ...overrides,
  } as InvocationRequest;
}

describe('definitionHash', () => {
  it('reuses one graph for repeat requests from the same org', () => {
    expect(definitionHash(request())).toBe(definitionHash(request()));
  });

  it('separates two orgs holding byte-identical agent definitions', () => {
    const a = definitionHash(request({ trace: { orgId: 'org_a', userId: 'user_1' } }));
    const b = definitionHash(request({ trace: { orgId: 'org_b', userId: 'user_2' } }));

    expect(a).not.toBe(b);
  });

  it('ignores the user, so two people in one org share a graph', () => {
    const first = definitionHash(request({ trace: { orgId: 'org_a', userId: 'user_1' } }));
    const second = definitionHash(request({ trace: { orgId: 'org_a', userId: 'user_2' } }));

    expect(first).toBe(second);
  });

  it('rebuilds when an org starts sending an AWS session', () => {
    const withoutKey = definitionHash(request());
    const withKey = definitionHash(request({
      aws: { accessKeyId: 'ASIA', secretAccessKey: 'secret', sessionToken: 'token' },
    }));

    expect(withoutKey).not.toBe(withKey);
  });

  it('does not rebuild for each freshly minted session of the same org', () => {
    // Sessions are minted per invocation. Hashing their contents would miss
    // the cache on literally every request.
    const first = definitionHash(request({
      aws: { accessKeyId: 'ASIA1', secretAccessKey: 's1', sessionToken: 't1' },
    }));
    const second = definitionHash(request({
      aws: { accessKeyId: 'ASIA2', secretAccessKey: 's2', sessionToken: 't2' },
    }));

    expect(first).toBe(second);
  });

  it('rebuilds when the agent definition itself changes', () => {
    const before = definitionHash(request());
    const after = definitionHash(request({
      agent: { slug: 'sales-assistant', name: 'Sales Assistant', systemPrompt: 'Be terse.' },
    }));

    expect(before).not.toBe(after);
  });

  it('rebuilds when the tool endpoint moves', () => {
    const before = definitionHash(request());
    const after = definitionHash(request({
      tools: { endpoint: 'https://other.example.com/api/internal/agent-tools', catalog: [], claim: 'claim-abc' },
    }));

    expect(before).not.toBe(after);
  });

  it('ignores the claim, which rotates per request', () => {
    const before = definitionHash(request());
    const after = definitionHash(request({
      tools: { endpoint: 'https://core.example.com/api/internal/agent-tools', catalog: [], claim: 'claim-xyz' },
    }));

    expect(before).toBe(after);
  });
});
