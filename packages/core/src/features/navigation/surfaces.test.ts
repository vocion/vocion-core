import { describe, expect, it } from 'vitest';
import { groupEnabledSurfaces, isSurfaceId, SURFACE_PATH_SEGMENTS, SURFACES } from './surfaces';

describe('surface registry', () => {
  it('groups enabled surfaces under their section heading', () => {
    expect(groupEnabledSurfaces(['personalization', 'discovery'])).toEqual([
      {
        label: 'GTM',
        items: [
          { id: 'personalization', label: 'Personalization', url: '/gtm/personalization', icon: 'sparkles' },
          { id: 'discovery', label: 'Discovery ledger', url: '/gtm/discovery', icon: 'radar' },
        ],
      },
    ]);
  });

  it('skips ids this core does not register instead of rendering a dead link', () => {
    expect(groupEnabledSurfaces(['personalization', 'retired-surface'])).toEqual([
      {
        label: 'GTM',
        items: [
          { id: 'personalization', label: 'Personalization', url: '/gtm/personalization', icon: 'sparkles' },
        ],
      },
    ]);
  });

  it('renders nothing when no surface is enabled', () => {
    expect(groupEnabledSurfaces([])).toEqual([]);
  });

  it('only recognises registered ids', () => {
    expect(isSurfaceId('personalization')).toBe(true);
    expect(isSurfaceId('toString')).toBe(false);
  });

  it('points every surface at a two-segment section route', () => {
    for (const [id, surface] of Object.entries(SURFACES)) {
      expect(surface.url, id).toMatch(/^\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/);
      expect(surface.section, id).not.toBe('');
    }
  });

  it('exposes each surface segment so the auth proxy protects it', () => {
    // A surface reachable without a session would be a data leak, so the
    // proxy derives its pattern from this rather than a hand-kept list.
    expect(SURFACE_PATH_SEGMENTS).toEqual(['gtm']);

    for (const surface of Object.values(SURFACES)) {
      expect(SURFACE_PATH_SEGMENTS).toContain(surface.url.split('/')[1]);
    }
  });
});
