import { describe, expect, it } from 'vitest';
import { howToConnectFor } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { KEY_ONLY_CONNECTORS } from './clickToAuth';
import { providerForConnector } from './registry';

/**
 * CLICK TO AUTH, ALWAYS (Chris, 2026-10-25: "I want to be able to click to
 * auth. Always. Any connector."). A connector whose vendor offers a login is
 * connected by one click; a pasted key is the advanced path. A connector with
 * no login must say why, by name, in `KEY_ONLY_CONNECTORS`.
 */
describe('click to auth', () => {
  it('every connector with a login provider declares that login for itself', () => {
    const missing = listConnectors()
      .filter(c => providerForConnector(c.slug) !== null)
      .filter(c => !howToConnectFor(c.slug)?.login)
      .map(c => c.slug);

    expect(missing).toEqual([]);
  });

  it('a connector that can only take a key is listed, with the vendor\'s reason', () => {
    const unexplained = listConnectors()
      .filter(c => providerForConnector(c.slug) === null && howToConnectFor(c.slug)?.paste)
      .map(c => c.slug)
      .filter(slug => !KEY_ONLY_CONNECTORS[slug]);

    expect(unexplained).toEqual([]);
  });

  it('a listed key-only connector really has no login provider', () => {
    const contradicted = Object.keys(KEY_ONLY_CONNECTORS).filter(slug => providerForConnector(slug) !== null);

    expect(contradicted).toEqual([]);
  });
});
