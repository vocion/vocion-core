import { describe, expect, it } from 'vitest';
import { combinedPage, combinedPageTitle } from './combinedPages';

describe('combinedPage — tab deep-links', () => {
  it('resolves a tab url to its page with that tab active', () => {
    const page = combinedPage('/dashboard/agents')!;

    expect(page.owner.url).toBe('/dashboard/teams');
    expect(page.active.url).toBe('/dashboard/agents');
    expect(page.tabs.map(t => t.url)).toEqual(['/dashboard/teams', '/dashboard/agents']);
  });

  it('resolves the owner url to the same page with the first tab active', () => {
    const page = combinedPage('/dashboard/skills')!;

    expect(page.active.url).toBe('/dashboard/skills');
    expect(page.tabs.map(t => t.url)).toEqual(['/dashboard/skills', '/dashboard/tools', '/dashboard/models']);
  });

  it('is undefined for a page that owns no tabs and for unknown urls', () => {
    expect(combinedPage('/dashboard/missions')).toBeUndefined();
    expect(combinedPage('/dashboard/nope')).toBeUndefined();
  });

  it('titles the document after the tab and its page', () => {
    expect(combinedPageTitle('/dashboard/teams')).toBe('Teams & agents');
    expect(combinedPageTitle('/dashboard/agents')).toBe('Agents · Teams & agents');
    expect(combinedPageTitle('/dashboard/models')).toBe('Vision models · Skills & tools');
    expect(combinedPageTitle('/dashboard/evals')).toBeUndefined();
    // The Marketplace owns its OWN strip now — Plugins on its own URL, Agents
    // for hire one segment down (Chris, 2026-09-18).
    expect(combinedPageTitle('/dashboard/marketplace')).toBe('Marketplace');
    expect(combinedPageTitle('/dashboard/marketplace/agents')).toBe('Agents for hire · Marketplace');
  });
});
