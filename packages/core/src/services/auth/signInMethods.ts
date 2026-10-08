/**
 * The ways a person can sign in, as their profile page shows them, and
 * unlinking one.
 *
 * A way in is a password, a linked provider this deployment still offers
 * (Google, Microsoft, or one an extension registered), or — when mail is set
 * up — an email link. Unlinking a provider is refused when it would leave no
 * password and no other linked provider: the email link is not counted,
 * because it exists only while the deployment's mail settings do, and a
 * setting changed later must not lock anyone out.
 */

import type { AdoptionActor } from '@/services/adoption/track';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { allSignInProviders, configuredSignInProviders } from '@/libs/identity/signInProviders';
import { authAccountSchema, userSchema } from '@/models/Schema';
import { emailLinkConfigured } from './emailLink';

/** One provider on the profile page. */
export type ProviderMethod = {
  id: string;
  label: string;
  /** Linked to this login. */
  linked: boolean;
  /** Offered on this deployment. A linked provider that is not cannot sign anyone in, but can still be unlinked. */
  offered: boolean;
  /** Why it cannot be unlinked right now (it is the last way in), or null. Only meaningful when linked. */
  unlinkProblem: string | null;
};

export type SignInMethods = {
  email: string;
  /** A password is set. */
  password: boolean;
  /** "Email me a sign-in link" is offered on this deployment. */
  emailLink: boolean;
  providers: ProviderMethod[];
};

/**
 * Why unlinking `provider` is refused, or null when it may go. Pure.
 * @param input - The login's ways in.
 * @param input.provider - The provider to unlink.
 * @param input.hasPassword - Whether a password is set.
 * @param input.linkedProviders - Every provider linked to this login (a provider may repeat).
 * @param input.offeredProviders - Providers this deployment offers.
 */
export function unlinkProblem(input: {
  provider: string;
  hasPassword: boolean;
  linkedProviders: readonly string[];
  offeredProviders: readonly string[];
}): string | null {
  if (!input.linkedProviders.includes(input.provider)) {
    return 'That sign-in method is not linked to your login.';
  }
  const otherWayIn = input.linkedProviders.some(p => p !== input.provider && input.offeredProviders.includes(p));
  if (!input.hasPassword && !otherWayIn) {
    return 'This is your only way to sign in. Link another account first, then unlink this one.';
  }
  return null;
}

/**
 * A person's ways in.
 * @param userId - The person.
 * @returns Null when the login no longer exists.
 */
export async function listSignInMethods(userId: string): Promise<SignInMethods | null> {
  const [user] = await db
    .select({ email: userSchema.email, passwordHash: userSchema.passwordHash })
    .from(userSchema)
    .where(eq(userSchema.id, userId))
    .limit(1);
  if (!user) {
    return null;
  }
  const links = await db.select({ provider: authAccountSchema.provider }).from(authAccountSchema).where(eq(authAccountSchema.userId, userId));
  const linkedProviders = links.map(l => l.provider);
  const offeredProviders = configuredSignInProviders().map(d => d.id);
  const providers = allSignInProviders()
    .filter(d => offeredProviders.includes(d.id) || linkedProviders.includes(d.id))
    .map(d => ({
      id: d.id,
      label: d.label,
      linked: linkedProviders.includes(d.id),
      offered: offeredProviders.includes(d.id),
      unlinkProblem: linkedProviders.includes(d.id)
        ? unlinkProblem({ provider: d.id, hasPassword: Boolean(user.passwordHash), linkedProviders, offeredProviders })
        : null,
    }));
  return { email: user.email, password: Boolean(user.passwordHash), emailLink: emailLinkConfigured(), providers };
}

/**
 * Record a link or unlink on the adoption stream, where an account's sign-in
 * events already are. Never throws.
 * @param actor - The person, with the workspace they were in.
 * @param change - What happened.
 * @param provider - Which provider.
 */
