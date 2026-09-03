/**
 * The CSV bulk importer, row by row.
 *
 * The behaviour worth pinning down is what happens to a row that is *not*
 * perfect: the old single-add path silently collapsed two URLs on one host into
 * one source and dropped the second config, so most of these tests are about a
 * row being reported rather than swallowed. The rest cover the coercion a CSV
 * forces on us — every cell arrives as text, including the numbers and booleans
 * the connector schemas require.
 */
import type { SourceConnector } from './types';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildImportTemplate,
  importTemplateFileName,
  MAX_IMPORT_ROWS,
  normalizeIdentity,
  previewSourceImport,
  readIdentity,
  readIdentityParts,
  uniqueSlug,
} from './bulkImport';
import { hubspotConnector } from './hubspot';
import { jiraConnector } from './jira';
import { s3Connector } from './s3';
import { strapiConnector } from './strapi';
import { webConnector } from './web';

/**
 * Preview a CSV for a connector with nothing already configured.
 * @param connector - Connector to import for.
 * @param csvText - The file text.
 * @param existingSources - Sources already configured, when the case needs some.
 */
function preview(
  connector: SourceConnector,
  csvText: string,
  existingSources: Array<{ slug: string; config: Record<string, unknown> }> = [],
) {
  return previewSourceImport({ connector, csvText, existingSources });
}

/**
 * Rows in a web CSV, with the template's header.
 * @param rows
 */
function webCsv(...rows: string[]): string {
  return ['slug,url,crawl,max_depth,max_pages', ...rows].join('\n');
}

/* ------------------------------------------------------------------ */
/* Stand-in connectors for branches no shipped connector reaches       */
/* ------------------------------------------------------------------ */

/**
 * A connector whose schema rejects every row at the object level, so the
 * rejection carries no field path to map back to a column.
 */
const refusingConnector = {
  slug: 'refusing',
  name: 'Refusing',
  description: 'test double',
  icon: 'Bug',
  authKind: 'none',
  configSchema: z.object({ name: z.string() }).refine(() => false, {
    message: 'this connector refuses everything',
  }),
  bulkImport: {
    columns: [{ column: 'name', type: 'text', required: true, configPath: 'name', example: 'x' }],
    identityColumns: ['name'],
  },

  async* sync() {},
} satisfies SourceConnector;

/**
 * A connector whose schema fails with an empty issue list — the shape a custom
 * Zod-like validator can produce, and the reason the importer has a fallback
 * sentence rather than reading `issues[0]` blind.
 */
const issuelessConnector = {
  ...refusingConnector,
  slug: 'issueless',
  configSchema: {
    safeParse: () => ({ success: false as const, error: { issues: [] } }),
  } as never,
} satisfies SourceConnector;

/** A connector whose custom identity reader hands back nothing usable. */
const blankIdentityConnector = {
  ...refusingConnector,
  slug: 'blank-identity',
  configSchema: z.object({ name: z.string() }),
  bulkImport: {
    ...refusingConnector.bulkImport,
    identityFromConfig: () => ['   '],
  },
} satisfies SourceConnector;

/** A connector whose identity column writes no config path at all. */
const pathlessIdentityConnector = {
  ...refusingConnector,
  slug: 'pathless-identity',
  configSchema: z.object({ name: z.string() }),
  bulkImport: {
    columns: [{ column: 'name', type: 'text', required: true, example: 'x' }],
    identityColumns: ['name'],
  },
} satisfies SourceConnector;

/** A connector whose column lands two levels deep, so the path must be built. */
const nestedConfigConnector = {
  ...refusingConnector,
  slug: 'nested-config',
  configSchema: z.object({ outer: z.object({ inner: z.string(), note: z.string().optional() }) }),
  bulkImport: {
    columns: [
      { column: 'name', type: 'text', required: true, configPath: 'outer.inner', example: 'hello' },
      // A second column under the same parent, so the writer has to reuse the
      // object it created for the first rather than replace it.
      { column: 'note', type: 'text', required: false, configPath: 'outer.note', example: 'hi' },
    ],
    identityColumns: ['name'],
  },
} satisfies SourceConnector;

/**
 * A connector that names an optional column as its identity — a descriptor
 * mistake. The importer refuses the row rather than creating a nameless source.
 */
