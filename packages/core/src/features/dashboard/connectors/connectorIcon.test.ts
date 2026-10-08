import { describe, expect, it } from 'vitest';
import { listConnectors } from '@/libs/sources/registry';
import { hasConnectorIcon } from './connectorIcon';

describe('connectorIcon', () => {
  // A name missing from the list draws the plug, which reads as "unknown" on a
  // connector whose brand has no logo to stand in for it.
  it.each(listConnectors().map(connector => [connector.slug, connector.icon] as const))('carries the icon connector %s names', (_slug, icon) => {
    expect(hasConnectorIcon(icon)).toBe(true);
  });
});
