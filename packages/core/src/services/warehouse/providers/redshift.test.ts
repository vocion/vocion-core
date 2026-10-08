/**
 * The Redshift warehouse provider against a scripted Data API: the session
 * sequence (timeout, search_path, EXPLAIN, catalog, BEGIN READ ONLY, the
 * statement, ROLLBACK), the plan-based allowlist, the caps, the cancel at the
 * time limit, and each workspace signing with its own credential.
 */
import type { FamilySource } from '@/libs/connectors/families';
import type { RedshiftDataFactory, StsFactory } from '@/libs/redshift/client';
import { describe, expect, it, vi } from 'vitest';
import { readPlan, redshiftCredentialsFrom, redshiftTargetFrom } from '@/libs/redshift/client';
import { inspectRedshift } from '@/libs/sources/redshift';

const CREDS: Record<string, Record<string, string>> = {
  'org-northwind': { accessKeyId: 'AKIAEXAMPLENORTHWIND', secretAccessKey: 'northwindSecretKeyExample0000000000000000' },
  'org-kestrel': { roleArn: 'arn:aws:iam::123456789012:role/vocion-redshift-read' },
};

vi.mock('@/services/connectors/familyCredentials', () => ({
  familySourceCredentials: async (orgId: string) => CREDS[orgId] ?? null,
  noCredentialMessage: (source: { slug: string }, vendor: string) => `The ${source.slug} source has no ${vendor} credential stored.`,
}));

const { redshiftWarehouseProvider, judgeScans } = await import('./redshift');

function source(config: Record<string, unknown> = {}): FamilySource {
  return { id: 2, slug: 'redshift', kind: 'redshift', apiTokenId: null, config: { region: 'us-east-1', database: 'dev', workgroupName: 'analytics', schemas: ['marts'], ...config } };
}

type Script = {
  plan?: string[] | 'fail';
  catalog?: Array<[string, string]>;
  result?: { columns: Array<{ name: string; typeName: string }>; records: Array<Array<Record<string, unknown>>>; total?: number };
  statementStatus?: 'FINISHED' | 'STARTED';
};

/**
 * A Data API that plays the script: every statement finishes at once unless
 * the agent's statement is told to keep running.
 * @param script - What EXPLAIN, the catalog lookup and the statement return.
 */
function dataApi(script: Script = {}) {
  const executed: Array<Record<string, unknown>> = [];
  const cancelled: string[] = [];
  const configs: Array<{ region: string; credentials: unknown }> = [];
  const sqlById = new Map<string, string>();
  let n = 0;
  const isAgentStatement = (sql: string) => !/^(?:SET |EXPLAIN |BEGIN|ROLLBACK|SELECT table_schema)/.test(sql);
  const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const input = command.input;
    switch (command.constructor.name) {
      case 'ExecuteStatementCommand': {
        executed.push(input);
        const id = `0f0e0d0c-0000-4000-8000-00000000000${n++}`;
        sqlById.set(id, String(input.Sql));
        return { Id: id, ...(input.SessionId ? {} : { SessionId: '5a254dc6-0000-4000-8000-000000000001' }) };
      }
      case 'DescribeStatementCommand': {
        const sql = sqlById.get(String(input.Id))!;
        if (sql.startsWith('EXPLAIN') && script.plan === 'fail') {
          return { Status: 'FAILED', Error: 'ERROR: EXPLAIN is not supported for this statement' };
        }
        if (isAgentStatement(sql) && script.statementStatus === 'STARTED') {
          return { Status: 'STARTED' };
        }
        return { Status: 'FINISHED', HasResultSet: sql.startsWith('EXPLAIN') || sql.startsWith('SELECT') || isAgentStatement(sql) };
      }
      case 'GetStatementResultCommand': {
        const sql = sqlById.get(String(input.Id))!;
        if (sql.startsWith('EXPLAIN')) {
          return { Records: (script.plan === 'fail' ? [] : script.plan ?? ['XN Seq Scan on orders  (cost=0.00..1.00 rows=10 width=8)']).map(line => [{ stringValue: line }]) };
        }
        if (sql.startsWith('SELECT table_schema')) {
          return { Records: (script.catalog ?? [['marts', 'orders']]).map(([schema, table]) => [{ stringValue: schema }, { stringValue: table }]) };
        }
        const result = script.result ?? { columns: [{ name: 'n', typeName: 'int8' }], records: [[{ longValue: 1 }]] };
        return { ColumnMetadata: result.columns, Records: result.records, TotalNumRows: result.total ?? result.records.length };
      }
      case 'CancelStatementCommand':
        cancelled.push(String(input.Id));
        return { Status: true };
      default:
        throw new Error(`unscripted ${command.constructor.name}`);
    }
  });
  const factory: RedshiftDataFactory = (config) => {
    configs.push(config);
    return { send } as never;
  };
  return { factory, executed, cancelled, configs, sqls: () => executed.map(e => String(e.Sql)) };
}

