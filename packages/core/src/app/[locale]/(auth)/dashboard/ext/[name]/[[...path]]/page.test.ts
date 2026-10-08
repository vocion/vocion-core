/**
 * `/dashboard/ext/<name>/...`: the extension page registered under `<name>`,
 * given the rest of the path and the query; 404 for any other name.
 */
import { describe, expect, it, vi } from 'vitest';

const Sample = vi.hoisted(() => (props: { path: string[]; searchParams: unknown }) => ({ rendered: 'sample', ...props }));

vi.mock('@vocion/enterprise/index', () => ({ extensions: [{ name: 'sample-ext', pages: { sample: Sample } }] }));
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { default: ExtensionPage } = await import('./page');

function open(name: string, path?: string[], query: Record<string, string> = {}) {
  return ExtensionPage({ params: Promise.resolve({ locale: 'en', name, path }), searchParams: Promise.resolve(query) });
}

describe('an extension page', () => {
  it('renders the page registered under the name, with the path under it and the query', async () => {
    expect(await open('sample', ['accounts', 'acct-northwind'], { tab: 'spend' })).toEqual({ rendered: 'sample', path: ['accounts', 'acct-northwind'], searchParams: { tab: 'spend' } });
  });

  it('gives an empty path at the page\'s root', async () => {
    expect(await open('sample')).toMatchObject({ path: [] });
  });

  it('is a 404 for a name no extension serves', async () => {
    await expect(open('missing')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(open('constructor')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
