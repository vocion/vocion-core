/**
 * The builtin provider's `fetchHtml`, which SERP research reads ranking pages
 * through: public addresses only, on every redirect hop, and only HTML.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtinBrowseProvider } from './builtin';

// `.example` never resolves (RFC 2606); the guard's DNS step gets a public
// answer, except for the name planted to point inside.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async (host: string) => (host === 'inside.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('builtin fetchHtml', () => {
  it('returns a public page\'s HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><h1>Boots</h1></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));

    const page = await builtinBrowseProvider().fetchHtml('https://northwind-outfitters.example/boots');

    expect(page?.html).toContain('<h1>Boots</h1>');
  });

  it('refuses a redirect into a private address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://inside.example/admin' } })));

    await expect(builtinBrowseProvider().fetchHtml('https://northwind-outfitters.example/boots')).rejects.toThrow(/private address/);
  });

  it('returns null for something that is not HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } })));

    expect(await builtinBrowseProvider().fetchHtml('https://northwind-outfitters.example/boots.pdf')).toBeNull();
  });
});
