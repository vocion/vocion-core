/**
 * The BigQuery warehouse provider against a recorded-shape BigQuery: the dry
 * run is the guard (statement type, tables read, bytes), the run is capped,
 * a slow job is cancelled, values come back JSON-safe, and each workspace
 * spends its own service account.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBigqueryTokenCache } from '@/libs/bigquery/client';
import { inspectBigquery } from '@/libs/sources/bigquery';

const keyFor = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEYS = { 'org-northwind': keyFor(), 'org-kestrel': keyFor() };
const CREDS: Record<string, Record<string, string>> = {
  'org-northwind': { projectId: 'northwind-analytics', clientEmail: 'vocion-reader@northwind-analytics.iam.gserviceaccount.com', privateKey: KEYS['org-northwind'] },
  // Pasted straight out of the JSON key file: literal \n sequences.
  'org-kestrel': { projectId: 'kestrel-capital-dw', clientEmail: 'reader@kestrel-capital-dw.iam.gserviceaccount.com', privateKey: KEYS['org-kestrel'].replace(/\n/g, '\\n') },
};

vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => CREDS[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { bigqueryWarehouseProvider, judgeDryRun } = await import('./bigquery');

function source(config: Record<string, unknown> = {}): FamilySource {
  return { id: 1, slug: 'bigquery', kind: 'bigquery', apiTokenId: null, config: { schemas: ['marts'], ...config } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Call = { url: string; method: string; auth: string | null; body: Record<string, unknown> | null };

/**
 * A BigQuery that answers the token, dry run, query and results calls.
 * @param opts - What the dry run and the query return.
 * @param opts.dryRun - The dry run's query statistics.
 * @param opts.pages - The jobs.query response, then each getQueryResults response.
 */
function bigquery(opts: { dryRun?: Record<string, unknown>; pages?: Array<Record<string, unknown>> } = {}) {
  const calls: Call[] = [];
  const pages = [...(opts.pages ?? [{ jobComplete: true, jobReference: { projectId: 'p', jobId: 'job_0001', location: 'US' }, schema: { fields: [{ name: 'n', type: 'INTEGER' }] }, rows: [{ f: [{ v: '1' }] }], totalRows: '1' }])];
  const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null, body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(String(init?.body)).get('assertion')!;
      const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()) as { iss: string; scope: string };
      return json({ access_token: `tok:${claims.iss}:${claims.scope.split('/').pop()}`, expires_in: 3600 });
    }
    if (url.endsWith('/jobs') && init?.method === 'POST') {
      return json({ statistics: { query: { statementType: 'SELECT', referencedTables: [{ projectId: 'northwind-analytics', datasetId: 'marts', tableId: 'orders' }], totalBytesProcessed: '1048576', ...opts.dryRun } } });
    }
    if (url.includes('/cancel')) {
      return json({ job: {} });
    }
    return json(pages.length > 1 ? pages.shift() : pages[0]);
  });
  return { calls, doFetch: doFetch as unknown as typeof fetch };
}

beforeEach(() => {
  resetBigqueryTokenCache();
});

