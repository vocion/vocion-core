/**
 * Everything that happens after a vendor says yes (#1028).
 *
 * The grant is a login row in the workspace credential store (`api_token`),
 * not a property of a source: a person can log in to GitHub before any
 * GitHub source exists, and the connector's sources are linked to the row
 * afterwards. Both entry points write inside one transaction, so a login
 * that cannot finish leaves no row, no link and no attempt behind.
 *
 * The OAuth callback is the trust boundary; it checks the signed state, the
 * session and the admin role before it calls anything here.
 */

import type { ConnectProvider } from '@/libs/connect/provider';
import type { DbTransaction } from '@/libs/DbTransaction';
import type { CredentialPlatform } from '@/libs/platforms/registry';
import type { SealedLoginValues } from '@/services/ApiTokenService';
import type { RawCredentials } from '@/services/SourceCredentialService';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { recordConnectAttempt } from '@/libs/connect/attempts';
import { connectFailureSummary } from '@/libs/connect/attemptWording';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { apiTokenSchema, knowledgeSourceSchema } from '@/models/Schema';
import { sealLoginValues, storeLoginCredential } from '@/services/ApiTokenService';
import { markCardRun } from '@/services/ConversationService';

export type LoginOutcome
  = | { ok: true; tokenId: string; linkedSourceIds: number[] }
    | { ok: false; reason: string };

type ChatCard = { conversationId: number; cardId: string };

/**
 * The sources a login may point at: the ones of this connector that hold no
 * credential, hold one this login just replaced, or hold an earlier login of
 * the same account. A source on a pasted key the person chose is not here.
 * Oldest first, with the source the login started from leading the list.
 * @param tx - The login's transaction.
 * @param input - What the login is for.
 * @param input.orgId - The workspace.
 * @param input.connectorSlug - Which connector's sources to consider.
 * @param input.platform - The credential platform the login belongs to.
 * @param input.account - The account the login is on.
 * @param input.replacedIds - Login or pasted rows this login revoked.
 * @param input.sourceSlug - The source the login started from, if any.
 */
async function sourcesToLink(
  tx: DbTransaction,
  input: { orgId: string; connectorSlug: string; platform: CredentialPlatform; account: string; replacedIds: string[]; sourceSlug?: string },
): Promise<Array<{ id: number; apiTokenId: string | null }>> {
  // Same rule `findSourceBySlug` uses: `_connector`, else the row's own slug.
  const ofThisConnector = sql`coalesce(${knowledgeSourceSchema.configJson}->>'_connector', ${knowledgeSourceSchema.slug}) = ${input.connectorSlug}`;
  const sameAccountLogins = tx
    .select({ id: apiTokenSchema.id })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.obtainedVia, 'login'),
      eq(apiTokenSchema.platform, input.platform.id),
      eq(apiTokenSchema.account, input.account),
    ));
  const mayRelink = [
    isNull(knowledgeSourceSchema.apiTokenId),
    inArray(knowledgeSourceSchema.apiTokenId, sameAccountLogins),
    ...(input.replacedIds.length > 0 ? [inArray(knowledgeSourceSchema.apiTokenId, input.replacedIds)] : []),
    ...(input.sourceSlug ? [eq(knowledgeSourceSchema.slug, input.sourceSlug)] : []),
  ];
  const rows = await tx
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), ofThisConnector, or(...mayRelink)))
    .orderBy(asc(knowledgeSourceSchema.id));
  const started = rows.filter(row => row.slug === input.sourceSlug);
  return [...started, ...rows.filter(row => row.slug !== input.sourceSlug)];
}

/**
 * Point the chosen sources at the login row.
 *
 * A login row is one OAuth grant for the whole account, not a key issued for
 * one place, so it is shared by nature: every candidate links to it, marked
 * non-exclusive whatever the platform's pasted keys allow. A source left
 * unlinked would resolve no credential at all, since no `source_credential`
 * is written any more.
 * @param tx - The login's transaction.
 * @param input - Who and what to link.
 * @param input.orgId - The workspace.
 * @param input.tokenId - The login row.
 * @param input.candidates - Sources the login may point at.
 */
async function linkSources(
  tx: DbTransaction,
  input: { orgId: string; tokenId: string; candidates: Array<{ id: number; apiTokenId: string | null }> },
): Promise<number[]> {
  const ids = input.candidates.filter(source => source.apiTokenId !== input.tokenId).map(source => source.id);
  if (ids.length === 0) {
    return [];
  }
  await tx
    .update(knowledgeSourceSchema)
    .set({ apiTokenId: input.tokenId, apiTokenExclusive: false })
    .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), inArray(knowledgeSourceSchema.id, ids)));
  return ids;
}

/**
 * Run the provider's second step when it has one. Most providers do not: their
 * login is the credential.
 * @param provider - The provider that logged the person in.
 * @param credentials - The bag the exchange produced.
 */
async function finishedBag(provider: ConnectProvider, credentials: RawCredentials): Promise<{ ok: true; credentials: RawCredentials } | { ok: false; reason: string }> {
  if (!provider.finish) {
    return { ok: true, credentials };
  }
  const finished = await provider.finish(credentials);
  return finished.ok ? finished : { ok: false, reason: `token_step_failed:${finished.missing}` };
}

