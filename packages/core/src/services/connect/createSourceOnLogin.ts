/**
 * Save a source from what the person picked, on the login they already made
 * (#1080). The chat action `source.connect` and the Connectors page form both
 * call this, so the admin check, the config check and the credential link are
 * one rule, not two copies.
 *
 * Nothing here talks to the vendor. The first sync is the schedule's job.
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import { and, asc, desc, eq, gt, isNull, like, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { apiTokenSchema, knowledgeSourceSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
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
  /** Which of the connector's sources the pick is for. Required when there are several. */
  sourceSlug?: string;
  /**
   * Always make a new source, never add to one that exists. The Connectors
   * page sets it: "Add another" there means another. Chat leaves it off, and
   * a pick lands on the source it fits.
   */
  createNew?: boolean;
};

export type CreateSourceOutcome
  = | { ok: true; sourceId: number; slug: string; created: boolean; before?: Record<string, unknown> }
    | { ok: false; reason: string };

type StoredCredential = { id: string; obtainedVia: 'paste' | 'login'; account: string | null; createdAt: Date };

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
 * pasted key. Revoked and expired rows never count. `offer_connection` reads
 * it too, to tell "log in" from "already logged in" (#1080).
 * @param orgId - The workspace.
 * @param platformId - The credential platform, e.g. `github`.
 */
export async function newestLiveCredential(orgId: string, platformId: string): Promise<StoredCredential | null> {
  const rows = await db
    .select({ id: apiTokenSchema.id, obtainedVia: apiTokenSchema.obtainedVia, account: apiTokenSchema.account, createdAt: apiTokenSchema.createdAt })
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
 * Whether the connector has a source that can still read: its credential is
 * live (not revoked, not expired). A source on a revoked or expired login is
 * not "connected", so chat can offer the login again. A source with no linked
 * credential counts when the old `source_credential` of its connector is live.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 */
export async function connectorHasLiveSource(orgId: string, connector: string): Promise<boolean> {
  const sources = await db
    .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), sourceIsOfConnector(connector)));
  if (sources.length === 0) {
    return false;
  }
  const [live] = await db
    .select({ id: apiTokenSchema.id })
    .from(knowledgeSourceSchema)
    .innerJoin(apiTokenSchema, eq(apiTokenSchema.id, knowledgeSourceSchema.apiTokenId))
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      sourceIsOfConnector(connector),
      isNull(apiTokenSchema.revokedAt),
      or(isNull(apiTokenSchema.expiresAt), gt(apiTokenSchema.expiresAt, new Date())),
    ))
    .limit(1);
  if (live) {
    return true;
  }
  if (!sources.some(source => source.apiTokenId === null)) {
    return false;
  }
  const [legacy] = await db
    .select({ id: sourceCredentialSchema.id })
    .from(sourceCredentialSchema)
    .innerJoin(sourceInstallSchema, eq(sourceInstallSchema.id, sourceCredentialSchema.installId))
    .where(and(eq(sourceInstallSchema.orgId, orgId), eq(sourceInstallSchema.sourceSlug, connector), isNull(sourceCredentialSchema.revokedAt)))
    .limit(1);
  return Boolean(legacy);
}

/** Where a pick lands: a new source, or an existing one it is added to. */
type Target
  = | { kind: 'create'; slug: string }
    | { kind: 'merge'; slug: string; existing: Record<string, unknown> }
    | { kind: 'refuse'; reason: string };

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
 * The first slug for the connector that no source in the workspace holds:
 * the usual slug, then `-2`, `-3` and so on.
 * @param orgId - The workspace.
 * @param base - The usual slug for this pick.
 */
async function uniqueSlug(orgId: string, base: string): Promise<string> {
  const rows = await db
    .select({ slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), like(knowledgeSourceSchema.slug, `${base}%`)));
  const taken = new Set(rows.map(row => row.slug));
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) {
    slug = `${base.slice(0, 56)}-${suffix}`;
  }
  return slug;
}

/**
 * Decide which source the pick is for, never by guessing. A named source must
 * be one of this connector's in this workspace. Unnamed, the candidates are the
 * connector's sources on the same site (or all of them, when the pick names no
 * site): none means create, one means add to it, several means ask.
 * @param input - The pick.
 */
