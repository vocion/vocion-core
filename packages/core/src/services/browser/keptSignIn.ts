/**
 * KEPT SIGN-INS, STORED: a connector's site, signed in by a person, sealed
 * under the workspace's key on the connector's row
 * (`knowledge_source.kept_sign_in`), the same vault and the same seal a
 * browser run's checkpoint uses (`BrowserRunService` `seal`). What the
 * connector's page reads (when it was saved, from where, whether a run found
 * it expired) sits beside the seal, in the clear; the cookies never leave it
 * except into a run's browser.
 *
 * Three ways in: the operator's CLI through `PUT /api/v1/squarespace/session`,
 * a file uploaded behind Advanced on the connector's form
 * (`/rpc/sources/:id/session`), and a run that used it and saves back the
 * refreshed state when it ends (`keepSignInAfterRun`), so a session that gets
 * used stays alive. Which connectors keep one, and for which domains, is
 * `libs/browser/keptSignIn.ts`.
 */

import type { KeptSignInColumn, KeptSignInSpec, KeptSignInStatus, SignInState } from '@/libs/browser/keptSignIn';
import { Buffer } from 'node:buffer';
import { and, eq } from 'drizzle-orm';
import { checkSignInState, keepOnly, keptSignInSpecFor } from '@/libs/browser/keptSignIn';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

/** What a run carries to use a kept sign-in: the connector it is kept on, and what it may hold. */
export type RunSignIn = { sourceId: number; vendor: string; domains: string[] };

/** A kept sign-in opened for a run. */
export type OpenedSignIn = { state: SignInState; savedAt: string | null; savedFrom: string | null };

/** A kept sign-in that was refused, said for the person who sent it. */
export class SignInRefusedError extends Error {
  constructor(message: string, public readonly field: string, public readonly status: 400 | 404 = 400) {
    super(message);
    this.name = 'SignInRefusedError';
  }
}

async function readRow(orgId: string, sourceId: number) {
  const [row] = await db.select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson, keptSignIn: knowledgeSourceSchema.keptSignIn })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)))
    .limit(1);
  return row ?? null;
}

/**
 * The kept sign-in a connector row takes, from the connector it runs, or null.
 * @param row - The row.
 * @param row.slug - Its slug.
 * @param row.config - Its config, naming its connector.
 */
export function specOfSource(row: { slug: string; config: Record<string, unknown> | null }): KeptSignInSpec | null {
  return keptSignInSpecFor((row.config?._connector as string | undefined) ?? row.slug);
}

/**
 * Seal a sign-in and keep it on the connector, replacing the one before and
 * clearing "needs a fresh sign-in". Only the connector's domains are kept.
 * @param input - The connector and the state.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The connector row.
 * @param input.state - The browser state, already checked.
 * @param input.site - The site it was made for.
 * @param input.savedFrom - Where, in words.
 * @param input.savedBy - Who, when a person or a token.
 * @param input.now - The clock.
 */
export async function keepSignIn(input: { orgId: string; sourceId: number; state: SignInState; site: string | null; savedFrom: string; savedBy: string | null; now?: Date }): Promise<KeptSignInStatus> {
  const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
  const sealed = await buildCredentialVault().encrypt(input.orgId, Buffer.from(JSON.stringify(input.state), 'utf8'));
  const column: KeptSignInColumn = {
    sealed,
    site: input.site,
    savedAt: (input.now ?? new Date()).toISOString(),
    savedFrom: input.savedFrom.slice(0, 200),
    savedBy: input.savedBy,
    cookies: input.state.cookies.length,
    needsSignIn: null,
  };
  await db.update(knowledgeSourceSchema)
    .set({ keptSignIn: column })
    .where(and(eq(knowledgeSourceSchema.orgId, input.orgId), eq(knowledgeSourceSchema.id, input.sourceId)));
  return statusOf(column);
}

/**
 * A sign-in sent from outside (the CLI, an uploaded file), checked against the
 * connector's domains, sealed and kept. Throws `SignInRefusedError` with a
 * sentence for the sender: no such connector, a connector that keeps none, or
 * a state holding anything outside its domains.
 * @param input - The connector, what was sent, and where it came from.
 * @param input.orgId - The workspace.
 * @param input.sourceId - The connector row.
 * @param input.raw - The state, or the CLI's file around it.
 * @param input.site - The site it was made for, when the sender said.
 * @param input.savedFrom - Where, in words.
 * @param input.savedBy - Who.
 */
export async function acceptSignIn(input: { orgId: string; sourceId: number; raw: unknown; site?: string | null; savedFrom: string; savedBy: string | null }): Promise<KeptSignInStatus> {
  const row = await readRow(input.orgId, input.sourceId);
  if (!row) {
    throw new SignInRefusedError('There is no such connector in this workspace.', 'sourceId', 404);
  }
  const spec = specOfSource(row);
  if (!spec) {
    throw new SignInRefusedError('This connector does not keep a sign-in.', 'sourceId');
  }
  const checked = checkSignInState(input.raw, spec.domains);
  if (!checked.ok) {
    throw new SignInRefusedError(checked.why, checked.field);
  }
  const site = input.site ?? (typeof row.config?.siteUrl === 'string' ? row.config.siteUrl : null);
  return keepSignIn({ orgId: input.orgId, sourceId: input.sourceId, state: checked.value, site, savedFrom: input.savedFrom, savedBy: input.savedBy });
}

