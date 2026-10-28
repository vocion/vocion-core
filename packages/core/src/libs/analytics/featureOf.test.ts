import { describe, expect, it } from 'vitest';
import { featureOf } from './featureOf';

describe('featureOf', () => {
  it('names a dashboard page by its first segment, ignoring ids and queries', () => {
    expect(featureOf('/dashboard/review/42')).toBe('review');
    expect(featureOf('/dashboard/automations?tab=runs')).toBe('automations');
    expect(featureOf('/dashboard')).toBe('home');
  });

  it('names a page outside the dashboard by its area and page', () => {
    expect(featureOf('/gtm/proposals/7')).toBe('gtm/proposals');
    expect(featureOf('/gtm')).toBe('gtm');
    expect(featureOf('/')).toBe('home');
    expect(featureOf(null)).toBe('home');
  });
});
