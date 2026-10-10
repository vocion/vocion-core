/**
 * SETUP STATE — what a plugin still needs before it can do anything, read
 * from what the plugin itself declares (`plugin.yaml` `setup:`), never from a
 * list in core (principle 13, point 5: no connector or type slugs in core
 * logic).
 *
 * A plugin that is on but not set up is a distinct state the product has to
 * name: the software factory with no GitHub connected has seats, missions and
 * pages, and nothing it can read. Until this existed the first answer in an
 * unconfigured workspace was a chip asking "What should I do?" and an agent
 * discovering the gap for itself (DeliveryStack workspace, 2026-10-07). This
 * service is the one place that judgement is made, so the chat's "Set up your
 * <plugin>" chip (`services/chat/suggestions.ts`) and the agent's
 * `describe_setup` tool read the same answer.
 *
 * Two kinds of step, both declared by the plugin:
 *   connectors — a connector slug a person must connect; done when a live
 *                credential exists for that connector in this org, whether a
 *                vendor login, an app installation or a pasted key. A family
 *                name (`finance`, `people`) is a step any of its connectors
 *                does, so a plugin never has to name a vendor;
 *   records    — an object type the plugin ships that must hold at least one
 *                active record; done when it does.
 * Nothing here decides what the steps mean for the plugin. A plugin that
 * declares no `setup:` has no setup state and never appears.
 */

import type { ConnectorFamily } from '@/libs/connectors/families';
import { FAMILY_KINDS, FAMILY_LABEL } from '@/libs/connectors/families';
import { getConnector } from '@/libs/sources/registry';
import { listPlugins } from '@/libs/workspace/plugins';
import { countActiveRecordsByType } from '@/services/objects/recordCounts';
import { enabledPluginsForOrg } from '@/services/PluginService';
import { credentialStatusForOrg } from '@/services/SourceCredentialService';
import { listSources } from '@/services/SourceSyncService';

export type SetupStep = {
  /** `connector:<slug>` or `records:<type slug>` — stable across runs. */
  key: string;
  kind: 'connector' | 'records';
  /**
   * The connector slug or the object type slug. For a family step, the
   * connector that did it, else the one the workspace declares a source
   * for, else the family name.
   */
  slug: string;
  /** For a family step: the family, and every connector that would do it. */
  family?: string;
  options?: string[];
  /** A short label a card or a sentence can carry. */
  label: string;
  /** For a connector: its brand (`libs/brands/catalog.ts`), for the checklist's tile. */
  brand?: string;
  done: boolean;
  /**
   * For a connector: the source slugs of this connector the workspace has
   * declared (what the login will be scoped to). Empty when the workspace
   * has no source of that kind yet, which is itself worth saying.
   */
  sources?: string[];
};

export type PluginSetup = {
  plugin: string;
  name: string;
  complete: boolean;
  steps: SetupStep[];
};

/**
 * The setup state of every plugin this org has on that declares a `setup:`
 * block. Plugins without one are not listed; a plugin whose every step is
 * done is listed with `complete: true` so a caller can say so.
 * @param orgId - Tenant.
 */
export async function setupStateForOrg(orgId: string): Promise<PluginSetup[]> {
  const enabled = await enabledPluginsForOrg(orgId);
  const plugins = listPlugins().filter(p => enabled.includes(p.manifest.slug));
  const declaring = plugins.filter(p => p.manifest.setup.connectors.length > 0 || p.manifest.setup.records.length > 0);
  if (declaring.length === 0) {
    return [];
  }

  const wantedTypes = [...new Set(declaring.flatMap(p => p.manifest.setup.records))];
  const [credentials, sources, counts] = await Promise.all([
    credentialStatusForOrg(orgId),
    listSources(orgId),
    countActiveRecordsByType(orgId, wantedTypes),
  ]);

  const sourcesByConnector = new Map<string, string[]>();
  for (const s of sources) {
    const connector = typeof s.config?._connector === 'string' ? s.config._connector : (s.kind ?? s.slug);
    sourcesByConnector.set(connector, [...(sourcesByConnector.get(connector) ?? []), s.slug]);
  }
  const connectorConnected = (connector: string): boolean => {
    if (credentials.byConnectorSlug[connector]?.connected) {
      return true;
    }
    // A source of the connector may hold its own linked credential (a pasted
    // key stored as a workspace api_token) rather than one on the install.
    return sources.some((s) => {
      const c = typeof s.config?._connector === 'string' ? s.config._connector : (s.kind ?? s.slug);
      return c === connector && (credentials.bySourceId[s.id]?.connected ?? false);
    });
  };

  return declaring.map((p) => {
    const steps: SetupStep[] = [
      ...p.manifest.setup.connectors.map((declared): SetupStep => {
        const options = isFamily(declared) ? [...FAMILY_KINDS[declared]] : null;
        const connector = options
          ? (options.find(connectorConnected) ?? options.find(o => sourcesByConnector.has(o)) ?? declared)
          : declared;
        const descriptor = getConnector(connector);
        const brand = descriptor?.brand;
        const sources = options && connector === declared
          ? options.flatMap(o => sourcesByConnector.get(o) ?? [])
          : sourcesByConnector.get(connector) ?? [];
        return {
          key: `connector:${declared}`,
          kind: 'connector',
          slug: connector,
          // "Connect GitHub", as the person reads it — never the slug.
          label: descriptor ? `Connect ${descriptor.name}` : options ? `Connect your ${FAMILY_LABEL[declared as ConnectorFamily]}` : `Connect ${connector}`,
          ...(brand ? { brand } : {}),
          ...(options ? { family: declared, options } : {}),
          done: options ? options.some(connectorConnected) : connectorConnected(connector),
          sources,
        };
      }),
      ...p.manifest.setup.records.map((type): SetupStep => ({
        key: `records:${type}`,
        kind: 'records',
        slug: type,
        label: `Create the first ${type.replace(/_/g, ' ')} record`,
        done: (counts[type] ?? 0) > 0,
      })),
    ];
    return { plugin: p.manifest.slug, name: p.manifest.name, complete: steps.every(s => s.done), steps };
  });
}

function isFamily(slug: string): slug is ConnectorFamily {
  return Object.hasOwn(FAMILY_KINDS, slug);
}
