import { describe, expect, it } from 'vitest';
import { isDirectoryDomain } from './directories';

describe('isDirectoryDomain', () => {
  it('knows directories, marketplaces and social sites by host, subdomain or URL', () => {
    expect(isDirectoryDomain('yelp.com')).toBe(true);
    expect(isDirectoryDomain('www.angi.com')).toBe(true);
    expect(isDirectoryDomain('m.facebook.com')).toBe(true);
    expect(isDirectoryDomain('https://www.yelp.com/search?find_desc=plumber&find_loc=Fairview')).toBe(true);
    expect(isDirectoryDomain('en.wikipedia.org')).toBe(true);
  });

  it('leaves a business\'s own site alone, including one whose name merely contains a directory\'s', () => {
    expect(isDirectoryDomain('northwind-home.example')).toBe(false);
    expect(isDirectoryDomain('https://lakeside-plumbing.example/water-heaters')).toBe(false);
    expect(isDirectoryDomain('notyelp.com')).toBe(false);
    expect(isDirectoryDomain('')).toBe(false);
    expect(isDirectoryDomain(undefined)).toBe(false);
  });
});
