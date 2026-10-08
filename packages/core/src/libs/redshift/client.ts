/**
 * Amazon Redshift through the Data API — the calls the warehouse provider and
 * Test connection make.
 *
 * Signing: the `redshift` credential holds an IAM access key pair (the shape
 * the `aws` platform holds), a role ARN to assume, or both.
 *
 *   - Pair alone: the pair signs every call.
 *   - Role (with or without a pair): STS `AssumeRole` mints a 15-minute
 *     session that signs the calls. With a pair, the pair assumes it. With no
 *     pair, this server's own AWS identity assumes it — and then ALWAYS with
 *     the external id `vocion-<workspace id>`, so a workspace can only assume
 *     a role whose trust policy names that workspace. Without it, any
 *     workspace on this server could paste another customer's role ARN and
 *     read their warehouse (the confused deputy).
 *
 * Nothing here is cached: a client and its credentials are built per
 * provider, which is built per tool call.
 */

import type { Field, RedshiftDataClient as RedshiftDataClientType } from '@aws-sdk/client-redshift-data';
import { Buffer } from 'node:buffer';
import {
  CancelStatementCommand,
  DescribeStatementCommand,
  ExecuteStatementCommand,
  GetStatementResultCommand,
  RedshiftDataClient,
} from '@aws-sdk/client-redshift-data';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

/** AWS signing credentials, as the SDK clients take them. */
export type AwsCredentialIdentity = { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date };

export type RedshiftCredentials = { accessKeyId?: string; secretAccessKey?: string; roleArn?: string };

/**
 * The credential bag as Redshift signing material, or what is wrong with it.
 * @param bag - The decrypted credential values.
 */
export function redshiftCredentialsFrom(bag: Record<string, unknown> | null | undefined): { ok: true; credentials: RedshiftCredentials } | { ok: false; message: string } {
  const read = (key: string) => (typeof bag?.[key] === 'string' && (bag[key] as string).trim() ? (bag[key] as string).trim() : undefined);
  const accessKeyId = read('accessKeyId');
  const secretAccessKey = read('secretAccessKey');
  const roleArn = read('roleArn');
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    return { ok: false, message: 'The Redshift credential has half an access key pair. Enter both the access key ID and its secret access key, or neither and a role ARN.' };
  }
  if (!accessKeyId && !roleArn) {
    return { ok: false, message: 'The Redshift credential has neither an access key pair nor a role ARN. Enter an IAM access key pair, or the ARN of a role Vocion assumes.' };
  }
  return { ok: true, credentials: { ...(accessKeyId ? { accessKeyId, secretAccessKey } : {}), ...(roleArn ? { roleArn } : {}) } };
}

/**
 * The external id this workspace's role assumption carries when the server's
 * own identity assumes it. A customer's trust policy names it.
 * @param orgId - The workspace.
 */
export function externalIdFor(orgId: string): string {
  return `vocion-${orgId}`;
}

/** Where a source's statements run. */
export type RedshiftTarget = {
  region: string;
  database: string;
  workgroupName?: string;
  clusterIdentifier?: string;
  dbUser?: string;
  secretArn?: string;
};

/**
 * The target from a source's settings, or the sentence for what is missing.
 * @param config - The parsed source config.
 */
export function redshiftTargetFrom(config: RedshiftTarget): { ok: true; target: RedshiftTarget } | { ok: false; message: string } {
  if (!config.workgroupName && !config.clusterIdentifier) {
    return { ok: false, message: 'The Redshift source names neither a serverless workgroup nor a provisioned cluster. Give one of them on the source.' };
  }
  if (config.workgroupName && config.clusterIdentifier) {
    return { ok: false, message: 'The Redshift source names both a workgroup and a cluster. Keep the one the database is on.' };
  }
  if (config.workgroupName && config.dbUser) {
    return { ok: false, message: 'A database user applies to a provisioned cluster only; on Redshift Serverless the user comes from the IAM identity. Clear it, or use a Secrets Manager secret.' };
  }
  return { ok: true, target: config };
}

/**
 * The parameters every Data API call that opens a connection carries.
 * @param target - Where the statements run.
 */
export function connectionParams(target: RedshiftTarget): { Database: string; WorkgroupName?: string; ClusterIdentifier?: string; DbUser?: string; SecretArn?: string } {
  return {
    Database: target.database,
    ...(target.workgroupName ? { WorkgroupName: target.workgroupName } : {}),
    ...(target.clusterIdentifier ? { ClusterIdentifier: target.clusterIdentifier } : {}),
    ...(target.dbUser && !target.secretArn ? { DbUser: target.dbUser } : {}),
    ...(target.secretArn ? { SecretArn: target.secretArn } : {}),
  };
}

