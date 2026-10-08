/**
 * Which finance system answers, with the org's own credential.
 *
 * The workspace's finance sources (`libs/connectors/families.ts`) decide:
 * the one the agent named, else the only one, else a refusal that names what
 * is connected. The credential is the source's own (`knowledge_source.api_token_id`,
 * else its install's login), decrypted per call under that org's key — never
 * another org's, never cached — and a login renewed on the way is saved back
 * to the source's row.
 */

import type { FinanceProvider, FinanceProviderInput } from './types';
import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_KINDS, familySourcesForOrg } from '@/libs/connectors/families';
import { logger } from '@/libs/Logger';

type Factory = (input: FinanceProviderInput) => Promise<FinanceProvider> | FinanceProvider;

/** The provider for each connector kind, loaded on use. */
const FACTORIES: Record<string, () => Promise<Factory>> = {
  stripe: async () => (await import('./providers/stripe')).stripeFinanceProvider,
  quickbooks: async () => (await import('./providers/quickbooks')).quickbooksFinanceProvider,
  xero: async () => (await import('./providers/xero')).xeroFinanceProvider,
  netsuite: async () => (await import('./providers/netsuite')).netsuiteFinanceProvider,
  ramp: async () => (await import('./providers/ramp')).rampFinanceProvider,
  bill: async () => (await import('./providers/bill')).billFinanceProvider,
};

/**
 * The decrypted credential a source authenticates with: the stored credential
 * it names, else its install's login. Undefined when it has none.
 * @param orgId - The workspace.
 * @param source - The source row.
 */
export async function credentialsForFamilySource(orgId: string, source: FamilySource): Promise<Record<string, unknown> | undefined> {
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  const own = await getCredentialsForConnector({ orgId, connectorSlug: source.slug, apiTokenId: source.apiTokenId });
  if (own || source.slug === source.kind) {
    return own as Record<string, unknown> | undefined;
  }
  // A source cloned from a connector pack keeps its login on the connector's install.
  return await getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: null }) as Record<string, unknown> | undefined;
}

/**
 * Build the provider for one source, with that source's credential.
 * @param orgId - The workspace.
 * @param source - The finance source.
 */
export async function financeProviderForSource(orgId: string, source: FamilySource): Promise<FinanceProvider> {
  const load = Object.hasOwn(FACTORIES, source.kind) ? FACTORIES[source.kind] : undefined;
  if (!load) {
    throw new Error(`${source.slug} is a ${source.kind} source, which no finance provider serves yet.`);
  }
  const credentials = await credentialsForFamilySource(orgId, source) ?? {};
  const factory = await load();
  return factory({
    orgId,
    source: { id: source.id, slug: source.slug, config: source.config },
    credentials,
    persistence: { kind: 'persist', orgId, sourceId: source.id, warn: message => logger.warn(message, { orgId, sourceId: source.id }) },
  });
}

/**
 * The finance provider to answer a call: the named source, else the
 * workspace's only finance source among `allowed` (the agent's own).
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source the agent named.
 * @param opts.allowed - The source slugs this caller may read (the agent's scope); every one when omitted.
 */
export async function financeProviderFor(orgId: string, opts: { sourceSlug?: string | null; allowed?: readonly string[] } = {}): Promise<FinanceProvider> {
  const all = await familySourcesForOrg(orgId, 'finance');
  const sources = opts.allowed ? all.filter(s => opts.allowed!.includes(s.slug)) : all;
  if (sources.length === 0) {
    throw new Error(`No finance system is connected for this agent. Connect one (${FAMILY_KINDS.finance.join(', ')}) with offer_connection, and give this agent the source.`);
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No finance source named ${opts.sourceSlug}. Connected: ${describe(sources)}.`);
    }
  } else if (sources.length > 1) {
    throw new Error(`This agent reaches ${sources.length} finance sources; name one (source). Connected: ${describe(sources)}.`);
  } else {
    chosen = sources[0]!;
  }
  return financeProviderForSource(orgId, chosen);
}

function describe(sources: FamilySource[]): string {
  return sources.map(s => `${s.slug} (${s.kind})`).join('; ');
}