const optionalIdentityConnector = {
  ...refusingConnector,
  slug: 'optional-identity',
  configSchema: z.object({ name: z.string().optional() }),
  bulkImport: {
    columns: [{ column: 'name', type: 'text', required: false, configPath: 'name', example: 'x' }],
    identityColumns: ['name'],
  },
} satisfies SourceConnector;

describe('buildImportTemplate', () => {
  it('leads with the optional slug column, then the connector\'s own columns', () => {
    const [header, example] = buildImportTemplate(webConnector).split('\n');

    expect(header).toBe('slug,url,crawl,max_depth,max_pages');
    expect(example).toBe(',https://example.com/docs,true,1,20');
  });

  it('produces an example row that actually imports, so editing it in place works', () => {
    const template = buildImportTemplate(webConnector);
    const { preview: result, error } = preview(webConnector, template);

    expect(error).toBeNull();
    expect(result?.summary).toMatchObject({ total: 1, willAdd: 1 });
  });

  it('quotes an example value that contains the delimiter', () => {
    const [, example] = buildImportTemplate(jiraConnector).split('\n');

    // `project_keys` is semicolon-separated precisely so a cell never needs
    // quoting; the base URL still must not split the row.
    expect(example).toContain('https://acme.atlassian.net');
    expect(example).toContain('ENG;OPS');
  });

  it('names the download after the connector', () => {
    expect(importTemplateFileName(webConnector)).toBe('web-sources-template.csv');
  });

  it('refuses a connector that has not opted in', () => {
    expect(() => buildImportTemplate(strapiConnector)).toThrow(/does not support bulk import/);
    expect(() => preview(strapiConnector, 'a\n1')).toThrow(/does not support bulk import/);
  });
});

describe('previewSourceImport — the whole file', () => {
  it('rejects a file with no header row', () => {
    expect(preview(webConnector, '').error).toMatch(/no header row/);
  });

  it('rejects a file missing a required column', () => {
    const { error } = preview(webConnector, 'slug,crawl\nmine,true');

    expect(error).toMatch(/missing the "url" column/);
  });

  it('rejects a header with no data rows', () => {
    expect(preview(webConnector, webCsv()).error).toMatch(/no data rows/);
  });

  it('ignores blank spacer rows rather than calling them malformed', () => {
    const { preview: result } = preview(webConnector, webCsv(
      ',https://a.example/one,,,',
      ',,,,',
      ',https://a.example/two,,,',
    ));

    expect(result?.summary.total).toBe(2);
    expect(result?.rows.map(row => row.line)).toEqual([2, 4]);
  });

  it('rejects a file over the row limit instead of importing part of it', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `,https://a.example/p${index},,,`);
    const { error } = preview(webConnector, webCsv(...rows));

    expect(error).toMatch(new RegExp(`${MAX_IMPORT_ROWS}-row limit`));
  });

  it('imports a file whose optional slug column was deleted', () => {
    const { preview: result, error } = preview(
      webConnector,
      ['url,crawl', 'https://a.example/docs,true'].join('\n'),
    );

    expect(error).toBeNull();
    expect(result!.rows[0]).toMatchObject({ verdict: 'ok', slug: 'web-a-example-docs' });
  });

  it('reads a row with fewer cells than the header as empty optional cells', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example/docs'));

    expect(result!.rows[0]).toMatchObject({ verdict: 'ok' });
    // The connector's own schema defaults fill the cells the row did not carry.
    expect(result!.rows[0]!.config).toEqual({ crawl: { startUrl: 'https://a.example/docs', maxDepth: 1, maxPages: 50 } });
  });

  it('rejects a file over the byte limit', () => {
    const fatCell = 'x'.repeat(1_100_000);
    const { error } = preview(webConnector, webCsv(`,https://a.example/${fatCell},,,`));

    expect(error).toMatch(/larger than the 1 MB limit/);
  });
});