/** Builds an STS client; a seam for tests. */
export type StsFactory = (config: { region: string; credentials?: AwsCredentialIdentity }) => { send: (command: AssumeRoleCommand) => Promise<{ Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string; Expiration?: Date } }> };

const defaultSts: StsFactory = config => new STSClient(config);

/**
 * The AWS credentials the Data API calls sign with. Throws a sentence a
 * person acts on when STS refuses the role.
 * @param creds - The stored credential.
 * @param input - Where and for whom.
 * @param input.orgId - The workspace, for the external id.
 * @param input.region - The region STS is called in.
 * @param sts - The STS client factory.
 */
export async function awsCredentialsFor(creds: RedshiftCredentials, input: { orgId: string; region: string }, sts: StsFactory = defaultSts): Promise<AwsCredentialIdentity> {
  const pair = creds.accessKeyId && creds.secretAccessKey ? { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey } : undefined;
  if (!creds.roleArn) {
    return pair!;
  }
  const client = sts({ region: input.region, ...(pair ? { credentials: pair } : {}) });
  try {
    const out = await client.send(new AssumeRoleCommand({
      RoleArn: creds.roleArn,
      RoleSessionName: 'vocion-redshift',
      DurationSeconds: 900,
      // Only the server's own identity needs the confused-deputy guard: a
      // workspace's own key pair can only assume what its account trusts.
      ...(pair ? {} : { ExternalId: externalIdFor(input.orgId) }),
    }));
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey) {
      throw new Error('STS returned no credentials');
    }
    return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
  } catch (err) {
    const why = (err as Error).message;
    throw new Error(pair
      ? `AWS would not let the stored key assume ${creds.roleArn} (${why}). Check the role trusts that key's account and allows sts:AssumeRole.`
      : `Vocion could not assume ${creds.roleArn} (${why}). Its trust policy must allow this server's AWS identity with the external ID ${externalIdFor(input.orgId)}.`);
  }
}

/** The slice of the Data API client the provider uses; a seam for tests. */
export type RedshiftDataLike = Pick<RedshiftDataClientType, 'send'>;
export type RedshiftDataFactory = (config: { region: string; credentials: AwsCredentialIdentity }) => RedshiftDataLike;

export const defaultRedshiftData: RedshiftDataFactory = config => new RedshiftDataClient(config);

/**
 * A cell as JSON can carry it. DECIMAL arrives as a string and stays one, so no digit is lost.
 * @param field - One Data API cell.
 */
export function fieldValue(field: Field | undefined): unknown {
  if (!field || field.isNull) {
    return null;
  }
  if (field.longValue !== undefined) {
    return field.longValue;
  }
  if (field.doubleValue !== undefined) {
    return field.doubleValue;
  }
  if (field.booleanValue !== undefined) {
    return field.booleanValue;
  }
  if (field.stringValue !== undefined) {
    return field.stringValue;
  }
  if (field.blobValue !== undefined) {
    return Buffer.from(field.blobValue).toString('base64');
  }
  return null;
}

/** Seams for tests: how long to wait between status checks. */
export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ONE Data API session: a real database connection kept open between calls
 * (`SessionKeepAliveSeconds`, then `SessionId` on every later call), so a
 * `SET`, a `BEGIN READ ONLY` and the statement after it all run on the same
 * connection, in order. The Data API runs one statement at a time per
 * session, which is exactly the sequencing wanted.
 */
export class RedshiftSession {
  private sessionId: string | null = null;

