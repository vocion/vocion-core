/**
 * Amazon Redshift connector — the capability carrier for the warehouse tools
 * on Redshift, and nothing else.
 *
 * Queried LIVE (`warehouse_query`, `warehouse_schema`) through the Redshift
 * Data API, never mirrored; see `snowflake.ts` for why. Auth: an AWS access
 * key pair, a role Vocion assumes, or both (`redshift` platform). Serverless
 * (a workgroup) and provisioned (a cluster) are both reached; which one is
 * the source's to say.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { RedshiftDataFactory, StsFactory } from '@/libs/redshift/client';
import type { IngestDoc } from '@/services/IngestionService';
import { ListSchemasCommand } from '@aws-sdk/client-redshift-data';
import { z } from 'zod';
import { awsCredentialsFor, connectionParams, defaultRedshiftData, externalIdFor, redshiftCredentialsFrom, redshiftTargetFrom } from '@/libs/redshift/client';
import { warehouseConfigShape } from '@/libs/warehouse/config';
import { qualifySchemas, schemaAllowed } from '@/libs/warehouse/guard';
import { InspectInputError } from './inspect';

export const redshiftConfigSchema = z.object({
  /** The AWS region the workgroup or cluster is in, e.g. us-east-1. */
  region: z.string().min(1),
  /** The database to connect to. */
  database: z.string().min(1),
  /** A Redshift Serverless workgroup. Give this or a cluster. */
  workgroupName: z.string().min(1).optional(),
  /** A provisioned cluster. Give this or a workgroup. */
  clusterIdentifier: z.string().min(1).optional(),
  /** On a provisioned cluster, the database user to sign in as with temporary credentials. Blank: the IAM identity's own. */
  dbUser: z.string().min(1).optional(),
  /** A Secrets Manager secret holding a database user and password, in place of temporary credentials. */
  secretArn: z.string().min(1).optional(),
  ...warehouseConfigShape,
});

/**
 * Test connection: the credential signs (assuming the role when one is
 * named), the Data API reaches the database and lists its schemas, and each
 * allowed schema is among them. Read-only. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted, and the workspace re-testing it.
 * @param input.config - The source config.
 * @param input.credentials - The credential values.
 * @param input.orgId - The workspace, for the external id a role assumption carries.
 * @param deps - The AWS clients, injected in tests.
 * @param deps.data - The Data API client factory.
 * @param deps.sts - The STS client factory.
 */
export async function inspectRedshift(input: { config: Record<string, unknown>; credentials: Record<string, unknown>; orgId?: string }, deps: { data?: RedshiftDataFactory; sts?: StsFactory } = {}): Promise<ConnectorInspection> {
  const parsed = redshiftCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const config = redshiftConfigSchema.safeParse(input.config);
  if (!config.success) {
    throw new InspectInputError('Give the region, the database and at least one allowed schema before testing.');
  }
  const target = redshiftTargetFrom(config.data);
  if (!target.ok) {
    throw new InspectInputError(target.message);
  }
  const roleOnly = Boolean(parsed.credentials.roleArn && !parsed.credentials.accessKeyId);
  if (roleOnly && !input.orgId) {
    throw new InspectInputError(`Save the source first, then test it: a role Vocion assumes is assumed with this workspace's external ID, which only a saved source carries.`);
  }
  const checks: ConnectorCheck[] = [];
  let credentials;
  try {
    credentials = await awsCredentialsFor(parsed.credentials, { orgId: input.orgId ?? '', region: target.target.region }, deps.sts);
    if (parsed.credentials.roleArn) {
      checks.push({ key: 'role', label: `Assumes ${parsed.credentials.roleArn}`, ok: true, detail: roleOnly ? `With external ID ${externalIdFor(input.orgId!)}.` : 'With the stored key pair.' });
    }
  } catch (err) {
    checks.push({ key: 'role', label: `Assumes ${parsed.credentials.roleArn}`, ok: false, detail: (err as Error).message });
    return { reachable: true, authorized: false, checks, note: null, error: (err as Error).message };
  }
  const client = (deps.data ?? defaultRedshiftData)({ region: target.target.region, credentials });
  const where = target.target.workgroupName ? `workgroup ${target.target.workgroupName}` : `cluster ${target.target.clusterIdentifier}`;
  let found: string[] = [];
  try {
    let token: string | undefined;
    do {
      const page = await client.send(new ListSchemasCommand({ ...connectionParams(target.target), MaxResults: 1000, ...(token ? { NextToken: token } : {}) }));
      found = [...found, ...(page.Schemas ?? [])];
      token = page.NextToken;
    } while (token && found.length < 5000);
    checks.push({ key: 'database', label: `Reaches database ${target.target.database} on ${where}`, ok: true, detail: `${found.length} schemas visible.` });
  } catch (err) {
    const message = (err as Error).message;
    checks.push({ key: 'database', label: `Reaches database ${target.target.database} on ${where}`, ok: false, detail: message });
    return { reachable: true, authorized: false, checks, note: null, error: message };
  }
  for (const schema of qualifySchemas(config.data.schemas, null)) {
    const ok = found.some(name => schemaAllowed(name, [schema]));
    checks.push({ key: `schema:${schema}`, label: `Sees schema ${schema}`, ok, detail: ok ? null : 'Not among the schemas this database user sees. Grant it USAGE on the schema and SELECT on its tables.' });
  }
  const failed = checks.filter(c => !c.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: `Queries run in a READ ONLY transaction, after Redshift's own plan shows they read only the allowed schemas.${input.orgId ? ` A role Vocion assumes without a key pair must trust external ID ${externalIdFor(input.orgId)}.` : ''}`,
    error: failed.length > 0 ? failed.map(c => c.detail).filter(Boolean).join(' ') : null,
  };
}

export const redshiftConnector: SourceConnector<typeof redshiftConfigSchema> = {
  slug: 'redshift',
  name: 'Amazon Redshift',
  description: 'Your Redshift warehouse (serverless or provisioned), queried live through the Data API in a read-only transaction: one SELECT at a time over the schemas you allow, with row, size and time limits. Nothing is copied into Vocion.',
  icon: 'Database',
  brand: 'amazonredshift',
  authKind: 'apikey',
  syncless: true,
  configSchema: redshiftConfigSchema,
  inspectNote: 'Signs with the credential (assuming the role when one is named) and lists the database\'s schemas through the Data API. Read-only. Nothing is saved.',

  async inspect({ config, credentials, savedSource }) {
    return inspectRedshift({ config, credentials, orgId: savedSource?.orgId });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the warehouse tools, never mirrored.
  },
};
