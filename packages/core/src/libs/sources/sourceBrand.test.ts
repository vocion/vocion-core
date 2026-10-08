import { describe, expect, it } from 'vitest';
import { sourceBrandLookup } from './sourceBrand';

describe('sourceBrandLookup', () => {
  const brandOf = sourceBrandLookup([
    { slug: 'crm-northwind', kind: 'plugin', config: { _connector: 'hubspot' } },
    { slug: 'kestrel-site', kind: 'web', config: {} },
  ]);

  it('reads the brand of the connector behind a source row', () => {
    expect(brandOf('crm-northwind')).toBe('hubspot');
  });

  it('has none for a connector that is not one vendor', () => {
    expect(brandOf('kestrel-site')).toBeNull();
  });

  it('reads a slug with no source row as a connector slug', () => {
    expect(brandOf('gmail')).toBe('gmail');
    expect(brandOf('not-a-connector')).toBeNull();
  });
});