type LoginInput = {
  orgId: string;
  userId: string;
  provider: ConnectProvider;
  connectorSlug: string;
  sourceSlug?: string;
  exchanged: { credentials: RawCredentials; displayName: string };
  card?: ChatCard;
};

/**
 * The writes of a successful login, inside the caller's transaction.
 * @param tx - The transaction to write in.
 * @param input - The login, as `completeLogin` received it.
 * @param resolved - The platform, the finished bag and the account.
 * @param resolved.platform - The credential platform for the connector.
 * @param resolved.credentials - The bag to store, after any second step.
 * @param resolved.account - The account the login is on.
 * @param resolved.sealed - The bag, encrypted before the transaction opened.
 */
async function writeLogin(
  tx: DbTransaction,
  input: LoginInput,
  resolved: { platform: CredentialPlatform; credentials: RawCredentials; account: string; sealed: SealedLoginValues },
): Promise<LoginOutcome> {
  const { platform, account } = resolved;
  const stored = await storeLoginCredential({
    orgId: input.orgId,
    platform: platform.id,
    name: input.exchanged.displayName,
    account,
    values: resolved.credentials,
    sealed: resolved.sealed,
    createdBy: input.userId,
    tx,
  });
  const candidates = await sourcesToLink(tx, { orgId: input.orgId, connectorSlug: input.connectorSlug, platform, account, replacedIds: stored.replacedIds, sourceSlug: input.sourceSlug });
  const linkedSourceIds = await linkSources(tx, { orgId: input.orgId, tokenId: stored.id, candidates });
  await recordConnectAttempt({ orgId: input.orgId, userId: input.userId, provider: input.provider.id, providerLabel: input.provider.label, connector: input.connectorSlug, ok: true, tx });
  if (input.card) {
    // A card already decided returns false; the login stands either way.
    await markCardRun({
      orgId: input.orgId,
      conversationId: input.card.conversationId,
      cardId: input.card.cardId,
      expectState: 'proposed',
      patch: { state: 'decided', decision: { action: 'approve', at: new Date().toISOString(), by: input.userId } },
      tx,
    });
  }
  return { ok: true, tokenId: stored.id, linkedSourceIds };
}

/**
 * Store the login, link the connector's sources, record the attempt and mark
 * the chat card approved by the person who logged in, all or nothing.
 *
 * The card is a view, not a gate: one already decided does not undo the login.
 * A failure inside the transaction (the store, a link, the audit row) throws,
 * and nothing it did survives.
 * @param input - The finished exchange and where it came from.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin who logged in.
 * @param input.provider - The provider that ran the login.
 * @param input.connectorSlug - The connector the login is for.
 * @param input.sourceSlug - The source it started from, when it did.
 * @param input.exchanged - The provider's bag and a display name for the row.
 * @param input.card - The chat card it came from, when it did.
 */
export async function completeLogin(input: LoginInput): Promise<LoginOutcome> {
  const platform = platformForConnectorSlug(input.connectorSlug);
  if (!platform) {
    return { ok: false, reason: 'no_credential_platform' };
  }
  const finished = await finishedBag(input.provider, input.exchanged.credentials);
  if (!finished.ok) {
    return finished;
  }
  const account = input.provider.summarize(finished.credentials)?.account ?? input.exchanged.displayName;
  // Sealed first: the vault reads the org's key through the pool, which must not wait on this transaction.
  const sealed = await sealLoginValues(input.orgId, finished.credentials);
  return db.transaction(tx => writeLogin(tx, input, { platform, credentials: finished.credentials, account, sealed }));
}

type FailedLoginInput = {
  orgId: string;
  userId: string;
  provider: ConnectProvider;
  connectorSlug: string;
  reason: string;
  card?: ChatCard;
};

/**
 * The writes of a failed login, inside one transaction.
 * @param tx - The transaction to write in.
 * @param input - The failure, as `recordFailedLogin` received it.
 */
async function writeFailure(tx: DbTransaction, input: FailedLoginInput): Promise<void> {
  await recordConnectAttempt({ orgId: input.orgId, userId: input.userId, provider: input.provider.id, providerLabel: input.provider.label, connector: input.connectorSlug, ok: false, reason: input.reason, tx });
  if (input.card) {
    await markCardRun({
      orgId: input.orgId,
      conversationId: input.card.conversationId,
      cardId: input.card.cardId,
      expectState: 'proposed',
      patch: { lastAttempt: { at: new Date().toISOString(), reason: input.reason, summary: connectFailureSummary(input.provider.label, input.reason) } },
      tx,
    });
  }
}

/**
 * A refused or failed login: record the attempt, with its date, and put it on
 * the card. The card stays `proposed`: a failed login is not a rejection, and
 * the person can try again from the same card.
 * @param input - Who tried, with what outcome.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin who tried.
 * @param input.provider - The provider the login was with.
 * @param input.connectorSlug - The connector it was for.
 * @param input.reason - The short reason code.
 * @param input.card - The chat card it came from, when it did.
 */
export async function recordFailedLogin(input: FailedLoginInput): Promise<void> {
  await db.transaction(tx => writeFailure(tx, input));
}
