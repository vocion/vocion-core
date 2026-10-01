import { describe, expect, it } from 'vitest';
import { connectorOfSource } from './connectorOf';

describe('connectorOfSource — which connector a source row is', () => {
  it('reads _connector first: a source added in the UI is stored as kind "plugin"', () => {
    expect(connectorOfSource({ slug: 'github-northwind', kind: 'plugin', config: { _connector: 'github', repos: ['northwind/app'] } })).toBe('github');
  });

  it('falls back to kind for a source applied from workspace YAML', () => {
    expect(connectorOfSource({ slug: 'crm', kind: 'hubspot', config: {} })).toBe('hubspot');
  });

  it('falls back to slug when kind is the generic "plugin" and no _connector is stored', () => {
    expect(connectorOfSource({ slug: 'slack', kind: 'plugin', config: {} })).toBe('slack');
  });
});