  constructor(
    private readonly client: RedshiftDataLike,
    private readonly target: RedshiftTarget,
    private readonly keepAliveSeconds: number,
    private readonly sleep: Sleep = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Run one statement in the session and wait for it, up to `deadline`.
   * Returns the statement id, and whether it has rows.
   * @param sql - The statement.
   * @param opts - Named parameters, and when to give up (cancelling it).
   * @param opts.parameters - Named parameters (`:name` in the SQL).
   * @param opts.deadline - Epoch ms after which the statement is cancelled.
   */
  async run(sql: string, opts: { parameters?: Array<{ name: string; value: string }>; deadline?: number } = {}): Promise<{ id: string; hasResultSet: boolean }> {
    const out = await this.client.send(new ExecuteStatementCommand({
      Sql: sql,
      ...(this.sessionId ? { SessionId: this.sessionId } : { ...connectionParams(this.target), SessionKeepAliveSeconds: this.keepAliveSeconds }),
      ...(opts.parameters?.length ? { Parameters: opts.parameters } : {}),
    }));
    if (!out.Id) {
      throw new Error('Redshift accepted the statement but returned no id to follow.');
    }
    this.sessionId = out.SessionId ?? this.sessionId;
    const deadline = opts.deadline ?? this.now() + 60_000;
    for (;;) {
      const left = deadline - this.now();
      const status = await this.client.send(new DescribeStatementCommand({ Id: out.Id, WaitTimeSeconds: Math.max(0, Math.min(20, Math.floor(left / 1000))) }));
      this.sessionId = status.SessionId ?? this.sessionId;
      if (status.Status === 'FINISHED') {
        return { id: out.Id, hasResultSet: status.HasResultSet ?? false };
      }
      if (status.Status === 'FAILED' || status.Status === 'ABORTED') {
        throw new RedshiftStatementError(status.Error ?? `Redshift reports the statement ${status.Status.toLowerCase()}.`);
      }
      if (this.now() >= deadline) {
        await this.client.send(new CancelStatementCommand({ Id: out.Id })).catch(() => undefined);
        throw new RedshiftTimeoutError();
      }
      await this.sleep(250);
    }
  }

  /**
   * A finished statement's rows, read page by page until `maxRows` (or the
   * last page). Returns the columns, the rows and the result's full count.
   * @param id - The statement.
   * @param maxRows - Stop paging once this many are read.
   * @param maxBytes - Stop paging once this much JSON is read.
   */
  async rows(id: string, maxRows: number, maxBytes: number): Promise<{ columns: Array<{ name: string; type: string }>; rows: unknown[][]; totalRows: number | null }> {
    const rows: unknown[][] = [];
    let columns: Array<{ name: string; type: string }> = [];
    let totalRows: number | null = null;
    let bytes = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(new GetStatementResultCommand({ Id: id, ...(token ? { NextToken: token } : {}) }));
      if (columns.length === 0) {
        columns = (page.ColumnMetadata ?? []).map(c => ({ name: c.label ?? c.name ?? '', type: c.typeName ?? 'unknown' }));
      }
      totalRows = page.TotalNumRows ?? totalRows;
      for (const record of page.Records ?? []) {
        const row = record.map(fieldValue);
        rows.push(row);
        bytes += JSON.stringify(row).length;
      }
      token = page.NextToken;
    } while (token && rows.length < maxRows && bytes <= maxBytes);
    return { columns, rows, totalRows };
  }

  /** Whether the session has opened yet. */
  get open(): boolean {
    return this.sessionId !== null;
  }
}

/** A statement Redshift refused; the message is Redshift's own. */
export class RedshiftStatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedshiftStatementError';
  }
}

/** A statement cancelled at the source's time limit. */
export class RedshiftTimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'RedshiftTimeoutError';
  }
}

/**
 * A SQL identifier, double-quoted with any quote inside doubled — for the
 * `search_path` the allowlist sets, never for the agent's text.
 * @param name - A schema name.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** One relation an EXPLAIN plan scans: a name, qualified only when Redshift printed it so. */
export type PlannedScan = { schema: string | null; name: string };

/**
 * What a Redshift EXPLAIN plan says the statement does: the relations its
 * scan nodes read, and whether any node writes. This reads the ENGINE's
 * plan, never the agent's SQL: Redshift prints a scan as `Seq Scan on
 * <relation>` (unqualified for a local table), a Spectrum scan as
 * `S3 Seq Scan <schema>.<table>`, and a secured one as `RLS SecureScan` or
 * `LF SecureScan <name>`, and names its write operators Insert, Delete and
 * Update (https://docs.aws.amazon.com/redshift/latest/dg/r_EXPLAIN.html).
 * @param lines - The plan, one row per line.
 */
export function readPlan(lines: readonly string[]): { scans: PlannedScan[]; writes: boolean } {
  const scans: PlannedScan[] = [];
  let writes = false;
  for (const raw of lines) {
    const line = raw.replace(/^[\s>-]*/, '');
    if (/^(?:XN\s+)?(?:Insert|Delete|Update)\b/.test(line)) {
      writes = true;
    }
    const m = /(?:Seq Scan on|S3 (?:Seq |Query )?Scan|SecureScan)\s+("(?:[^"]|"")+"(?:\."(?:[^"]|"")+")?|[^\s(]+)/.exec(line);
    if (!m) {
      continue;
    }
    const printed = m[1]!;
    const parts = printed.startsWith('"')
      ? printed.slice(1, -1).split('"."').map(part => part.replace(/""/g, '"'))
      : [printed.slice(0, Math.max(0, printed.lastIndexOf('.'))), printed.slice(printed.lastIndexOf('.') + 1)].filter(Boolean);
    scans.push(parts.length > 1 ? { schema: parts[0]!, name: parts[parts.length - 1]! } : { schema: null, name: parts[0]! });
  }
  return { scans, writes };
}