describe('previewSourceImport — slugs', () => {
  it('gives every URL on one host its own slug, which is the bug this replaces', () => {
    const { preview: result } = preview(webConnector, webCsv(
      ',https://docs.example.com/guide/intro,,,',
      ',https://docs.example.com/guide/setup,,,',
      ',https://docs.example.com/guide/intro?v=2,,,',
    ));

    const slugs = result!.rows.map(row => row.slug);

    expect(new Set(slugs).size).toBe(3);
    expect(slugs[0]).toBe('web-docs-example-com-guide-intro');
    expect(slugs[1]).toBe('web-docs-example-com-guide-setup');
  });

  it('suffixes when two rows derive the same slug', () => {
    // Two paths that slugify identically — different sources, same seed.
    const { preview: result } = preview(webConnector, webCsv(
      ',https://a.example/one_two,,,',
      ',https://a.example/one-two,,,',
    ));

    expect(result!.rows.map(row => row.slug)).toEqual(['web-a-example-one-two', 'web-a-example-one-two-2']);
  });

  it('suffixes around a slug an existing source already holds', () => {
    const { preview: result } = preview(
      webConnector,
      webCsv(',https://a.example/docs,,,'),
      [{ slug: 'web-a-example-docs', config: { crawl: { startUrl: 'https://b.example/docs' } } }],
    );

    expect(result!.rows[0]!.slug).toBe('web-a-example-docs-2');
  });

  it('honours an operator-chosen slug, slugified', () => {
    const { preview: result } = preview(webConnector, webCsv('Product Docs,https://a.example/docs,,,'));

    expect(result!.rows[0]!.slug).toBe('product-docs');
  });

  it('refuses an operator-chosen slug that is already taken', () => {
    const { preview: result } = preview(
      webConnector,
      webCsv('product-docs,https://a.example/docs,,,'),
      [{ slug: 'product-docs', config: { crawl: { startUrl: 'https://b.example' } } }],
    );

    expect(result!.rows[0]).toMatchObject({ verdict: 'duplicate-in-file', problem: expect.stringContaining('already taken') });
  });
});

describe('previewSourceImport — cells', () => {
  it('coerces the numbers a CSV can only carry as text', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example,true,2,50'));

    expect(result!.rows[0]!.config).toEqual({ crawl: { startUrl: 'https://a.example', maxDepth: 2, maxPages: 50 } });
  });

  it('reads a single-page fetch when crawl is off, and leaves the crawl bounds out', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example/page,false,1,20'));

    expect(result!.rows[0]!.config).toEqual({ urls: ['https://a.example/page'] });
  });

  it.each([['yes'], ['Y'], ['1'], ['TRUE']])('reads %s as true', (cell) => {
    const { preview: result } = preview(webConnector, webCsv(`,https://a.example,${cell},,`));

    expect(result!.rows[0]!.config).toHaveProperty('crawl');
  });

  it.each([['no'], ['N'], ['0'], ['False']])('reads %s as false', (cell) => {
    const { preview: result } = preview(webConnector, webCsv(`,https://a.example,${cell},,`));

    expect(result!.rows[0]!.config).toHaveProperty('urls');
  });

  it('flags a non-numeric number cell by column name', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example,true,,abc'));

    expect(result!.rows[0]).toMatchObject({
      verdict: 'malformed',
      problem: '"max_pages" must be a number, got "abc"',
    });
  });

  it('flags a boolean cell that is neither', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example,maybe,,'));

    expect(result!.rows[0]!.problem).toBe('"crawl" must be true or false, got "maybe"');
  });

  it('flags a missing required cell by column name', () => {
    const { preview: result } = preview(webConnector, webCsv(',,true,,'));

    expect(result!.rows[0]).toMatchObject({ verdict: 'malformed', problem: '"url" is required' });
  });

  it('splits a list cell on semicolons and drops the empty entries', () => {
    const { preview: result } = preview(
      jiraConnector,
      ['slug,base_url,project_keys,done_window_days,include_description,not_done_statuses', ',https://acme.atlassian.net,ENG; OPS ;,30,true,Won\'t Do;Parked'].join('\n'),
    );

    expect(result!.rows[0]!.config).toMatchObject({
      projectKeys: ['ENG', 'OPS'],
      notDoneStatuses: ['Won\'t Do', 'Parked'],
      doneWindowDays: 30,
      includeDescription: true,
    });
  });

  it('flags a list cell that holds only separators', () => {
    const { preview: result } = preview(
      jiraConnector,
      ['slug,base_url,project_keys', ',https://acme.atlassian.net,;;'].join('\n'),
    );

    expect(result!.rows[0]!.problem).toBe('"project_keys" has no values');
  });

  it('leaves an optional empty cell out so the connector default applies', () => {
    const { preview: result } = preview(
      hubspotConnector,
      ['slug,object_type,properties,portal_id', ',contacts,,'].join('\n'),
    );

    expect(result!.rows[0]!.config).toMatchObject({ objectType: 'contacts', baseUrl: 'https://api.hubapi.com' });
    expect(result!.rows[0]!.config).not.toHaveProperty('portalId');
  });
});

