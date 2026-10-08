import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPlatforms } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { isBrandKey, listBrands, resolveBrandMark } from './catalog';

/**
 * Whether a brand draws: its mark resolves, or the catalog says why it falls
 * back to the monogram. Anything else is a key nobody can see.
 * @param brand - A descriptor's `brand`.
 */
function resolvesOrFallsBack(brand: string): 'mark' | 'fallback' | 'unknown' {
  if (!isBrandKey(brand)) {
    return 'unknown';
  }
  if (resolveBrandMark(brand)) {
    return 'mark';
  }
  return listBrands().find(entry => entry.key === brand)?.fallback ? 'fallback' : 'unknown';
}

describe('brand catalog', () => {
  it('gives every brand either a drawable mark or a reason it has none', () => {
    for (const brand of listBrands()) {
      if (brand.mark?.kind === 'path') {
        expect(brand.mark.path, brand.key).toMatch(/^M/);
        expect(brand.mark.hex, brand.key).toMatch(/^#[0-9a-f]{6}$/i);
        expect(brand.fallback, brand.key).toBeNull();
      } else if (brand.mark?.kind === 'file') {
        // A vendored file is on disk, under public/, and is plain vector art.
        for (const file of [brand.mark.light, brand.mark.dark].filter((f): f is string => Boolean(f))) {
          expect(file, brand.key).toMatch(/^\/brand\/integrations\/[\w.-]+\/[\w.-]+\.svg$/);

          const svg = readFileSync(join(import.meta.dirname, '../../../public', file), 'utf8');

          expect(svg, file).toMatch(/<svg[\s>]/);
          expect(svg, file).not.toMatch(/<script|javascript:|<foreignObject|xlink:href="http|href="http/i);
        }

        expect(brand.fallback, brand.key).toBeNull();
      } else {
        expect(brand.fallback, brand.key).toBeTruthy();
      }
    }
  });

  it('resolves a mark with a fill for each theme, and nothing for an unknown or absent brand', () => {
    expect(resolveBrandMark('github')).toMatchObject({ title: 'GitHub', fills: { light: '#181717', dark: null } });
    expect(resolveBrandMark('not-a-brand')).toBeNull();
    expect(resolveBrandMark(null)).toBeNull();
    expect(resolveBrandMark(undefined)).toBeNull();
    // A key on the object's prototype is not a brand.
    expect(resolveBrandMark('toString')).toBeNull();
  });

  it('lists every brand in ATTRIBUTION.md with its source or the reason it falls back', () => {
    const attribution = readFileSync(join(import.meta.dirname, 'ATTRIBUTION.md'), 'utf8');
    for (const brand of listBrands()) {
      const row = attribution.split('\n').find(line => line.startsWith(`| \`${brand.key}\` |`));

      expect(row, `ATTRIBUTION.md has no row for ${brand.key}`).toBeDefined();

      if (brand.mark?.kind === 'path') {
        expect(row, brand.key).toContain('simple-icons');
        expect(row, brand.key).toContain('CC0-1.0');
      } else if (brand.mark?.kind === 'file') {
        // Its source and the terms page the use rests on.
        expect(row, brand.key).toContain('Vendored');
        expect(row, brand.key).toContain(brand.mark.terms);
      } else {
        expect(row, brand.key).toContain('No logo');
      }
    }
  });
});

describe('descriptor brands', () => {
  // The descriptors that are not one vendor, and so carry no brand. Everything
  // else must name one, so a platform or connector added without a brand fails
  // here rather than shipping a bare monogram nobody chose.
  const UNBRANDED_PLATFORMS = new Set(['vocion', 'rest', 'app-login', 'custom']);
  const UNBRANDED_CONNECTORS = new Set(['web', 'local-files', 'file-import', 'rest']);

  it.each(listPlatforms().map(platform => [platform.id, platform.brand] as const))('platform %s names a brand that resolves or falls back', (id, brand) => {
    if (UNBRANDED_PLATFORMS.has(id)) {
      expect(brand).toBeUndefined();

      return;
    }

    expect(brand, `${id} has no brand`).toBeDefined();
    expect(resolvesOrFallsBack(brand!)).not.toBe('unknown');
  });

  it.each(listConnectors().map(connector => [connector.slug, connector.brand] as const))('connector %s names a brand that resolves or falls back', (slug, brand) => {
    if (UNBRANDED_CONNECTORS.has(slug)) {
      expect(brand).toBeUndefined();

      return;
    }

    expect(brand, `${slug} has no brand`).toBeDefined();
    expect(resolvesOrFallsBack(brand!)).not.toBe('unknown');
  });

  it('names no brand the catalog does not use', () => {
    const named = new Set([...listPlatforms().map(p => p.brand), ...listConnectors().map(c => c.brand)].filter(Boolean));
    const unused = listBrands().map(brand => brand.key).filter(key => !named.has(key));

    expect(unused).toEqual([]);
  });
});