async function resolveTarget(input: CreateSourceInput): Promise<Target> {
  const label = connectorLabel(input.connector);
  const all = await db
    .select({ slug: knowledgeSourceSchema.slug, configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), sourceIsOfConnector(input.connector)))
    .orderBy(asc(knowledgeSourceSchema.id));
  const site = typeof input.config.baseUrl === 'string' ? safeHost(input.config.baseUrl) : null;
  if (input.createNew) {
    const created = site ? `${input.connector}-${site.replace(/\W+/g, '-')}`.slice(0, 60) : input.connector;
    return { kind: 'create', slug: await uniqueSlug(input.orgId, created) };
  }
  if (input.sourceSlug) {
    const named = all.find(row => row.slug === input.sourceSlug);
    return named
      ? { kind: 'merge', slug: named.slug, existing: { ...named.configJson } }
      : { kind: 'refuse', reason: `${input.sourceSlug} isn't a ${label} source in this workspace` };
  }
  const candidates = site
    ? all.filter(row => typeof row.configJson?.baseUrl === 'string' && safeHost(row.configJson.baseUrl) === site)
    : all;
  if (candidates.length > 1) {
    return { kind: 'refuse', reason: `${label} has ${candidates.length} sources (${candidates.map(row => row.slug).join(', ')}); say which one with sourceSlug` };
  }
  if (candidates[0]) {
    return { kind: 'merge', slug: candidates[0].slug, existing: { ...candidates[0].configJson } };
  }
  return { kind: 'create', slug: site ? `${input.connector}-${site.replace(/\W+/g, '-')}`.slice(0, 60) : input.connector };
}

/**
 * The saved config when a pick is added to a source: every list is the
 * existing items then the new ones, without repeats; every other field comes
 * from the pick; fields the pick does not name stay as they were. A pick never
 * removes anything.
 * @param existing - The source's config today.
 * @param pick - What the person picked.
 */
export function addPickToConfig(existing: Record<string, unknown>, pick: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(pick)) {
    const current = existing[key];
    merged[key] = Array.isArray(value) && Array.isArray(current) ? [...new Set([...current, ...value])] : value;
  }
  return merged;
}

/**
 * Why this pick cannot be saved yet, before anything is written.
 * @param input - Who is asking and what they picked.
 * @param input.orgId - The workspace.
 * @param input.connector - Connector slug.
 * @param input.config - What the person picked.
 * @param input.sourceSlug - The source it is for, when named.
 * @param input.actorUserId - The person asking, when known.
 * @returns A refusal sentence, or null when it can go ahead.
 */
export async function connectPrecheck(input: CreateSourceInput): Promise<string | null> {
  if (!getConnector(input.connector)) {
    return `${input.connector} isn't a connector this workspace can add`;
  }
  const platform = platformForConnectorSlug(input.connector);
  if (!platform) {
    return `${connectorLabel(input.connector)} doesn't connect with a login`;
  }
  if (!(await newestLiveCredential(input.orgId, platform.id))) {
    return `Log in to ${connectorLabel(input.connector)} first`;
  }
  const badConfig = configProblem(input.connector, input.config);
  if (badConfig) {
    return badConfig;
  }
  const target = await resolveTarget(input);
  return target.kind === 'refuse' ? target.reason : null;
}

/**
 * Whether the person is an admin of the workspace's account. A lookup that
 * fails is a "no" with a sentence, never a raw throw.
 * @param orgId - The workspace.
 * @param userId - The person, when there is one.
 */
export async function adminCheck(orgId: string, userId: string | undefined): Promise<string | null> {
  const refusal = 'Only a workspace admin can connect a source';
  if (!userId) {
    return refusal;
  }
  try {
    const membership = await memberWorkspace(userId, orgId);
    return membership?.accountRole === 'admin' ? null : refusal;
  } catch (error) {
    logger.warn('source.connect could not look up who approved', { reason: error instanceof Error ? error.message : 'unknown' });
    return 'Could not check who approved this, so nothing was connected. Try again.';
  }
}

/**
 * Point the source at the credential, inside the save's transaction. A login
 * row is shared by nature, so it links the way `completeLogin` does, with
 * exclusivity from the platform; a pasted key goes through the stored-credential
 * rules.
 * @param tx - The save's transaction.
 * @param input - What to link.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The source.
 * @param input.connector - Connector slug.
 * @param input.credential - The row to link.
 */
async function linkCredential(tx: DbTransaction, input: { orgId: string; sourceId: number; connector: string; credential: StoredCredential }): Promise<void> {
  if (input.credential.obtainedVia === 'login') {
    await tx
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: input.credential.id, apiTokenExclusive: false })
      .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.id, input.sourceId)));
    return;
  }
  await linkSourceToStoredCredential({ orgId: input.orgId, sourceId: input.sourceId, connectorSlug: input.connector, apiTokenId: input.credential.id, tx });
}

