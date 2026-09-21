import { afterEach, describe, expect, it } from 'vitest';
import { appBaseUrl, isReservedSegment, parseWorkspacePath, projectSlugProblem, stripWorkspacePrefix, workspaceRedirectPath, workspaceUrl } from './links';

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

describe('parseWorkspacePath', () => {
  it('reads the workspace and the page out of a canonical URL', () => {
    expect(parseWorkspacePath('/w/northwind')).toEqual({ locale: '', slug: 'northwind', appPath: '/dashboard' });
    expect(parseWorkspacePath('/w/northwind/dashboard/inbox')).toEqual({ locale: '', slug: 'northwind', appPath: '/dashboard/inbox' });
    expect(parseWorkspacePath('/w/northwind/inbox')?.appPath).toBe('/dashboard/inbox');
    expect(parseWorkspacePath('/w/northwind/gtm/discovery')?.appPath).toBe('/gtm/discovery');
  });

  it('keeps the locale prefix out of the app path', () => {
    expect(parseWorkspacePath('/fr/w/northwind/inbox')).toEqual({ locale: 'fr', slug: 'northwind', appPath: '/dashboard/inbox' });
  });

  it('matches the slug case-insensitively and decodes it', () => {
    expect(parseWorkspacePath('/w/Northwind/dashboard')?.slug).toBe('northwind');
    expect(parseWorkspacePath('/w/north%20wind/dashboard')?.slug).toBe('north wind');
  });

  it('is null for anything that is not canonical', () => {
    expect(parseWorkspacePath('/dashboard/inbox')).toBeNull();
    expect(parseWorkspacePath('/w')).toBeNull();
    expect(parseWorkspacePath('/w/')).toBeNull();
    expect(parseWorkspacePath('/')).toBeNull();
    expect(parseWorkspacePath('/fr/dashboard')).toBeNull();
  });

  it('refuses a reserved segment as a slug, so a route can never be shadowed', () => {
    expect(parseWorkspacePath('/w/api/v1/records')).toBeNull();
    expect(parseWorkspacePath('/w/dashboard/inbox')).toBeNull();
    expect(parseWorkspacePath('/w/w/dashboard')).toBeNull();
    expect(parseWorkspacePath('/w/en/dashboard')).toBeNull();
  });

  it('survives a malformed escape rather than throwing at the reader', () => {
    expect(parseWorkspacePath('/w/%E0%A4%A/dashboard')?.slug).toBe('%e0%a4%a');
  });
});

describe('stripWorkspacePrefix', () => {
  it('leaves the app path — what active-nav matching and the switcher want', () => {
    expect(stripWorkspacePrefix('/w/northwind/dashboard/inbox')).toBe('/dashboard/inbox');
    expect(stripWorkspacePrefix('/w/northwind/dashboard/inbox?status=open#x')).toBe('/dashboard/inbox?status=open#x');
    expect(stripWorkspacePrefix('/w/northwind')).toBe('/dashboard');
  });

  it('passes a path that is not canonical through untouched', () => {
    expect(stripWorkspacePrefix('/dashboard/inbox')).toBe('/dashboard/inbox');
    expect(stripWorkspacePrefix('/sign-in')).toBe('/sign-in');
  });
});

describe('workspaceUrl, given a path that is already canonical', () => {
  it('re-points it rather than nesting a second /w', () => {
    expect(workspaceUrl('kestrel', '/w/northwind/dashboard/inbox')).toBe('/w/kestrel/dashboard/inbox');
    expect(workspaceUrl('northwind', '/w/northwind/dashboard/inbox')).toBe('/w/northwind/dashboard/inbox');
  });
});

describe('projectSlugProblem', () => {
  it('accepts the slugs we ship', () => {
    expect(projectSlugProblem('metacto-revenue')).toBeNull();
    expect(projectSlugProblem('northwind')).toBeNull();
    expect(projectSlugProblem('r2')).toBeNull();
  });

  it('names the rule a slug broke, for whoever typed it', () => {
    expect(projectSlugProblem('Revenue')).toBe('must be lowercase');
    expect(projectSlugProblem('a')).toContain('2–40 characters');
    expect(projectSlugProblem('-revenue')).toContain('2–40 characters');
    expect(projectSlugProblem('rev enue')).toContain('2–40 characters');
    expect(projectSlugProblem('dashboard')).toContain('is reserved by the app');
    expect(projectSlugProblem('gtm')).toContain('is reserved by the app');
  });
});

describe('isReservedSegment', () => {
  it('covers routes, surfaces and locales from their own registries', () => {
    expect(isReservedSegment('api')).toBe(true);
    expect(isReservedSegment('DASHBOARD')).toBe(true);
    expect(isReservedSegment('gtm')).toBe(true);
    expect(isReservedSegment('fr')).toBe(true);
    expect(isReservedSegment('northwind')).toBe(false);
  });
});
