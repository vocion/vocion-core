import { describe, expect, it } from 'vitest';
import { combinedPage, combinedPageTitle } from './combinedPages';

describe('combinedPage — tab deep-links', () => {
  it('resolves a tab url to its page with that tab active', () => {
    const page = combinedPage('/dashboard/agents')!;

    expect(page.owner.url).toBe('/dashboard/teams');
    expect(page.active.url).toBe('/dashboard/agents');
    expect(page.tabs.map(t => t.url)).toEqual(['/dashboard/teams', '/dashboard/agents', '/dashboard/hire']);
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
    // Hire an agent is a Teams & agents tab (Chris, 2026-10-08); Apps owns no strip.
    expect(combinedPageTitle('/dashboard/hire')).toBe('Hire an agent · Teams & agents');
    expect(combinedPageTitle('/dashboard/apps')).toBeUndefined();
  });
});
