/**
 * Every connector's bulk-import descriptor, checked as a contract rather than
 * one connector at a time.
 *
 * The importer is generic, so a descriptor mistake — a column pointing at a
 * config field that does not exist, an identity column that is optional, an
 * example value the connector's own schema rejects — would not surface until an
 * operator uploaded a file. These tests catch it at the connector, and they
 * apply automatically to any connector added later.
 */
import { describe, expect, it } from 'vitest';
import { buildImportTemplate, previewSourceImport } from './bulkImport';
import { listConnectors } from './registry';

/** Connectors that have opted into CSV import. */
const importable = listConnectors().filter(connector => connector.bulkImport !== undefined);

/** Connectors deliberately left out, and why, so a regression reads as one. */
const NOT_IMPORTABLE_REASONS: Record<string, string> = {
  'strapi': 'needs the collection inspect round-trip and a per-instance token',
  'granola': 'exists once per org',
  'zoom': 'exists once per org',
  'local-files': 'reads a server-local directory',
  'file-import': 'its field mapping is a nested record, not a CSV cell',
};

describe('bulk import descriptors', () => {
  it('covers exactly the connectors the ticket scoped in', () => {
    expect(importable.map(connector => connector.slug).sort()).toEqual([
      'drive',
      'ga4',
      'gmail',
      'google-ads',
      'google-calendar',
      'hubspot',
      'jira',
      's3',
      'slack',
      'web',
    ]);
  });

  it('leaves the rest out on purpose', () => {
    const excluded = listConnectors()
      .filter(connector => connector.bulkImport === undefined)
      .map(connector => connector.slug);

    for (const slug of excluded) {
      expect(NOT_IMPORTABLE_REASONS[slug], `${slug} has no bulk import and no reason on record`).toBeDefined();
    }
  });

  it.each(importable.map(connector => [connector.slug, connector] as const))(
    '%s: its own template imports cleanly',
    (_slug, connector) => {
      const { preview, error } = previewSourceImport({
        connector,
        csvText: buildImportTemplate(connector),
        existingSources: [],
      });

      expect(error).toBeNull();
      expect(preview?.rows[0]?.problem ?? null).toBeNull();
      expect(preview?.summary).toMatchObject({ total: 1, willAdd: 1 });
    },
  );

  it.each(importable.map(connector => [connector.slug, connector] as const))(
    '%s: names declared columns as its identity, the first of them required',
    (_slug, connector) => {
      const descriptor = connector.bulkImport!;

      expect(descriptor.identityColumns.length).toBeGreaterThan(0);

      for (const columnName of descriptor.identityColumns) {
        const column = descriptor.columns.find(candidate => candidate.column === columnName);

        expect(column, `identity column ${columnName} is not declared`).toBeDefined();
      }
      // The first identity column also names the source, so a row without it
      // could not be given a slug.
      const first = descriptor.columns.find(column => column.column === descriptor.identityColumns[0]);

      expect(first!.required, `first identity column ${first!.column} must be required`).toBe(true);
    },
  );

  it.each(importable.map(connector => [connector.slug, connector] as const))(
    '%s: uses lower snake case column names, and no reserved name',
    (_slug, connector) => {
      for (const column of connector.bulkImport!.columns) {
        expect(column.column).toMatch(/^[a-z][a-z0-9_]*$/);
        // `slug` is prepended by the template itself; a connector declaring it
        // again would produce two columns with one name.
        expect(column.column).not.toBe('slug');
      }
    },
  );

  it.each(importable.map(connector => [connector.slug, connector] as const))(
    '%s: rejects a row that is missing its identity',
    (_slug, connector) => {
      const descriptor = connector.bulkImport!;
      const header = ['slug', ...descriptor.columns.map(column => column.column)];
      // Same as the template's example row, with every identity cell emptied.
      // Only the first identity column has to be present: a later one may be
      // legitimately blank (S3's whole-bucket prefix).
      const cells = ['', ...descriptor.columns.map(column =>
        column.column === descriptor.identityColumns[0] ? '' : column.example)];
      const { preview } = previewSourceImport({
        connector,
        // A slug keeps the row from reading as blank, so the identity check is
        // what rejects it rather than the blank-row filter.
        csvText: [header.join(','), ['placeholder', ...cells.slice(1)].join(',')].join('\n'),
        existingSources: [],
      });

      expect(preview?.rows[0]?.verdict).toBe('malformed');
    },
  );

  it.each(importable.map(connector => [connector.slug, connector] as const))(
    '%s: recognises its own example row as already configured',
    (_slug, connector) => {
      const template = buildImportTemplate(connector);
      const first = previewSourceImport({ connector, csvText: template, existingSources: [] });
      const row = first.preview!.rows[0]!;

      const second = previewSourceImport({
        connector,
        csvText: template,
        existingSources: [{ slug: row.slug!, config: row.config! }],
      });

      expect(second.preview!.rows[0]!.verdict).toBe('already-exists');
    },
  );
});
