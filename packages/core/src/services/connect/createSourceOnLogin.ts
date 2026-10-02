/**
 * Save a source from what the person picked, on the login they already made
 * (#1028). The chat action `source.connect` and the Connectors page form both
 * call this, so the admin check, the config check and the credential link are
 * one rule, not two copies.
 *
 * Nothing here talks to the vendor. The first sync is the schedule's job.
 */

import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { apiTokenSchema, knowledgeSourceSchema } from '@/models/Schema';
import { linkSourceToStoredCredential } from '@/services/SourceCredentialService';
import { addSource } from '@/services/SourceSyncService';
import { memberWorkspace } from '@/services/WorkspaceAccessService';
import { sourceIsOfConnector } from './connectorSources';

export type CreateSourceInput = {
  orgId: string;
  /** The person whose decision this is: the one who approved. */
  actorUserId: string | undefined;
  connector: string;
  config: Record<string, unknown>;
};

export type CreateSourceOutcome
  = | { ok: true; sourceId: number; slug: string; created: boolean; before?: Record<string, unknown> }
    | { ok: false; reason: string };

type StoredCredential = { id: string; obtainedVia: 'paste' | 'login' };

/**
 * The name a person knows the connector by.
 * @param connector - Connector slug.
 */
export function connectorLabel(connector: string): string {
  return getConnector(connector)?.name ?? connector;
}

/**
 * Check the config against the connector's own schema and say which field is
 * wrong, in plain words.
 * @param connector - Connector slug.
 * @param config - What the person picked.
 * @returns A refusal sentence, or null when the config is fine.
 */
export function configProblem(connector: string, config: Record<string, unknown>): string | null {
  const known = getConnector(connector);
  if (!known) {
    return `${connector} isn't a connector this workspace can add`;
  }
  const parsed = known.configSchema.safeParse(config);
  if (parsed.success) {
    return null;
  }
  const issue = parsed.error.issues[0];
  const field = issue?.path.join('.') || 'config';
  return `${known.name ?? connector}: ${field}: ${issue?.message ?? 'is not valid'}`;
}

/**
 * The newest live credential of the platform: a login first, otherwise a
 * pasted key. Revoked and expired rows never count.
 * @param orgId - The workspace.
 * @param platformId - The credential platform, e.g. `github`.
 */
async function newestLiveCredential(orgId: string, platformId: string): Promise<StoredCredential | null> {
  const rows = await db
    .select({ id: apiTokenSchema.id, obtainedVia: apiTokenSchema.obtainedVia })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.platform, platformId),
      isNull(apiTokenSchema.revokedAt),
      or(isNull(apiTokenSchema.expiresAt), gt(apiTokenSchema.expiresAt, new Date())),
    ))
    .orderBy(desc(apiTokenSchema.createdAt));
  return rows.find(row => row.obtainedVia === 'login') ?? rows[0] ?? null;
}

/**
 * Why this pick cannot be saved yet, before anything is written.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 * @param config - What the person picked.
 * @returns A refusal sentence, or null when it can go ahead.
 */
export async function connectPrecheck(orgId: string, connector: string, config: Record<string, unknown>): Promise<string | null> {
  const known = getConnector(connector);
  if (!known) {
    return `${connector} isn't a connector this workspace can add`;
  }
  const platform = platformForConnectorSlug(connector);
  if (!platform) {
    return `${connectorLabel(connector)} doesn't connect with a login`;
  }
  if (!(await newestLiveCredential(orgId, platform.id))) {
    return `Log in to ${connectorLabel(connector)} first`;
  }
  return configProblem(connector, config);
}

/**
 * Whether the person is an admin of the workspace's account. A lookup that
 * fails is a "no" with a sentence, never a raw throw.
 * @param orgId - The workspace.
 * @param userId - The person, when there is one.
 */
async function adminCheck(orgId: string, userId: string | undefined): Promise<string | null> {
  const refusal = 'Only a workspace admin can connect a source';
  if (!userId) {
    return refusal;
  }
  try {
    const membership = await memberWorkspace(userId, orgId);
    return membership?.accountRole === 'admin' ? null : refusal;
  } catch {
    return 'Could not check who approved this, so nothing was connected. Try again.';
  }
}

/**
 * The slug the pick lands on. Re-running the same pick must find the same
 * row, so it is never the timestamped slug `addSource` falls back to: an
 * existing source of the connector on the same site (or the oldest one, when
 * the config names no site) is reused, otherwise the slug comes from the site
 * host, otherwise it is the connector's own.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 * @param config - What the person picked.
 */
