import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { recordFact } = await import('./configureData');

describe('recordFact', () => {
  it('says a field the way a person reads it: a link without its scheme, a list as its count, nothing when empty', () => {
    expect(recordFact('url', 'https://github.com/acme-example/harbor-web/')).toBe('github.com/acme-example/harbor-web');
    expect(recordFact('checks', [{ name: 'test' }, { name: 'lint' }])).toBe('2 checks');
    expect(recordFact('checks', [])).toBe('no checks');
    expect(recordFact('checks', [{ name: 'test' }])).toBe('1 check');
    expect(recordFact('product', 'harbor')).toBe('harbor');
    expect(recordFact('product', '')).toBeNull();
    expect(recordFact('product', undefined)).toBeNull();
  });
});
