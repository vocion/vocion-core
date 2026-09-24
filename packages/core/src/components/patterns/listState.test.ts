import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the pure list-state helpers', () => {
  it('live in a module a server component can call', () => {
    // A function exported from a client module is a client reference on the
    // server, and calling one throws. The bulk actions page parsed its URL
    // with parseListState on the server and crashed on every load while the
    // helper sat beside the hook in a client module.
    const src = readFileSync(resolve(__dirname, 'listState.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*['"]use client['"]/m);
  });

  it('are exported from the patterns index by way of that module', () => {
    const index = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
    const line = index.split('\n').find(l => /\bparseListState\b/.test(l)) ?? '';
    expect(line).toMatch(/from '\.\/listState'/);
  });
});