async function targetSlug(orgId: string, connector: string, config: Record<string, unknown>): Promise<string> {
  const site = typeof config.baseUrl === 'string' ? safeHost(config.baseUrl) : null;
  const existing = await db
    .select({ slug: knowledgeSourceSchema.slug, configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), sourceIsOfConnector(connector)))
    .orderBy(asc(knowledgeSourceSchema.id));
  const match = site
    ? existing.find(row => typeof row.configJson?.baseUrl === 'string' && safeHost(row.configJson.baseUrl) === site)
    : existing[0];
  if (match) {
    return match.slug;
  }
  return site ? `${connector}-${site.replace(/\W+/g, '-')}`.slice(0, 60) : connector;
}

/**
 * The hostname of a URL, or null when it does not parse.
 * @param url - A site address.
 */
function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Point the source at the credential: a login row is shared by nature, so it
 * links non-exclusive the way `completeLogin` does; a pasted key goes through
 * the stored-credential rules.
 * @param input - What to link.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The source.
 * @param input.connector - Connector slug.
 * @param input.credential - The row to link.
 */
async function linkCredential(input: { orgId: string; sourceId: number; connector: string; credential: StoredCredential }): Promise<void> {
  if (input.credential.obtainedVia === 'login') {
    await db
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: input.credential.id, apiTokenExclusive: false })
      .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.id, input.sourceId)));
    return;
  }
  await linkSourceToStoredCredential({ orgId: input.orgId, sourceId: input.sourceId, connectorSlug: input.connector, apiTokenId: input.credential.id });
}

/**
 * Put the source back as it was when linking failed after the write.
 * @param orgId - The workspace.
 * @param sourceId - The source.
 * @param before - The old config, or undefined when the source was new.
 */
async function rollBackWrite(orgId: string, sourceId: number, before: Record<string, unknown> | undefined): Promise<void> {
  const where = and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId));
  if (before) {
    await db.update(knowledgeSourceSchema).set({ configJson: before }).where(where);
    return;
  }
  await db.delete(knowledgeSourceSchema).where(where);
}

/**
 * Save the source from the person's pick and link it to their login.
 *
 * A second run of the same pick updates the existing source's config and
 * returns `created: false` with the old config in `before`, so Undo can put it
 * back.
 * @param input - Who, which connector, and what they picked.
 */
export async function createSourceOnLogin(input: CreateSourceInput): Promise<CreateSourceOutcome> {
  const notAdmin = await adminCheck(input.orgId, input.actorUserId);
  if (notAdmin) {
    return { ok: false, reason: notAdmin };
  }
  const refusal = await connectPrecheck(input.orgId, input.connector, input.config);
  if (refusal) {
    return { ok: false, reason: refusal };
  }
  const platform = platformForConnectorSlug(input.connector)!;
  const credential = (await newestLiveCredential(input.orgId, platform.id))!;
  const slug = await targetSlug(input.orgId, input.connector, input.config);
  const [existing] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.slug, slug)))
    .limit(1);
  const before = existing ? { ...existing.configJson } : undefined;
  const saved = await addSource({ orgId: input.orgId, kind: input.connector, slug, configJson: input.config });
  if (before) {
    await db
      .update(knowledgeSourceSchema)
      .set({ configJson: { ...input.config, _connector: input.connector } })
      .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.id, saved.id)));
  }
  try {
    await linkCredential({ orgId: input.orgId, sourceId: saved.id, connector: input.connector, credential });
  } catch (error) {
    await rollBackWrite(input.orgId, saved.id, before);
    return { ok: false, reason: error instanceof Error ? error.message : 'The credential could not be linked.' };
  }
  return { ok: true, sourceId: saved.id, slug: saved.slug, created: !before, ...(before ? { before } : {}) };
}

/**
 * Take back what `createSourceOnLogin` did. A fresh source that never synced
 * is deleted; an updated one gets its old config back; one that has synced
 * since is left for the Connectors page, because its documents exist now.
 * @param orgId - The workspace.
 * @param result - What the save returned.
 * @param result.sourceId - The source it saved.
 * @param result.created - Whether it was new.
 * @param result.before - The old config, when it was an update.
 * @returns A refusal sentence, or null when it was undone.
 */
export async function undoCreatedSource(orgId: string, result: { sourceId: number; created: boolean; before?: Record<string, unknown> }): Promise<string | null> {
  const where = and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, result.sourceId));
  if (!result.created) {
    await db.update(knowledgeSourceSchema).set({ configJson: result.before ?? {} }).where(where);
    return null;
  }
  const [row] = await db.select({ lastSyncedAt: knowledgeSourceSchema.lastSyncedAt }).from(knowledgeSourceSchema).where(where).limit(1);
  if (!row) {
    return null;
  }
  if (row.lastSyncedAt) {
    return 'It has synced since; remove it from Connectors instead';
  }
  await db.delete(knowledgeSourceSchema).where(where);
  return null;
}