describe('previewSourceImport — schema rejections', () => {
  it('names the CSV column when the connector schema rejects its value', () => {
    const { preview: result } = preview(webConnector, webCsv(',https://a.example,true,,900'));

    expect(result!.rows[0]).toMatchObject({
      verdict: 'malformed',
      problem: expect.stringContaining('"max_pages" is not valid'),
    });
  });

  it('names the column for a bad URL, even though a custom builder writes it', () => {
    const { preview: result } = preview(webConnector, webCsv(',not-a-url,true,,'));

    expect(result!.rows[0]!.problem).toMatch(/^"url" is not valid/);
  });

  it('names the config path when no column writes it', () => {
    const { preview: result } = preview(pathlessIdentityConnector, 'slug,name\n,anything');

    expect(result!.rows[0]!.problem).toMatch(/^name is not valid/);
  });

  it('reports a whole-object rejection in the schema\'s own words', () => {
    const { preview: result } = preview(refusingConnector, 'slug,name\n,anything');

    expect(result!.rows[0]!.problem).toBe('this connector refuses everything');
  });

  it('falls back to a generic sentence when a rejection carries no issues', () => {
    const { preview: result } = preview(issuelessConnector, 'slug,name\n,anything');

    expect(result!.rows[0]!.problem).toBe('that row is not valid for this source type');
  });
});

describe('previewSourceImport — duplicates and existing sources', () => {
  it('flags the same URL listed twice, keeping the first', () => {
    const { preview: result } = preview(webConnector, webCsv(
      ',https://a.example/docs,,,',
      ',https://a.example/docs/,,,',
    ));

    expect(result!.rows.map(row => row.verdict)).toEqual(['ok', 'duplicate-in-file']);
    expect(result!.summary).toMatchObject({ willAdd: 1, duplicateInFile: 1 });
  });

  it('leaves a row alone when that source is already configured', () => {
    const { preview: result } = preview(
      webConnector,
      webCsv(',https://A.Example/docs,,,'),
      [{ slug: 'web-a-example-docs', config: { crawl: { startUrl: 'https://a.example/docs' } } }],
    );

    expect(result!.rows[0]).toMatchObject({ verdict: 'already-exists', config: null });
    expect(result!.summary).toMatchObject({ willAdd: 0, alreadyExists: 1 });
  });

  it('recognises an existing single-URL source, not only a crawl', () => {
    const { preview: result } = preview(
      webConnector,
      webCsv(',https://a.example/page,false,,'),
      [{ slug: 'web-a-example-page', config: { urls: ['https://a.example/page'] } }],
    );

    expect(result!.rows[0]!.verdict).toBe('already-exists');
  });

  it('treats two Jira sources on one site as different when their projects differ', () => {
    const { preview: result } = preview(
      jiraConnector,
      ['slug,base_url,project_keys', ',https://acme.atlassian.net,ENG', ',https://acme.atlassian.net,OPS'].join('\n'),
    );

    expect(result!.rows.map(row => row.verdict)).toEqual(['ok', 'ok']);
  });

  it('treats the same Jira projects listed in another order as the same source', () => {
    const { preview: result } = preview(
      jiraConnector,
      ['slug,base_url,project_keys', ',https://acme.atlassian.net,ENG;OPS', ',https://acme.atlassian.net,OPS;ENG'].join('\n'),
    );

    expect(result!.rows.map(row => row.verdict)).toEqual(['ok', 'duplicate-in-file']);
  });

  it('treats a whole-bucket S3 source and a prefixed one as different sources', () => {
    const { preview: result } = preview(
      s3Connector,
      ['slug,bucket,prefix,region,extensions,max_objects', ',assets,,,,', ',assets,templates/,,,'].join('\n'),
    );

    expect(result!.rows.map(row => row.verdict)).toEqual(['ok', 'ok']);
    expect(result!.rows.map(row => row.identity)).toEqual(['assets|', 'assets|templates/']);
  });

  it('counts every verdict in the summary', () => {
    const { preview: result } = preview(
      webConnector,
      webCsv(
        ',https://a.example/one,,,',
        ',https://a.example/two,,,',
        ',https://a.example/one,,,',
        ',,,,x',
        ',https://taken.example/page,,,',
      ),
      [{ slug: 'web-taken-example-page', config: { crawl: { startUrl: 'https://taken.example/page' } } }],
    );

    expect(result!.summary).toEqual({
      total: 5,
      willAdd: 2,
      malformed: 1,
      duplicateInFile: 1,
      alreadyExists: 1,
    });
  });
});

