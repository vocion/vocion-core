/**
 * Which HR system answers, with the org's own credential — the people
 * family's twin of `services/finance/provider.ts`, resolved the same way.
 */

import type { PeopleProvider, PeopleProviderInput } from './types';
import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_KINDS, familySourcesForOrg } from '@/libs/connectors/families';
import { logger } from '@/libs/Logger';
import { credentialsForFamilySource } from '@/services/finance/provider';

type Factory = (input: PeopleProviderInput) => Promise<PeopleProvider> | PeopleProvider;

const FACTORIES: Record<string, () => Promise<Factory>> = {
  gusto: async () => (await import('./providers/gusto')).gustoPeopleProvider,
  rippling: async () => (await import('./providers/rippling')).ripplingPeopleProvider,
  workday: async () => (await import('./providers/workday')).workdayPeopleProvider,
};

/**
 * Build the provider for one source, with that source's credential.
 * @param orgId - The workspace.
 * @param source - The HR source.
 */
export async function peopleProviderForSource(orgId: string, source: FamilySource): Promise<PeopleProvider> {
  const load = Object.hasOwn(FACTORIES, source.kind) ? FACTORIES[source.kind] : undefined;
  if (!load) {
    throw new Error(`${source.slug} is a ${source.kind} source, which no HR provider serves yet.`);
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
 * The HR provider to answer a call: the named source, else the only one.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source the agent named.
 * @param opts.allowed - The source slugs this caller may read; every one when omitted.
 */
export async function peopleProviderFor(orgId: string, opts: { sourceSlug?: string | null; allowed?: readonly string[] } = {}): Promise<PeopleProvider> {
  const all = await familySourcesForOrg(orgId, 'people');
  const sources = opts.allowed ? all.filter(s => opts.allowed!.includes(s.slug)) : all;
  if (sources.length === 0) {
    throw new Error(`No HR system is connected for this agent. Connect one (${FAMILY_KINDS.people.join(', ')}) with offer_connection, and give this agent the source.`);
  }
  let chosen: FamilySource | undefined;
  if (opts.sourceSlug) {
    chosen = sources.find(s => s.slug === opts.sourceSlug);
    if (!chosen) {
      throw new Error(`No HR source named ${opts.sourceSlug}. Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join('; ')}.`);
    }
  } else if (sources.length > 1) {
    throw new Error(`This agent reaches ${sources.length} HR sources; name one (source). Connected: ${sources.map(s => `${s.slug} (${s.kind})`).join('; ')}.`);
  } else {
    chosen = sources[0]!;
  }
  return peopleProviderForSource(orgId, chosen);
}
