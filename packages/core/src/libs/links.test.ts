import { afterEach, describe, expect, it } from 'vitest';
import { appBaseUrl, workspaceRedirectPath, workspaceUrl } from './links';

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
  }
});

describe('workspaceUrl', () => {
  it('puts the workspace in the path, Vercel-style', () => {
    expect(workspaceUrl('vocion-workforce', '/dashboard/inbox')).toBe('/w/vocion-workforce/dashboard/inbox');
    expect(workspaceUrl('vocion-workforce', 'dashboard/inbox')).toBe('/w/vocion-workforce/dashboard/inbox');
    expect(workspaceUrl('vocion-workforce', '')).toBe('/w/vocion-workforce/dashboard');
  });

  it('keeps the query string and fragment', () => {
    expect(workspaceUrl('vocion-workforce', '/dashboard/activity?kind=tool&tool=web#run-3')).toBe('/w/vocion-workforce/dashboard/activity?kind=tool&tool=web#run-3');
  });

  it('is absolute on request, with NEXT_PUBLIC_APP_URL trimmed of its trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://agents.example.com/';

    expect(appBaseUrl()).toBe('https://agents.example.com');
    expect(workspaceUrl('vocion-workforce', '/dashboard/inbox', { absolute: true })).toBe('https://agents.example.com/w/vocion-workforce/dashboard/inbox');
  });

  it('degrades to a relative link when no public URL is configured', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(workspaceUrl('vocion-workforce', '/dashboard/inbox', { absolute: true })).toBe('/w/vocion-workforce/dashboard/inbox');
  });

  it('lower-cases and encodes the slug, and never emits a protocol-relative path', () => {
    expect(workspaceUrl(' Vocion-Workforce ', '//dashboard//inbox')).toBe('/w/vocion-workforce/dashboard/inbox');
    expect(workspaceUrl('a b/c', '/dashboard')).toBe('/w/a%20b%2Fc/dashboard');
  });
});

describe('workspaceRedirectPath', () => {
  it('lands on the dashboard home with no path', () => {
    expect(workspaceRedirectPath({})).toBe('/dashboard');
    expect(workspaceRedirectPath({ segments: [], search: '' })).toBe('/dashboard');
  });

  it('passes a dashboard path through and preserves the query', () => {
    expect(workspaceRedirectPath({ segments: ['dashboard', 'inbox'], search: '?status=open&x=1' })).toBe('/dashboard/inbox?status=open&x=1');
    expect(workspaceRedirectPath({ segments: ['dashboard', 'inbox', '42'], search: 'status=open' })).toBe('/dashboard/inbox/42?status=open');
  });

  it('treats a bare page name as a dashboard page and a registered surface segment as its own root', () => {
    expect(workspaceRedirectPath({ segments: ['inbox'] })).toBe('/dashboard/inbox');
    expect(workspaceRedirectPath({ segments: ['team-report', 'ceo'] })).toBe('/dashboard/team-report/ceo');
    expect(workspaceRedirectPath({ segments: ['gtm', 'discovery'] })).toBe('/gtm/discovery');
  });

  it('prefixes a non-default locale and leaves the default bare (as-needed)', () => {
    expect(workspaceRedirectPath({ segments: ['dashboard', 'inbox'], locale: 'fr' })).toBe('/fr/dashboard/inbox');
    expect(workspaceRedirectPath({ segments: ['dashboard', 'inbox'], locale: 'en' })).toBe('/dashboard/inbox');
    expect(workspaceRedirectPath({ segments: ['dashboard'], locale: 'not-a-locale' })).toBe('/dashboard');
  });

  it('cannot be steered off-origin by a crafted segment', () => {
    expect(workspaceRedirectPath({ segments: ['', 'evil.com'] })).toBe('/dashboard/evil.com');
    expect(workspaceRedirectPath({ segments: ['dashboard', '..', 'x'] })).toBe('/dashboard/../x'.replace('..', '..'));
    expect(workspaceRedirectPath({ segments: ['dashboard', 'a/b'] })).toBe('/dashboard/a%2Fb');
  });
});
