/**
 * The rename stopped at the front end.
 *
 * Renaming `SourceConnector`, `source_install`, `knowledge_source` and
 * `libs/sources/` would touch the schema, the sync orchestrator and every
 * connector, and buy nothing a user can see. This test is what keeps a
 * well-meant follow-up rename from starting: the identifiers are asserted here
 * so changing one fails a test that says why it should not.
 */
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listConnectors } from '@/libs/sources/registry';
import {
  knowledgeSourceSchema,
  sourceCredentialSchema,
  sourceInstallSchema,
  sourceSyncCheckpointSchema,
} from '@/models/Schema';

describe('table names', () => {
  it('are unchanged by the rename', () => {
    expect(getTableName(sourceInstallSchema)).toBe('source_install');
    expect(getTableName(sourceCredentialSchema)).toBe('source_credential');
    expect(getTableName(knowledgeSourceSchema)).toBe('knowledge_source');
    expect(getTableName(sourceSyncCheckpointSchema)).toBe('source_sync_checkpoint');
  });
});

describe('connector slugs', () => {
  it('are unchanged by the rename, because a stored install names one', () => {
    // An install row holds its connector's slug, so renaming a slug would
    // orphan every install of it.
    const slugs = listConnectors().map(connector => connector.slug).sort();

    expect(slugs).toContain('strapi');
    expect(slugs).toContain('jira');
    expect(slugs).toContain('hubspot');
    expect(slugs).toContain('granola');
  });
});
