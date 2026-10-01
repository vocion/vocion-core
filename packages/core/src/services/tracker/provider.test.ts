/**
 * Which tracker answers: the source whose projects include the issue key's
 * prefix, else the only source, else a refusal that names what is connected.
 */
import { describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({ rows: [] as Array<{ id: number; slug: string; kind: string; config: Record<string, unknown>; apiTokenId: string | null }> }));
vi.mock('@/libs/connectors/families', () => ({ familySourcesForOrg: async () => sources.rows }));
vi.mock('./providers/jira', () => ({ jiraTrackerProvider: async (_org: string, source: { slug: string; config: { projectKeys: string[] } }) => ({ kind: 'jira', sourceSlug: source.slug, projectKeys: source.config.projectKeys }) }));

const { projectKeyOf, trackerProviderFor } = await import('./provider');

describe('trackerProviderFor', () => {
  it('reads the project off an issue key', () => {
    expect(projectKeyOf('NOCO-123')).toBe('NOCO');
    expect(projectKeyOf('noco-1')).toBe('NOCO');
    expect(projectKeyOf('not a key')).toBeNull();
  });

  it('picks the source configured for the key\'s project, and the only source when no key is given', async () => {
    sources.rows = [
      { id: 1, slug: 'jira', kind: 'jira', config: { projectKeys: ['NOCO'] }, apiTokenId: null },
      { id: 2, slug: 'jira-ops', kind: 'jira', config: { projectKeys: ['OPS'] }, apiTokenId: null },
    ];

    await expect(trackerProviderFor('org', { issueKey: 'OPS-4' })).resolves.toMatchObject({ sourceSlug: 'jira-ops' });
    await expect(trackerProviderFor('org', { sourceSlug: 'jira' })).resolves.toMatchObject({ sourceSlug: 'jira' });
    await expect(trackerProviderFor('org')).rejects.toThrow(/2 tracker sources/);
    await expect(trackerProviderFor('org', { issueKey: 'ZZ-1' })).rejects.toThrow(/project ZZ.*jira \(jira: NOCO\)/);

    sources.rows = [sources.rows[0]!];

    await expect(trackerProviderFor('org')).resolves.toMatchObject({ sourceSlug: 'jira' });

    sources.rows = [];

    await expect(trackerProviderFor('org', { issueKey: 'NOCO-1' })).rejects.toThrow(/no issue tracker connected/);
  });
});