/**
 * The kept sign-in, opened for a run's browser, or null when there is none or
 * its seal will not open (said in the log, never thrown: the run then signs
 * in the way it would have without one).
 * @param orgId - The workspace.
 * @param sourceId - The connector row.
 */
export async function openKeptSignIn(orgId: string, sourceId: number): Promise<OpenedSignIn | null> {
  const row = await readRow(orgId, sourceId);
  const column = row?.keptSignIn;
  if (!column?.sealed) {
    return null;
  }
  try {
    const { buildCredentialVault } = await import('@/libs/crypto/credentialVault');
    const s = column.sealed;
    const state = JSON.parse((await buildCredentialVault().decrypt(orgId, s.ciphertext, s.nonce, s.authTag, s.dekId)).toString('utf8')) as SignInState;
    return { state, savedAt: column.savedAt, savedFrom: column.savedFrom };
  } catch (e) {
    console.warn('[browser] a kept sign-in could not be opened', { sourceId, reason: (e as Error).message });
    return null;
  }
}

/**
 * Say on the connector that its site wants a person to sign in again: a run
 * found the sign-in page and the password, if any, was refused. The sealed
 * state stays (it may be the only one) until a fresh one replaces it.
 * @param orgId - The workspace.
 * @param sourceId - The connector row.
 * @param why - What the run found, in one sentence.
 * @param now - The clock.
 */
export async function markSignInNeeded(orgId: string, sourceId: number, why: string, now: Date = new Date()): Promise<void> {
  const row = await readRow(orgId, sourceId);
  if (!row) {
    return;
  }
  const before: KeptSignInColumn = row.keptSignIn ?? { sealed: null, site: typeof row.config?.siteUrl === 'string' ? row.config.siteUrl : null, savedAt: null, savedFrom: null, savedBy: null, cookies: 0, needsSignIn: null };
  await db.update(knowledgeSourceSchema)
    .set({ keptSignIn: { ...before, needsSignIn: { at: now.toISOString(), why: why.slice(0, 400) } } })
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.id, sourceId)));
}

/**
 * The status a connector's page shows, from the stored column.
 * @param column - The column, or null.
 */
export function statusOf(column: KeptSignInColumn | null | undefined): KeptSignInStatus {
  return {
    kept: Boolean(column?.sealed),
    site: column?.site ?? null,
    savedAt: column?.savedAt ?? null,
    savedFrom: column?.savedFrom ?? null,
    cookies: column?.cookies ?? 0,
    needsSignIn: column?.needsSignIn ?? null,
  };
}

/**
 * Every connector's kept sign-in status in a workspace, by connector row id,
 * for the connectors that take one. Reads no seal.
 * @param orgId - The workspace.
 */
export async function keptSignInStatuses(orgId: string): Promise<Record<number, KeptSignInStatus>> {
  const rows = await db.select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, config: knowledgeSourceSchema.configJson, keptSignIn: knowledgeSourceSchema.keptSignIn })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, orgId));
  const out: Record<number, KeptSignInStatus> = {};
  for (const row of rows) {
    if (specOfSource(row)) {
      out[row.id] = statusOf(row.keptSignIn);
    }
  }
  return out;
}

/** What `keepSignInAfterRun` reads of a run's browser. */
type RunBrowser = { context: { storageState: () => Promise<{ cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }>; origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> }> } };

/**
 * After a run that used a kept sign-in ended well: its browser's state for the
 * connector's domains, saved back, so the session a run refreshed is the one
 * the next run starts from. Nothing when the browser holds no cookie of
 * those domains. Never throws: a sign-in not saved back is the one before.
 * @param input - The run's sign-in and its browser.
 * @param input.orgId - The workspace.
 * @param input.signIn - What the run carried.
 * @param input.browser - The run's browser, still open.
 * @param input.runLabel - The run, in words ("Browser run 12").
 */
export async function keepSignInAfterRun(input: { orgId: string; signIn: RunSignIn; browser: RunBrowser; runLabel: string }): Promise<boolean> {
  try {
    const state = keepOnly(await input.browser.context.storageState(), input.signIn.domains);
    if (state.cookies.length === 0) {
      return false;
    }
    const row = await readRow(input.orgId, input.signIn.sourceId);
    if (!row) {
      return false;
    }
    await keepSignIn({ orgId: input.orgId, sourceId: input.signIn.sourceId, state, site: row.keptSignIn?.site ?? (typeof row.config?.siteUrl === 'string' ? row.config.siteUrl : null), savedFrom: `${input.runLabel}, refreshed as it ended`, savedBy: null });
    return true;
  } catch (e) {
    console.warn('[browser] a kept sign-in was not saved back', { sourceId: input.signIn.sourceId, reason: (e as Error).message });
    return false;
  }
}
