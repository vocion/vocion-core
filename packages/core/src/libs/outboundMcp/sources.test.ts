import { describe, expect, it } from 'vitest';
import { mcpConfigSchema } from './sources';

describe('MCP source config', () => {
  it('defaults to one workspace token', () => {
    expect(mcpConfigSchema.parse({ readTools: ['a'] })).toMatchObject({ auth: 'token', writeTools: [] });
  });

  it('takes a per-person source with an HTTPS endpoint and reads only', () => {
    expect(mcpConfigSchema.parse({ auth: 'person', url: 'https://knowledge.example/mcp', readTools: ['a'] })).toMatchObject({ auth: 'person', url: 'https://knowledge.example/mcp' });
  });

  it('refuses a per-person source with no endpoint, a plain-HTTP one, or writes', () => {
    expect(mcpConfigSchema.safeParse({ auth: 'person', readTools: ['a'] }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ auth: 'person', url: 'http://knowledge.example/mcp' }).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ auth: 'person', url: 'https://knowledge.example/mcp', writeTools: ['b'] }).success).toBe(false);
  });
});
