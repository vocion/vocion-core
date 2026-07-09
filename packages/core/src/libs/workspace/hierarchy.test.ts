import { describe, expect, it } from 'vitest';
import { assertAgentHierarchy, deriveRole } from './hierarchy';

const agent = (slug: string, overrides: Partial<{ parent: string; role: 'lead' | 'specialist' }> = {}) => ({
  slug,
  sourceFile: `agents/${slug}.yaml`,
  ...overrides,
});

describe('deriveRole', () => {
  it('derives specialist when parent is set, lead otherwise', () => {
    expect(deriveRole('revenue-lead')).toBe('specialist');
    expect(deriveRole(undefined)).toBe('lead');
  });
});

describe('assertAgentHierarchy', () => {
  it('accepts primaries and one level of specialists', () => {
    expect(() => assertAgentHierarchy([
      agent('revenue-lead'),
      agent('hiring-manager'),
      agent('pipeline-analyst', { parent: 'revenue-lead' }),
      agent('proposal-writer', { parent: 'revenue-lead' }),
    ])).not.toThrow();
  });

  it('rejects an unknown parent slug', () => {
    expect(() => assertAgentHierarchy([
      agent('pipeline-analyst', { parent: 'revenue-lead' }),
    ])).toThrow(/unknown parent "revenue-lead"/);
  });

  it('rejects self-reference', () => {
    expect(() => assertAgentHierarchy([
      agent('revenue-lead', { parent: 'revenue-lead' }),
    ])).toThrow(/cannot be its own parent/);
  });

  it('rejects nesting deeper than one level', () => {
    expect(() => assertAgentHierarchy([
      agent('revenue-lead'),
      agent('pipeline-analyst', { parent: 'revenue-lead' }),
      agent('deal-scorer', { parent: 'pipeline-analyst' }),
    ])).toThrow(/one level deep/);
  });

  it('rejects an authored role that conflicts with parentage', () => {
    expect(() => assertAgentHierarchy([
      agent('revenue-lead'),
      agent('pipeline-analyst', { parent: 'revenue-lead', role: 'lead' }),
    ])).toThrow(/role is derived from parent/);
  });

  it('accepts an authored role that matches the derived value', () => {
    expect(() => assertAgentHierarchy([
      agent('revenue-lead', { role: 'lead' }),
      agent('pipeline-analyst', { parent: 'revenue-lead', role: 'specialist' }),
    ])).not.toThrow();
  });

  it('collects every violation in one error', () => {
    expect(() => assertAgentHierarchy([
      agent('a', { parent: 'a' }),
      agent('b', { parent: 'ghost' }),
    ])).toThrow(/own parent[\s\S]*unknown parent/);
  });
});
