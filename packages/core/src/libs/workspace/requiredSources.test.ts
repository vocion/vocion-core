import { describe, expect, it } from 'vitest';
import { boundConnectorSources } from './requiredSources';

const sources = [
  { slug: 'quickbooks', kind: 'quickbooks' },
  { slug: 'payroll', kind: 'rippling' },
  { slug: 'gmail', kind: 'gmail' },
  { slug: 'deliverystack', kind: 'rest' },
];

describe('boundConnectorSources', () => {
  it('binds a family to every workspace source of it, whatever the workspace calls it', () => {
    expect(boundConnectorSources({ connectorSources: [], requires: { connectors: ['finance'], optional: ['people'] } }, sources))
      .toEqual(['quickbooks', 'payroll']);
  });

  it('binds a connector kind, keeps the agent\'s own sources first and never repeats one', () => {
    expect(boundConnectorSources({ connectorSources: ['deliverystack', 'gmail'], requires: { connectors: ['gmail'], optional: [] } }, sources))
      .toEqual(['deliverystack', 'gmail']);
  });

  it('binds nothing for a family the workspace has no source of', () => {
    expect(boundConnectorSources({ connectorSources: [], requires: { connectors: ['warehouse'], optional: ['ledger'] } }, sources)).toEqual([]);
  });
});
