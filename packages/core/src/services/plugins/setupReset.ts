/**
 * RESET A PLUGIN'S SETUP — so onboarding can be run again from nothing.
 *
 * The plugin's `setup:` declaration is the whole definition of what is undone
 * (services/plugins/setupState.ts reads the same declaration to say what is
 * done): every connector it names is disconnected, every record of a type it
 * names is deleted with the artifacts filed on it, and every proposal still
 * waiting to create one of those records is rejected. Nothing else is
 * touched: the sources stay (they are the workspace's), the agents, missions
 * and trust rules stay, the conversations stay. Afterwards the setup chip is
 * back in chat, and the next setup turn starts where the first one did.
 *
 * Asked for by Jamie (2026-10-07) while iterating on the factory's onboarding:
 * "I need a button to wipe the integration so we can retest the onboarding
 * process." Admin-only at the router; this service trusts its caller.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { loadPlugin } from '@/libs/workspace/plugins';
import { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
import { rejectAction } from '@/services/ActionService';
import { revokeLivePlatformCredentials } from '@/services/ApiTokenService';
import { deleteArtifact, listArtifactsForRecord } from '@/services/ArtifactService';
import { deleteBusinessObject } from '@/services/BusinessObjectService';

export type SetupResetResult = {
  plugin: string;
  /** Connector slugs whose live credentials were revoked, with how many rows each. */
  disconnected: Array<{ connector: string; credentials: number }>;
  /** Records deleted, by type slug, and the artifacts that went with them. */
  deleted: Array<{ type: string; records: number; artifacts: number }>;
  /** Proposals that would have created one of those records, now rejected. */
  rejected: number;
};

/**
 * Undo a plugin's setup in one org. Throws when the plugin declares no setup:
 * there is nothing to reset, and a button that does nothing is a lie.
 * @param input - Tenant, plugin, and who asked (written on the rejected proposals).
 * @param input.orgId - Tenant.
 * @param input.pluginSlug - The plugin whose `setup:` says what to undo.
 * @param input.actor - `user:<id>`, for the audit on each rejected proposal.
 */
export async function resetSetup(input: { orgId: string; pluginSlug: string; actor: string }): Promise<SetupResetResult> {
  const { manifest } = loadPlugin(input.pluginSlug);
  const setup = manifest.setup;
  if (setup.connectors.length === 0 && setup.records.length === 0) {
    throw new Error(`plugin "${input.pluginSlug}" declares no setup, so there is nothing to reset`);
  }

  // Connectors: the install-level credential (an app installation, a vendor
  // login stored on the connector, a pasted key) and any workspace credential
  // of the connector's platform. Revoked, never deleted: the row says when and
  // the connect flow treats a revoked credential as not connected.
  const disconnected: SetupResetResult['disconnected'] = [];
  for (const connector of setup.connectors) {
    const installs = await db
      .select({ id: sourceInstallSchema.id })
      .from(sourceInstallSchema)
      .where(and(eq(sourceInstallSchema.orgId, input.orgId), eq(sourceInstallSchema.sourceSlug, connector)));
    let credentials = 0;
    if (installs.length > 0) {
      const rows = await db
        .update(sourceCredentialSchema)
        .set({ revokedAt: new Date() })
        .where(and(inArray(sourceCredentialSchema.installId, installs.map(i => i.id)), isNull(sourceCredentialSchema.revokedAt)))
        .returning({ id: sourceCredentialSchema.id });
      credentials += rows.length;
    }
    const platform = platformForConnectorSlug(connector);
    if (platform) {
      credentials += (await revokeLivePlatformCredentials(input.orgId, platform.id)).length;
    }
    disconnected.push({ connector, credentials });
  }

  // Records: every record of each named type, with the artifacts filed on it
  // (a product's architecture diagram, a repo's map), gone.
  const deleted: SetupResetResult['deleted'] = [];
  if (setup.records.length > 0) {
    const types = await db
      .select({ id: businessObjectTypeSchema.id, slug: businessObjectTypeSchema.slug })
      .from(businessObjectTypeSchema)
      .where(and(eq(businessObjectTypeSchema.orgId, input.orgId), inArray(businessObjectTypeSchema.slug, [...setup.records])));
    for (const type of types) {
      const records = await db
        .select({ id: businessObjectSchema.id })
        .from(businessObjectSchema)
        .where(and(eq(businessObjectSchema.orgId, input.orgId), eq(businessObjectSchema.typeId, type.id)));
      let artifacts = 0;
      for (const record of records) {
        const attached = await listArtifactsForRecord({ orgId: input.orgId, record: { type: 'object', id: String(record.id) } });
        for (const artifact of attached) {
          await deleteArtifact({ orgId: input.orgId, id: artifact.id });
          artifacts += 1;
        }
        await deleteBusinessObject(record.id, input.orgId);
      }
      deleted.push({ type: type.slug, records: records.length, artifacts });
    }
  }

  // Proposals still waiting to create one of those records: rejected, with
  // the reason on the run, so the queue does not keep offering a record of a
  // setup that was wiped.
  let rejected = 0;
  if (setup.records.length > 0) {
    const pending = await db
      .select({ id: actionRunSchema.id })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, input.orgId),
        eq(actionRunSchema.status, 'pending'),
        sql`${actionRunSchema.actionId} like 'objects.propose_candidate%'`,
        sql`${actionRunSchema.input}->>'objectType' in (${sql.join(setup.records.map(t => sql`${t}`), sql`, `)})`,
      ));
    for (const run of pending) {
      await rejectAction(run.id, input.orgId, `setup of ${manifest.name} was reset`, { reviewedBy: input.actor });
      rejected += 1;
    }
  }

  return { plugin: input.pluginSlug, disconnected, deleted, rejected };
}