describe('BigQuery provider', () => {
  it('spends each workspace\'s own service account, read-only scope for the run', async () => {
    for (const orgId of ['org-northwind', 'org-kestrel']) {
      const bq = bigquery({ dryRun: { referencedTables: [{ projectId: CREDS[orgId]!.projectId, datasetId: 'marts', tableId: 'orders' }] } });
      const provider = await bigqueryWarehouseProvider(orgId, source(), { fetch: bq.doFetch });
      await provider.query('SELECT COUNT(*) FROM marts.orders', { maxRows: 10 });
      const email = CREDS[orgId]!.clientEmail;
      const project = CREDS[orgId]!.projectId;
      const dry = bq.calls.find(c => c.url.endsWith('/jobs'))!;
      const run = bq.calls.find(c => c.url.endsWith('/queries'))!;

      expect(dry.url).toContain(`/projects/${project}/jobs`);
      expect(dry.auth).toBe(`Bearer tok:${email}:bigquery`);
      expect(run.url).toContain(`/projects/${project}/queries`);
      expect(run.auth).toBe(`Bearer tok:${email}:bigquery.readonly`);
      expect(run.body).toMatchObject({ useLegacySql: false, maximumBytesBilled: String(10 * 1_000_000_000), maxResults: 11 });
    }
  });

  it('refuses a statement BigQuery reads as anything but a SELECT, before running it', async () => {
    const bq = bigquery({ dryRun: { statementType: 'DELETE' } });
    const provider = await bigqueryWarehouseProvider('org-northwind', source(), { fetch: bq.doFetch });

    await expect(provider.query('DELETE FROM marts.orders WHERE true', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/a DELETE statement/) });
    expect(bq.calls.some(c => c.url.endsWith('/queries'))).toBe(false);
  });

  it('refuses a query that reads outside the allowed datasets, before running it', async () => {
    const bq = bigquery({ dryRun: { referencedTables: [{ projectId: 'northwind-analytics', datasetId: 'hr', tableId: 'salaries' }] } });
    const provider = await bigqueryWarehouseProvider('org-northwind', source(), { fetch: bq.doFetch });

    await expect(provider.query('SELECT * FROM hr.salaries', { maxRows: 10 })).rejects.toThrow(/northwind-analytics\.hr\.salaries, outside the schemas/);
    expect(bq.calls.some(c => c.url.endsWith('/queries'))).toBe(false);
  });

  it('refuses a query that would bill past the source cap', async () => {
    const bq = bigquery({ dryRun: { totalBytesProcessed: String(25 * 1_000_000_000) } });
    const provider = await bigqueryWarehouseProvider('org-northwind', source({ maxGbBilled: 10 }), { fetch: bq.doFetch });

    await expect(provider.query('SELECT * FROM marts.orders', { maxRows: 10 })).rejects.toThrow(/25\.00 GB, over this source's cap of 10 GB/);
  });

  it('fails closed when the dry run cannot account for what is read', () => {
    const allowed = ['northwind-analytics.marts'];

    expect(() => judgeDryRun({ statementType: 'SELECT', referencedTables: Array.from({ length: 50 }, (_, i) => ({ projectId: 'northwind-analytics', datasetId: 'marts', tableId: `t${i}` })), totalBytesProcessed: 1, allowed, maxBytes: 1e12 })).toThrow(/50 or more tables/);
    expect(() => judgeDryRun({ statementType: 'SELECT', referencedTables: null, totalBytesProcessed: 10, allowed, maxBytes: 1e12 })).toThrow(/names no table/);
    expect(() => judgeDryRun({ statementType: 'SELECT', referencedTables: null, totalBytesProcessed: 0, allowed, maxBytes: 1e12 })).not.toThrow();
    expect(() => judgeDryRun({ statementType: 'SCRIPT', referencedTables: [], totalBytesProcessed: 0, allowed, maxBytes: 1e12 })).toThrow(/a SCRIPT statement/);
  });

  it('cuts rows at the cap and converts every type to JSON-safe values', async () => {
    const fields = [
      { name: 'id', type: 'INTEGER' },
      { name: 'big', type: 'INT64' },
      { name: 'amount', type: 'NUMERIC' },
      { name: 'exact', type: 'BIGNUMERIC' },
      { name: 'paid', type: 'BOOLEAN' },
      { name: 'at', type: 'TIMESTAMP' },
      { name: 'account', type: 'RECORD', fields: [{ name: 'name', type: 'STRING' }, { name: 'tier', type: 'INTEGER' }] },
      { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    ];
    const row = (i: number) => ({ f: [{ v: String(i) }, { v: '9007199254740993' }, { v: '1234.50' }, { v: '12345678901234567.89' }, { v: 'true' }, { v: '1790000000000000' }, { v: { f: [{ v: 'Contoso Supply' }, { v: '2' }] } }, { v: [{ v: 'emea' }, { v: 'renewal' }] }] });
    const bq = bigquery({ pages: [{ jobComplete: true, jobReference: { projectId: 'northwind-analytics', jobId: 'job_0002' }, schema: { fields }, rows: [1, 2, 3, 4].map(row), totalRows: '40', totalBytesBilled: '10485760' }] });
    const provider = await bigqueryWarehouseProvider('org-northwind', source(), { fetch: bq.doFetch });
    const result = await provider.query('SELECT * FROM marts.orders', { maxRows: 3 });

    expect(result.truncated).toBe('rows');
    expect(result.rows).toHaveLength(3);
    expect(result.totalRows).toBe(40);
    expect(result.bytesScanned).toBe(10485760);
    expect(result.queryId).toBe('job_0002');
    expect(result.rows[0]).toEqual([1, '9007199254740993', 1234.5, '12345678901234567.89', true, new Date(1_790_000_000_000).toISOString(), { name: 'Contoso Supply', tier: 2 }, ['emea', 'renewal']]);
    expect(result.columns.at(-1)).toEqual({ name: 'tags', type: 'ARRAY<STRING>' });
  });

  it('cuts rows at the byte cap', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ f: [{ v: `${'x'.repeat(1000)}${i}` }] }));
    const bq = bigquery({ pages: [{ jobComplete: true, jobReference: { projectId: 'p', jobId: 'job_0003' }, schema: { fields: [{ name: 'blob', type: 'STRING' }] }, rows }] });
    const provider = await bigqueryWarehouseProvider('org-northwind', source({ maxResultKb: 16 }), { fetch: bq.doFetch });
    const result = await provider.query('SELECT blob FROM marts.orders', { maxRows: 100 });

    expect(result.truncated).toBe('bytes');
    expect(result.rows.length).toBeLessThan(17);
  });

  it('cancels a job still running at the source\'s time limit', async () => {
    let clock = 0;
    const pending = { jobComplete: false, jobReference: { projectId: 'northwind-analytics', jobId: 'job_0004', location: 'US' } };
    const bq = bigquery({ pages: [pending] });
    const now = () => {
      clock += 20_000;
      return clock;
    };
    const provider = await bigqueryWarehouseProvider('org-northwind', source({ timeoutSeconds: 30 }), { fetch: bq.doFetch, now });

    await expect(provider.query('SELECT * FROM marts.orders', { maxRows: 10 })).rejects.toThrow(/30-second limit and was cancelled/);
    expect(bq.calls.some(c => c.url.includes('/jobs/job_0004/cancel'))).toBe(true);
  });

  it('says which credential is missing rather than calling out', async () => {
    await expect(bigqueryWarehouseProvider('org-nobody', source())).rejects.toThrow(/no BigQuery credential stored/);
  });
});

