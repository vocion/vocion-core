import { describe, expect, it } from 'vitest';
import { mcpCredentialsOf, validateMcpInput } from './client';

describe('outbound MCP contracts', () => {
  it('rejects insecure or credential-bearing URLs', () => {
    for (const baseUrl of ['http://example.com/mcp', 'https://user:pass@example.com/mcp', 'https://example.com/mcp?token=secret']) {
      expect(() => mcpCredentialsOf({ baseUrl, token: 'secret' })).toThrow();
    }
  });

  it('rejects arguments that do not satisfy the discovered schema', () => {
    const remote = { name: 'write', inputSchema: { type: 'object' as const, required: ['amount'], properties: { amount: { type: 'number', minimum: 1 } }, additionalProperties: false } };

    expect(() => validateMcpInput(remote, { amount: 0 })).toThrow();
    expect(() => validateMcpInput(remote, { amount: 2 })).not.toThrow();
  });
});
