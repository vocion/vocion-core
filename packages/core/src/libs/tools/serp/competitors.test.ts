import type { SerpResult } from './types';
import { describe, expect, it } from 'vitest';
import { competitorsFromSerps } from './competitors';
import { isDirectoryDomain } from './directories';

/**
 * Competitors read from Google rather than guessed (red team, 2026-10-27:
 * onboarding named the domains it believed ranked). A domain that ranks for
 * two or more of a client's core searches is a competitor; a directory,
 * marketplace or the client itself is not. Fictional domains throughout.
 */

const serp = (query: string, domains: string[]): Pick<SerpResult, 'query' | 'organic'> => ({
  query,
  organic: domains.map((domain, i) => ({ position: i + 1, url: `https://${domain}/${query.replace(/\s+/g, '-')}`, domain, title: domain, snippet: '' })),
});

describe('the shared directory list', () => {
  it('also leaves out marketplaces and listings outside the trades', () => {
    expect(isDirectoryDomain('www.etsy.com')).toBe(true);
    expect(isDirectoryDomain('clutch.co')).toBe(true);
    expect(isDirectoryDomain('kestrel-heating.example')).toBe(false);
  });
});

describe('competitorsFromSerps', () => {
  const serps = [
    serp('furnace repair springfield', ['yelp.com', 'kestrel-heating.example', 'northwind-home.example', 'contoso-air.example', 'angi.com']),
    serp('ac installation springfield', ['contoso-air.example', 'homeadvisor.com', 'kestrel-heating.example', 'bellwater-hvac.example']),
    serp('heat pump installer springfield', ['www.kestrel-heating.example', 'facebook.com', 'larkfield-plumbing.example']),
    serp('emergency hvac springfield', ['bellwater-hvac.example', 'kestrel-heating.example', 'blog.northwind-home.example']),
  ];

  it('counts domains ranking for two or more searches, leaving out directories and the client, each with its searches', () => {
    const found = competitorsFromSerps(serps, { ownDomains: ['northwind-home.example'] });

    // Two searches each at an average of 2.5: the tie reads alphabetically.
    expect(found.map(c => c.domain)).toEqual(['kestrel-heating.example', 'bellwater-hvac.example', 'contoso-air.example']);
    expect(found[0]!.ranked).toEqual([
      { query: 'heat pump installer springfield', position: 1, url: 'https://www.kestrel-heating.example/heat-pump-installer-springfield' },
      { query: 'furnace repair springfield', position: 2, url: 'https://kestrel-heating.example/furnace-repair-springfield' },
      { query: 'emergency hvac springfield', position: 2, url: 'https://kestrel-heating.example/emergency-hvac-springfield' },
      { query: 'ac installation springfield', position: 3, url: 'https://kestrel-heating.example/ac-installation-springfield' },
    ]);
    // Ranked once: not a competitor on this evidence.
    expect(found.some(c => c.domain === 'larkfield-plumbing.example')).toBe(false);
  });

  it('counts two pages of one site on one search once, at its best position', () => {
    const found = competitorsFromSerps([
      serp('furnace repair', ['kestrel-heating.example', 'kestrel-heating.example']),
      serp('ac repair', ['contoso-air.example']),
    ]);

    expect(found).toEqual([]);
  });

  it('takes a threshold and extra exclusions', () => {
    expect(competitorsFromSerps(serps, { ownDomains: ['northwind-home.example'], minSearches: 3 }).map(c => c.domain)).toEqual(['kestrel-heating.example']);
    expect(competitorsFromSerps(serps, { ownDomains: ['northwind-home.example'], exclude: ['kestrel-heating.example'] }).map(c => c.domain)).toEqual(['bellwater-hvac.example', 'contoso-air.example']);
  });
});