describe('previewSourceImport — nested config paths', () => {
  it('creates the intermediate objects a dotted path needs, and reuses them', () => {
    const { preview: result } = preview(nestedConfigConnector, 'slug,name,note\n,hello,howdy');

    expect(result!.rows[0]!.config).toEqual({ outer: { inner: 'hello', note: 'howdy' } });
  });

  it('falls back to the connector name when the identity slugifies to nothing', () => {
    const { preview: result } = preview(nestedConfigConnector, 'slug,name\n,###');

    expect(result!.rows[0]!.slug).toBe('nested-config');
  });

  it('reports no identity when the path runs into a non-object', () => {
    expect(readIdentity(nestedConfigConnector, { outer: 'not-an-object' })).toBeNull();
  });

  it('still requires an identity column that the descriptor left optional', () => {
    // The slug cell keeps the row from reading as blank, so the identity check
    // is what rejects it.
    const { preview: result } = preview(optionalIdentityConnector, 'slug,name\nmine,');

    expect(result!.rows[0]).toMatchObject({ verdict: 'malformed', problem: '"name" is required' });
  });
});

describe('identity helpers', () => {
  it('treats case and a trailing slash as the same URL', () => {
    expect(normalizeIdentity('https://A.Example.com/Docs/')).toBe('https://a.example.com/Docs');
  });

  it('keeps a query string, because it can name a different page', () => {
    expect(normalizeIdentity('https://a.example/p?id=2')).toBe('https://a.example/p?id=2');
  });

  it('lower-cases a value that is not a URL', () => {
    expect(normalizeIdentity(' C0123ABCD ')).toBe('c0123abcd');
  });

  it('reads an identity out of a stored config', () => {
    expect(readIdentity(webConnector, { crawl: { startUrl: 'https://a.example/x/' } })).toBe('https://a.example/x');
    expect(readIdentity(hubspotConnector, { objectType: 'Deals' })).toBe('deals');
  });

  it('joins a multi-column identity', () => {
    expect(readIdentity(jiraConnector, { baseUrl: 'https://acme.atlassian.net', projectKeys: ['OPS', 'ENG'] }))
      .toBe('https://acme.atlassian.net|eng,ops');
  });

  it('reports no identity when the config names nothing', () => {
    expect(readIdentity(webConnector, {})).toBeNull();
    expect(readIdentity(hubspotConnector, {})).toBeNull();
    expect(readIdentityParts(webConnector, { crawl: {} })).toBeNull();
  });

  it('treats a blank later identity part as the empty value, not as no identity', () => {
    // The part still counts: a source reading a whole S3 bucket has a real
    // identity, and only the FIRST part is what names the source.
    expect(readIdentity(jiraConnector, { baseUrl: 'https://acme.atlassian.net', projectKeys: ['  '] }))
      .toBe('https://acme.atlassian.net|');
  });

  it('reports no identity when a custom reader returns only blanks', () => {
    expect(readIdentity(blankIdentityConnector, { name: 'x' })).toBeNull();
  });

  it('reports no identity when an identity column writes no config path', () => {
    expect(readIdentity(pathlessIdentityConnector, { name: 'x' })).toBeNull();
  });
});

describe('uniqueSlug', () => {
  it('returns the seed when it is free', () => {
    expect(uniqueSlug('web-a', new Set())).toBe('web-a');
  });

  it('walks past every taken suffix', () => {
    expect(uniqueSlug('web-a', new Set(['web-a', 'web-a-2', 'web-a-3']))).toBe('web-a-4');
  });

  it('keeps the suffix inside the length cap', () => {
    const seed = `web-${'x'.repeat(56)}`;
    const suffixed = uniqueSlug(seed, new Set([seed]));

    expect(seed).toHaveLength(60);
    expect(suffixed).toHaveLength(60);
    expect(suffixed.endsWith('-2')).toBe(true);
  });
});
