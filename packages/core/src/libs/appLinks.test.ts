import { describe, expect, it } from 'vitest';
import { resolveActiveApp } from '@/features/navigation/apps';
import { appFromReferer, appPathname, withAppContext } from './appLinks';

const apps = [
  { id: 'core', core: true, owns: [], entry: '/dashboard/chat' },
  { id: 'seo', core: false, owns: ['/dashboard/apps/seo', '/dashboard/p/seo-pages'] },
  { id: 'finance', core: false, owns: ['/dashboard/apps/finance'] },
];

describe('app context travels with shared work', () => {
  it('keeps filters and anchors while adding context', () => {
    expect(withAppContext('/w/northwind/dashboard/projects/4?status=open#work', 'seo', 'northwind')).toBe('/w/northwind/dashboard/projects/4?status=open&app=seo#work');
  });

  it('does not alter external links, explicit app choices or other workspaces', () => {
    for (const href of ['https://example.com', '//example.com', '/w/elsewhere/dashboard/objects/4', '/dashboard/apps/finance/home', '/dashboard/chat?app=finance']) {
      expect(withAppContext(href, 'seo', 'northwind')).toBe(href);
    }
  });

  it('restores a deep-linked app over remembered state, including shared chat', () => {
    expect(resolveActiveApp({ apps, pathname: '/dashboard/artifacts/8', explicit: 'seo', remembered: 'finance' })).toBe('seo');
    expect(resolveActiveApp({ apps, pathname: '/dashboard/chat', explicit: 'seo' })).toBe('seo');
    expect(resolveActiveApp({ apps, pathname: '/dashboard/apps/finance/home', explicit: 'seo' })).toBe('finance');
    expect(resolveActiveApp({ apps, pathname: '/dashboard/objects/8', explicit: 'missing' })).toBe('core');
  });

  it('routes a tab by its own workspace URL rather than a different tab cookie', () => {
    expect(appFromReferer('https://app.example/w/northwind/dashboard/chat?app=seo', 'northwind')).toBe('seo');
    expect(appFromReferer('https://app.example/w/elsewhere/dashboard/chat?app=seo', 'northwind')).toBeNull();
    expect(appFromReferer('broken', 'northwind')).toBeNull();
  });
});

it('normalizes locale routes the same before and after workspace rewrites', () => {
  expect(appPathname('/fr/dashboard/p/seo-pages')).toBe('/dashboard/p/seo-pages');
  expect(appPathname('/fr/w/northwind/dashboard/p/seo-pages')).toBe('/dashboard/p/seo-pages');
});
