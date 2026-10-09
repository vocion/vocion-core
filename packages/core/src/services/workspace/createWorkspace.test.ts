import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { freeSlug, slugFromName } = await import('./createWorkspace');

describe('a new workspace\'s address', () => {
  it('comes from its name', () => {
    expect(slugFromName('Kestrel Ops')).toBe('kestrel-ops');
    expect(slugFromName('  Café Désert  ')).toBe('cafe-desert');
    expect(slugFromName('!')).toBe('workspace');
  });

  it('takes the next free one in the Org', () => {
    expect(freeSlug('kestrel-ops', new Set())).toBe('kestrel-ops');
    expect(freeSlug('kestrel-ops', new Set(['kestrel-ops', 'kestrel-ops-2']))).toBe('kestrel-ops-3');
  });
});
