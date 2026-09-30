import { describe, expect, it } from 'vitest';
import { resolveLiveUrl } from './liveUrl';

const bases = ['https://app.northwind.example', 'https://northwind.example'];

describe('the live URL comes from the product, the path from the request (2026-09-30, #246)', () => {
  it('puts a guessed host\'s path on the product\'s own environment', () => {
    expect(resolveLiveUrl('https://send.example/account', bases)).toBe('https://app.northwind.example/account');
    expect(resolveLiveUrl('https://app.old-name.example/', bases)).toBe('https://app.northwind.example/');
  });

  it('keeps a URL on one of the product\'s hosts, and takes a bare path', () => {
    expect(resolveLiveUrl('https://northwind.example/pricing', bases)).toBe('https://northwind.example/pricing');
    expect(resolveLiveUrl('/library?q=kes', bases)).toBe('https://app.northwind.example/library?q=kes');
  });

  it('cannot judge without an environment, and has nothing to show without a path', () => {
    expect(resolveLiveUrl('https://send.example/account', [])).toBe('https://send.example/account');
    expect(resolveLiveUrl(null, bases)).toBeNull();
  });
});
