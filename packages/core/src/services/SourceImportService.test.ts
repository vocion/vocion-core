/**
 * The CSV import, end to end against the database.
 *
 * The pure row logic is covered in `libs/sources/bulkImport.test.ts`; what
 * matters here is the part that needs real rows: that a preview writes nothing,
 * that "already configured" is judged against this org's sources for *this*
 * connector only, and that a commit creates exactly the rows the preview said
 * it would.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { addSource } = await import('@/services/SourceSyncService');
const { commitSourceImportForOrg, previewSourceImportForOrg } = await import('@/services/SourceImportService');

const ORG = 'org_import';
const OTHER_ORG = 'org_other';

const WEB_HEADER = 'slug,url,crawl,max_depth,max_pages';

/**
 * A web CSV with the template's header.
 * @param rows
 */
function webCsv(...rows: string[]): string {
  return [WEB_HEADER, ...rows].join('\n');
}

/**
 * Slugs this org holds, sorted.
 * @param orgId
 */
async function storedSlugs(orgId = ORG): Promise<string[]> {
  const rows = await db
    .select({ slug: knowledgeSourceSchema.slug, orgId: knowledgeSourceSchema.orgId })
    .from(knowledgeSourceSchema);
  return rows.filter(row => row.orgId === orgId).map(row => row.slug).sort();
}

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeSourceSchema);
});

describe('previewSourceImportForOrg', () => {
  it('reports a verdict per row and creates nothing', async () => {
    const result = await previewSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(',https://a.example/one,,,', ',https://a.example/two,,,'),
    });

    expect(result.error).toBeNull();
    expect(result.preview!.summary).toMatchObject({ total: 2, willAdd: 2 });
    expect(result.created).toEqual([]);
    expect(await storedSlugs()).toEqual([]);
  });

  it('gives the same answer twice, because it writes nothing', async () => {
    const csvText = webCsv(',https://a.example/one,,,');
    const first = await previewSourceImportForOrg({ orgId: ORG, kind: 'web', csvText });
    const second = await previewSourceImportForOrg({ orgId: ORG, kind: 'web', csvText });

    expect(second.preview).toEqual(first.preview);
    expect(await storedSlugs()).toEqual([]);
  });

  it('refuses a connector that does not accept an import', async () => {
    const result = await previewSourceImportForOrg({ orgId: ORG, kind: 'strapi', csvText: 'a\n1' });

    expect(result.error).toMatch(/cannot be imported from a file/);
    expect(result.preview).toBeNull();
  });

  it('refuses an unknown connector', async () => {
    const result = await previewSourceImportForOrg({ orgId: ORG, kind: 'nope', csvText: 'a\n1' });

    expect(result.error).toMatch(/cannot be imported from a file/);
  });

  it('judges "already configured" against this connector only', async () => {
    // A Slack source whose channel happens to read like the web row's URL must
    // not make the web row look configured.
    await addSource({ orgId: ORG, kind: 'slack', configJson: { channel: 'https://a.example/one' } });

    const result = await previewSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(',https://a.example/one,,,'),
    });

    expect(result.preview!.rows[0]!.verdict).toBe('ok');
  });

  it('judges "already configured" against this org only', async () => {
    await addSource({ orgId: OTHER_ORG, kind: 'web', configJson: { urls: ['https://a.example/one'] } });

    const result = await previewSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(',https://a.example/one,,,'),
    });

    expect(result.preview!.rows[0]!.verdict).toBe('ok');
  });
});

describe('commitSourceImportForOrg', () => {
  it('creates one source per row', async () => {
    const result = await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(
        ',https://docs.example.com/a,,,',
        ',https://docs.example.com/b,,,',
        ',https://docs.example.com/c,,,',
      ),
    });

    expect(result.error).toBeNull();
    expect(result.created).toHaveLength(3);
    expect(await storedSlugs()).toEqual([
      'web-docs-example-com-a',
      'web-docs-example-com-b',
      'web-docs-example-com-c',
    ]);
  });

  it('stores the config the connector validated, connector tag included', async () => {
    await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(',https://a.example/page,false,,'),
    });

    const rows = await db
      .select({ configJson: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema);

    expect(rows[0]!.configJson).toEqual({ _connector: 'web', urls: ['https://a.example/page'] });
  });

  it('creates the good rows and still reports the bad ones', async () => {
    const result = await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(
        ',https://a.example/one,,,',
        ',not-a-url,,,',
        ',https://a.example/two,,,x',
        ',https://a.example/three,,,',
      ),
    });

    expect(result.created).toHaveLength(2);
    expect(result.preview!.summary).toMatchObject({ total: 4, willAdd: 2, malformed: 2 });
    expect(await storedSlugs()).toEqual(['web-a-example-one', 'web-a-example-three']);
  });

  it('creates nothing on a second run of the same file', async () => {
    const csvText = webCsv(',https://a.example/one,,,', ',https://a.example/two,,,');
    await commitSourceImportForOrg({ orgId: ORG, kind: 'web', csvText });

    const second = await commitSourceImportForOrg({ orgId: ORG, kind: 'web', csvText });

    expect(second.created).toEqual([]);
    expect(second.preview!.summary).toMatchObject({ willAdd: 0, alreadyExists: 2 });
    expect(await storedSlugs()).toHaveLength(2);
  });

  it('creates nothing when no row is importable', async () => {
    const result = await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: webCsv(',not-a-url,,,'),
    });

    expect(result.error).toBeNull();
    expect(result.created).toEqual([]);
    expect(result.preview!.summary).toMatchObject({ willAdd: 0, malformed: 1 });
  });

  it('passes a file-level problem straight back', async () => {
    const result = await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'web',
      csvText: 'slug,crawl\nmine,true',
    });

    expect(result.error).toMatch(/missing the "url" column/);
    expect(await storedSlugs()).toEqual([]);
  });

  it('imports sources for a connector that needs a credential the org has not connected', async () => {
    // Creating the row and connecting the account are separate steps in the
    // single-add flow too; an import must not require the credential first.
    const result = await commitSourceImportForOrg({
      orgId: ORG,
      kind: 'jira',
      csvText: ['slug,base_url,project_keys', ',https://acme.atlassian.net,ENG;OPS'].join('\n'),
    });

    expect(result.created).toHaveLength(1);
    expect(await storedSlugs()).toEqual(['jira-acme-atlassian-net']);
  });
});