function sts() {
  const calls: Array<{ config: unknown; input: Record<string, unknown> }> = [];
  const factory: StsFactory = config => ({
    send: async (command) => {
      calls.push({ config, input: command.input as unknown as Record<string, unknown> });
      return { Credentials: { AccessKeyId: 'ASIAEXAMPLEASSUMED01', SecretAccessKey: 'assumedSecretExample000000000000000000000', SessionToken: 'session-token-example' } };
    },
  });
  return { factory, calls };
}

describe('Redshift provider', () => {
  it('signs with each workspace\'s own credential: a stored pair, or its role with its own external id', async () => {
    const api = dataApi();
    const roles = sts();
    for (const orgId of ['org-northwind', 'org-kestrel']) {
      const provider = await redshiftWarehouseProvider(orgId, source(), { data: api.factory, sts: roles.factory });
      await provider.query('SELECT count(*) FROM orders', { maxRows: 10 });
    }

    expect(api.configs[0]!.credentials).toEqual({ accessKeyId: 'AKIAEXAMPLENORTHWIND', secretAccessKey: CREDS['org-northwind']!.secretAccessKey });
    expect(roles.calls).toHaveLength(1);
    expect(roles.calls[0]!.input).toMatchObject({ RoleArn: CREDS['org-kestrel']!.roleArn, ExternalId: 'vocion-org-kestrel', DurationSeconds: 900 });
    expect(roles.calls[0]!.config).toEqual({ region: 'us-east-1' });
    expect(api.configs[1]!.credentials).toMatchObject({ accessKeyId: 'ASIAEXAMPLEASSUMED01', sessionToken: 'session-token-example' });
  });

  it('runs the statement on one session, inside a READ ONLY transaction, after the plan is checked', async () => {
    const api = dataApi();
    const provider = await redshiftWarehouseProvider('org-northwind', source({ timeoutSeconds: 30 }), { data: api.factory });
    await provider.query('SELECT count(*) FROM orders;', { maxRows: 10 });

    expect(api.sqls()).toEqual([
      'SET statement_timeout TO 30000',
      'SET search_path TO "marts"',
      'EXPLAIN SELECT count(*) FROM orders',
      'SELECT table_schema, table_name FROM information_schema.tables WHERE table_name IN (:t0)',
      'BEGIN READ ONLY',
      'SELECT count(*) FROM orders',
      'ROLLBACK',
    ]);
    expect(api.executed[0]).toMatchObject({ Database: 'dev', WorkgroupName: 'analytics', SessionKeepAliveSeconds: 90 });
    expect(api.executed.slice(1).every(e => e.SessionId === '5a254dc6-0000-4000-8000-000000000001' && !e.Database)).toBe(true);
    expect(api.executed[3]!.Parameters).toEqual([{ name: 't0', value: 'orders' }]);
  });

  it('refuses what Redshift will not plan as a query, before any transaction opens', async () => {
    const api = dataApi({ plan: 'fail' });
    const provider = await redshiftWarehouseProvider('org-northwind', source(), { data: api.factory });

    await expect(provider.query('DROP TABLE marts.orders', { maxRows: 10 })).rejects.toMatchObject({ name: 'WarehouseRefusal', message: expect.stringMatching(/would not plan this as one query/) });
    expect(api.sqls()).not.toContain('BEGIN READ ONLY');
  });

  it('refuses a plan with a write step', async () => {
    const api = dataApi({ plan: ['XN Delete  (cost=0.00..1.00 rows=10 width=6)', '  ->  XN Seq Scan on orders  (cost=0.00..1.00 rows=10 width=6)'] });
    const provider = await redshiftWarehouseProvider('org-northwind', source(), { data: api.factory });

    await expect(provider.query('DELETE FROM orders', { maxRows: 10 })).rejects.toThrow(/plans this statement as a write/);
    expect(api.sqls()).not.toContain('DELETE FROM orders');
  });

  it('refuses a relation outside the allowed schemas, and an ambiguous one, without running', async () => {
    const outside = dataApi({ plan: ['XN Seq Scan on salaries  (cost=0.00..1.00 rows=10 width=6)'], catalog: [['hr', 'salaries']] });
    const p1 = await redshiftWarehouseProvider('org-northwind', source(), { data: outside.factory });

    await expect(p1.query('SELECT * FROM hr.salaries', { maxRows: 10 })).rejects.toThrow(/reads hr\.salaries, which is in none of the schemas/);
    expect(outside.sqls()).not.toContain('BEGIN READ ONLY');

    const ambiguous = dataApi({ catalog: [['marts', 'orders'], ['public', 'orders']] });
    const p2 = await redshiftWarehouseProvider('org-northwind', source(), { data: ambiguous.factory });

    await expect(p2.query('SELECT * FROM public.orders', { maxRows: 10 })).rejects.toThrow(/orders \(in marts and public\).*narrow the database user's grants/);

    const spectrum = dataApi({ plan: ['XN S3 Query Scan lake.clickstream  (cost=0.00..1.00 rows=10 width=6)'], catalog: [] });
    const p3 = await redshiftWarehouseProvider('org-northwind', source(), { data: spectrum.factory });

    await expect(p3.query('SELECT * FROM lake.clickstream', { maxRows: 10 })).rejects.toThrow(/lake\.clickstream/);
  });

  it('cuts rows at the cap and hands values back JSON-safe', async () => {
    const records = [1, 2, 3, 4].map(i => [{ longValue: i }, { stringValue: '1234.50' }, { booleanValue: true }, { isNull: true }, { doubleValue: 0.25 }]);
    const api = dataApi({ result: { columns: [{ name: 'id', typeName: 'int8' }, { name: 'amount', typeName: 'numeric' }, { name: 'paid', typeName: 'bool' }, { name: 'note', typeName: 'varchar' }, { name: 'share', typeName: 'float8' }], records, total: 4 } });
    const provider = await redshiftWarehouseProvider('org-northwind', source(), { data: api.factory });
    const result = await provider.query('SELECT * FROM orders', { maxRows: 3 });

    expect(result.truncated).toBe('rows');
    expect(result.totalRows).toBe(4);
    expect(result.rows[0]).toEqual([1, '1234.50', true, null, 0.25]);
    expect(result.columns.map(c => c.type)).toEqual(['int8', 'numeric', 'bool', 'varchar', 'float8']);
  });

  it('cancels a statement still running at the source\'s time limit, and rolls back', async () => {
    let clock = 0;
    const api = dataApi({ statementStatus: 'STARTED' });
    const provider = await redshiftWarehouseProvider('org-northwind', source({ timeoutSeconds: 5 }), {
      data: api.factory,
      sleep: async () => {
        clock += 1000;
      },
      now: () => clock,
    });

    await expect(provider.query('SELECT * FROM orders', { maxRows: 10 })).rejects.toThrow(/5-second limit and was cancelled/);
    expect(api.cancelled).toHaveLength(1);
    expect(api.sqls().at(-1)).toBe('ROLLBACK');
  });

  it('says what is missing before calling AWS', async () => {
    await expect(redshiftWarehouseProvider('org-nobody', source())).rejects.toThrow(/no Redshift credential stored/);
    await expect(redshiftWarehouseProvider('org-northwind', source({ workgroupName: undefined }))).rejects.toThrow(/neither a serverless workgroup nor a provisioned cluster/);
  });
});

describe('Redshift helpers', () => {
  it('reads scans and write steps off the engine\'s plan', () => {
    expect(readPlan([
      'XN Hash Join DS_DIST_OUTER  (cost=2.52..58653620.93 rows=8712 width=43)',
      '->  XN Seq Scan on event  (cost=0.00..87.98 rows=8798 width=23)',
      '->  XN Hash  (cost=2.02..2.02 rows=202 width=22)',
      '      ->  XN Seq Scan on "Venue"  (cost=0.00..2.02 rows=202 width=22)',
      'XN LF SecureScan t_share  (cost=0.00..0.02 rows=2 width=11)',
    ])).toEqual({ scans: [{ schema: null, name: 'event' }, { schema: null, name: 'Venue' }, { schema: null, name: 't_share' }], writes: false });
    expect(readPlan(['XN Update  (cost=0.00..1 rows=1 width=1)']).writes).toBe(true);
  });

  it('refuses an RLS scan it cannot resolve to a readable table', () => {
    expect(() => judgeScans({ scans: [{ schema: null, name: 'f' }], readable: new Map(), allowed: ['marts'] })).toThrow(/reads f, which is in none/);
  });

  it('explains a bad credential or target in words a person acts on', () => {
    expect(redshiftCredentialsFrom({ accessKeyId: 'AKIAEXAMPLENORTHWIND' })).toMatchObject({ ok: false, message: expect.stringMatching(/half an access key pair/) });
    expect(redshiftCredentialsFrom({})).toMatchObject({ ok: false, message: expect.stringMatching(/neither an access key pair nor a role ARN/) });
    expect(redshiftTargetFrom({ region: 'us-east-1', database: 'dev', workgroupName: 'a', clusterIdentifier: 'b' })).toMatchObject({ ok: false });
  });
});

describe('Redshift Test connection', () => {
  it('lists schemas through the Data API and checks each allowed one', async () => {
    const send = vi.fn(async () => ({ Schemas: ['marts', 'public'] }));
    const result = await inspectRedshift(
      { config: source({ schemas: ['marts', 'finance'] }).config, credentials: CREDS['org-northwind']! },
      { data: () => ({ send }) as never },
    );

    expect(result.authorized).toBe(true);
    expect(result.checks.map(c => [c.key, c.ok])).toEqual([['database', true], ['schema:marts', true], ['schema:finance', false]]);
  });

  it('names the external id a role Vocion assumes must trust', async () => {
    const roles = sts();
    const result = await inspectRedshift(
      { config: source().config, credentials: CREDS['org-kestrel']!, orgId: 'org-kestrel' },
      { data: () => ({ send: async () => ({ Schemas: ['marts'] }) }) as never, sts: roles.factory },
    );

    expect(result.checks[0]).toMatchObject({ key: 'role', ok: true, detail: 'With external ID vocion-org-kestrel.' });
    await expect(inspectRedshift({ config: source().config, credentials: CREDS['org-kestrel']! })).rejects.toThrow(/Save the source first/);
  });
});