describe('BigQuery Test connection', () => {
  it('dry-runs SELECT 1 and checks each allowed dataset', async () => {
    const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return json({ access_token: 'tok', expires_in: 3600 });
      }
      if (url.endsWith('/jobs') && init?.method === 'POST') {
        return json({ statistics: { query: { statementType: 'SELECT', totalBytesProcessed: '0' } } });
      }
      if (url.endsWith('/datasets/marts')) {
        return json({ location: 'US' });
      }
      return json({ error: { message: 'Not found: Dataset northwind-analytics:finance', errors: [{ reason: 'notFound' }] } }, 404);
    });
    const result = await inspectBigquery({ config: { schemas: ['marts', 'finance'] }, credentials: CREDS['org-northwind']! }, doFetch as unknown as typeof fetch);

    expect(result.authorized).toBe(true);
    expect(result.checks.map(c => [c.key, c.ok])).toEqual([['auth', true], ['dataset:northwind-analytics.marts', true], ['dataset:northwind-analytics.finance', false]]);
    expect(result.error).toMatch(/Data Viewer/);
  });

  it('refuses a credential missing its key, naming what to paste', async () => {
    await expect(inspectBigquery({ config: { schemas: ['marts'] }, credentials: { projectId: 'northwind-analytics', clientEmail: 'x@northwind-analytics.iam.gserviceaccount.com' } })).rejects.toThrow(/missing its private key/);
  });
});
