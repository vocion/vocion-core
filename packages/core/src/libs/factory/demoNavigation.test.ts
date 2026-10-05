import { describe, expect, it } from 'vitest';
import { hrefLeadingTo } from './demoNavigation';

describe('a demo clicks the link that leads to the next page instead of teleporting', () => {
  const page = 'https://app.example/documents/abc?tab=links';

  it('finds the href that resolves to the target path and query, relative or absolute, ignoring the hash', () => {
    expect(hrefLeadingTo(['/library', '/documents/abc'], page, 'https://app.example/library')).toBe('/library');
    expect(hrefLeadingTo(['../library/', 'https://app.example/library#top'], page, 'https://app.example/library')).toBe('../library/');
    expect(hrefLeadingTo(['/library?tab=starred', '/library'], page, 'https://app.example/library?tab=starred')).toBe('/library?tab=starred');
  });

  it('finds nothing for another origin, a different query, a mailto or an empty href', () => {
    expect(hrefLeadingTo(['https://other.example/library'], page, 'https://app.example/library')).toBeNull();
    expect(hrefLeadingTo(['/library?tab=all'], page, 'https://app.example/library')).toBeNull();
    expect(hrefLeadingTo(['mailto:x@y.example', '', null, 'javascript:void(0)'], page, 'https://app.example/library')).toBeNull();
    expect(hrefLeadingTo(['/library'], 'not a url', 'https://app.example/library')).toBeNull();
  });
});