export async function recordSignInMethodChange(actor: AdoptionActor, change: 'linked' | 'unlinked', provider: string): Promise<void> {
  const { track } = await import('@/services/adoption/track');
  await track(actor, change === 'linked' ? 'auth.method_linked' : 'auth.method_unlinked', { meta: { provider } });
  import('@/libs/Logger')
    .then(({ logger }) => logger.info(`sign-in method ${change}`, { userId: actor.userId, provider }))
    .catch(() => {});
}

/**
 * The notification a newly linked provider gets: its name, and what to do if
 * the person did not add it. Pure.
 * @param label - The provider's name as a person knows it ("Google").
 */
export function methodAddedNotice(label: string): { title: string; body: string } {
  return {
    title: `${label} added to your sign-in methods`,
    body: `You can now sign in with ${label}. If you did not add it, remove it from your profile and change your password.`,
  };
}

/**
 * A provider was just linked to this login — on first use with its verified
 * address, or from the profile page. Recorded on the adoption stream, and told
 * to the person ("Google added to your sign-in methods") in the workspace they
 * land in, opening their profile, where the method is listed and can be
 * removed. Not for a login this sign-in just made: there the provider is how
 * they joined, not an addition. Never throws: it rides on a sign-in.
 * @param userId - The login.
 * @param provider - Auth.js's provider id.
 */
export async function signInMethodLinked(userId: string, provider: string): Promise<void> {
  try {
    const { resolveTenancyForUser } = await import('@/libs/tenancy');
    const tenancy = await resolveTenancyForUser(userId);
    if (!tenancy.projectId) {
      return;
    }
    await recordSignInMethodChange({ orgId: tenancy.projectId, projectId: tenancy.projectId, accountId: tenancy.accountId, userId }, 'linked', provider);
    // A login made by this very sign-in (an invite accepted with Google) has
    // nothing else yet: the provider is how they joined, not an addition.
    const methods = await listSignInMethods(userId);
    if (!methods || (!methods.password && methods.providers.filter(p => p.linked).length <= 1)) {
      return;
    }
    const label = allSignInProviders().find(d => d.id === provider)?.label ?? provider;
    const { emitEventDetached: emitEvent } = await import('@/libs/eventBridge');
    await emitEvent({
      orgId: tenancy.projectId,
      type: 'account.sign_in_method_added',
      payload: { userId, provider, ...methodAddedNotice(label), link: '/dashboard/profile', dedupe: `${userId}:${provider}:${Date.now()}` },
      dispatchMode: 'auto',
    });
  } catch (error) {
    import('@/libs/Logger')
      .then(({ logger }) => logger.warn('could not record or tell a linked sign-in method', { error: error instanceof Error ? error.message : String(error) }))
      .catch(() => {});
  }
}

export type UnlinkResult = { ok: true } | { ok: false; error: string };

/**
 * Unlink a provider from a login, unless that would leave no way in. The
 * check and the delete run in one transaction with the person's row locked,
 * so two unlinks at once cannot each leave the other as the last way in.
 * @param actor - The person and the workspace they are in (for the record).
 * @param provider - Auth.js's provider id.
 */
export async function unlinkSignInMethod(actor: AdoptionActor, provider: string): Promise<UnlinkResult> {
  const offeredProviders = configuredSignInProviders().map(d => d.id);
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ passwordHash: userSchema.passwordHash })
      .from(userSchema)
      .where(eq(userSchema.id, actor.userId))
      .for('update')
      .limit(1);
    if (!user) {
      return { ok: false as const, error: 'Your login could not be found.' };
    }
    const links = await tx.select({ provider: authAccountSchema.provider }).from(authAccountSchema).where(eq(authAccountSchema.userId, actor.userId));
    const problem = unlinkProblem({
      provider,
      hasPassword: Boolean(user.passwordHash),
      linkedProviders: links.map(l => l.provider),
      offeredProviders,
    });
    if (problem) {
      return { ok: false as const, error: problem };
    }
    await tx.delete(authAccountSchema).where(and(eq(authAccountSchema.userId, actor.userId), eq(authAccountSchema.provider, provider)));
    return { ok: true as const };
  });
  if (result.ok) {
    await recordSignInMethodChange(actor, 'unlinked', provider);
  }
  return result;
}