/**
 * The writes of one save, in the caller's transaction: the source row (new, or
 * the existing config with the pick added) and its credential link. An
 * existing source keeps the credential it already has.
 * @param tx - The transaction to write in.
 * @param input - The pick.
 * @param target - Where it lands.
 * @param credential - The credential to link.
 */
async function saveWithin(
  tx: DbTransaction,
  input: CreateSourceInput,
  target: Exclude<Target, { kind: 'refuse' }>,
  credential: StoredCredential,
): Promise<{ sourceId: number; slug: string }> {
  let saved: { id: number; slug: string };
  let keptCredentialId: string | null = null;
  if (target.kind === 'create') {
    saved = await addSource({ orgId: input.orgId, kind: input.connector, slug: target.slug, configJson: input.config, tx });
  } else {
    const configJson = { ...addPickToConfig(target.existing, input.config), _connector: input.connector };
    const [row] = await tx
      .update(knowledgeSourceSchema)
      .set({ configJson })
      .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.slug, target.slug)))
      .returning({ id: knowledgeSourceSchema.id, apiTokenId: knowledgeSourceSchema.apiTokenId });
    saved = { id: row!.id, slug: target.slug };
    keptCredentialId = row!.apiTokenId;
  }
  // Adding to a source never re-points it: it stays on the key or login it already reads. Only a new
  // source, or one with no credential at all (it would resolve none), takes the newest live login.
  if (keptCredentialId === null) {
    await linkCredential(tx, { orgId: input.orgId, sourceId: saved.id, connector: input.connector, credential });
  }
  return { sourceId: saved.id, slug: saved.slug };
}

/**
 * Save the source from the person's pick and link it to their login, in one
 * transaction: a link that fails leaves no new source and no changed config.
 *
 * A pick on an existing source is ADDED to its lists and returns `created:
 * false` with the old config in `before`, so Undo can put it back.
 * @param input - Who, which connector, and what they picked.
 */
export async function createSourceOnLogin(input: CreateSourceInput): Promise<CreateSourceOutcome> {
  const notAdmin = await adminCheck(input.orgId, input.actorUserId);
  if (notAdmin) {
    return { ok: false, reason: notAdmin };
  }
  const refusal = await connectPrecheck(input);
  if (refusal) {
    return { ok: false, reason: refusal };
  }
  const platform = platformForConnectorSlug(input.connector)!;
  const credential = (await newestLiveCredential(input.orgId, platform.id))!;
  const target = await resolveTarget(input);
  if (target.kind === 'refuse') {
    return { ok: false, reason: target.reason };
  }
  try {
    const saved = await db.transaction(tx => saveWithin(tx, input, target, credential));
    return target.kind === 'merge'
      ? { ok: true, ...saved, created: false, before: target.existing }
      : { ok: true, ...saved, created: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The source could not be saved.' };
  }
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

/**
 * Whether a finished login makes the connector's source by itself, because
 * nothing more is needed to make one.
 * @param connector - Connector slug.
 */
export function loginMakesItsSource(connector: string): boolean {
  return configProblem(connector, {}) === null;
}

/**
 * After a login: make the connector's source when nothing more is needed to
 * make one (Slack). A connector that needs picks first (GitHub repos, a Jira
 * site and project keys) is left alone: the chat agent asks and saves with
 * `source.connect`, or the Connectors form does. A login that already linked a
 * source never gets a second one.
 * @param input - The finished login.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin who logged in.
 * @param input.connector - The connector the login is for.
 * @param input.linkedSourceIds - The sources the login linked.
 * @returns Whether a source was made, or `failed` with a plain reason when one
 * should have been and could not be (refused or thrown). The login stands.
 */
export async function createSourceWhenNoConfigNeeded(input: { orgId: string; userId: string; connector: string; linkedSourceIds: readonly number[] }): Promise<{ created: boolean; failed?: string }> {
  if (input.linkedSourceIds.length > 0 || !loginMakesItsSource(input.connector)) {
    return { created: false };
  }
  try {
    const saved = await createSourceOnLogin({ orgId: input.orgId, actorUserId: input.userId, connector: input.connector, config: {} });
    if (saved.ok) {
      return { created: saved.created };
    }
    logger.warn('a login finished but its source could not be created', { connector: input.connector, reason: saved.reason });
    return { created: false, failed: saved.reason };
  } catch (error) {
    logger.warn('a login finished but creating its source threw', { connector: input.connector, reason: error instanceof Error ? error.name : 'unknown' });
    return { created: false, failed: 'The source could not be created.' };
  }
}
