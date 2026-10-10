/**
 * An agent's sources, with what it `requires` bound to the workspace's own.
 *
 * A plugin cannot know what a workspace calls its sources, so its agents say
 * what they reach for by family or connector (`requires.connectors`,
 * `requires.optional`: `finance`, `people`, `gmail`) and apply binds each to
 * every source of the workspace of that family or kind. The agent's own
 * `connectorSources` stay first and are never dropped; an entry that names
 * neither a family nor a kind the workspace has binds nothing.
 */

import type { ConnectorFamily } from '@/libs/connectors/families';
import { FAMILY_KINDS } from '@/libs/connectors/families';

/**
 * The source slugs an agent reads: its own, then each workspace source whose
 * kind its `requires` names.
 * @param agent - The agent's declared sources and requirements.
 * @param agent.connectorSources - Source slugs it names itself.
 * @param agent.requires - Families or connector kinds it reaches for.
 * @param agent.requires.connectors - Required.
 * @param agent.requires.optional - Optional.
 * @param sources - The workspace's sources.
 */
export function boundConnectorSources(
  agent: { connectorSources: string[]; requires?: { connectors: string[]; optional: string[] } },
  sources: Array<{ slug: string; kind: string }>,
): string[] {
  const wanted = new Set<string>();
  for (const name of [...(agent.requires?.connectors ?? []), ...(agent.requires?.optional ?? [])]) {
    const kinds = Object.hasOwn(FAMILY_KINDS, name) ? FAMILY_KINDS[name as ConnectorFamily] : [name];
    kinds.forEach(k => wanted.add(k));
  }
  const out = [...agent.connectorSources];
  for (const s of sources) {
    if (wanted.has(s.kind) && !out.includes(s.slug)) {
      out.push(s.slug);
    }
  }
  return out;
}
