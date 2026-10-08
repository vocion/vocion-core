/**
 * What an import may not change, because no workspace admin can change it in
 * the app either.
 *
 * Before imports, only an operator fed files to the loader: whoever wrote a
 * workspace folder also ran the host. An import is a workspace admin's upload,
 * and a few manifest fields reach past the workspace into the deployment:
 *
 *   - **Where an agent's loop runs.** `harness.runsOn` on AgentCore — our
 *     container, or AWS's managed harness, which an apply provisions in the
 *     operator's AWS account — or a Bedrock model, which implies the container
 *     (`authoredHarnessTarget`). The app sets none of these; an import may set
 *     `in-process` or `external-worker`, or leave an agent where it is.
 *   - **What of the server's disk a connector reads.** A connector that reads
 *     files (`hostPathConfig` on its descriptor) may be pointed at a relative
 *     path inside the folder it resolves against — and reads nothing until
 *     something is there, which the review says — but never at an absolute
 *     path or one that climbs out with `..`.
 *
 * Only what the import CHANGES is judged: an agent already on AgentCore, or a
 * connector already reading a folder, stays as it is through a merge or a
 * round trip. A refusal names the resource and the field, and what to do
 * instead: an operator applies such a workspace from its folder.
 */

import type { LoadedWorkspace } from '@/libs/workspace';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getConnector } from '@/libs/sources/registry';
import { agentSchema } from '@/models/Schema';
import { authoredHarnessTarget } from '@/services/agents/harnessTarget';

/** One field an import may not set, by the resource that sets it. */
export type ImportRefusal = { resource: 'agents' | 'sources'; slug: string; message: string };

/** Where an agent's loop may be put by an import: places that cost the deployment nothing new. */
const IMPORTABLE_TARGETS: ReadonlySet<string> = new Set(['in-process', 'external-worker']);

/**
 * What in the loaded workspace an import may not set, and the connectors it
 * points at a folder that will hold nothing (as warnings). Reads the agent rows;
 * writes nothing.
 * @param orgId - The workspace importing.
 * @param loaded - What the import would apply.
 * @param sources - This workspace's connector rows as they are now.
 */
export async function importRefusals(
  orgId: string,
  loaded: LoadedWorkspace,
  sources: ReadonlyArray<{ slug: string; kind?: string; configJson: Record<string, unknown> | null }>,
): Promise<{ refused: ImportRefusal[]; warnings: Array<{ resource: string; slug: string; message: string }> }> {
  const refused: ImportRefusal[] = [];
  const warnings: Array<{ resource: string; slug: string; message: string }> = [];

  const rows = await db.select({ slug: agentSchema.slug, harnessConfig: agentSchema.harnessConfig }).from(agentSchema).where(eq(agentSchema.orgId, orgId));
  const placedNow = new Map(rows.map(r => [r.slug, authoredHarnessTarget(r.harnessConfig as Parameters<typeof authoredHarnessTarget>[0])]));
  for (const agent of loaded.agents) {
    const target = authoredHarnessTarget(agent.harness as Parameters<typeof authoredHarnessTarget>[0]);
    if (!target || IMPORTABLE_TARGETS.has(target) || placedNow.get(agent.slug) === target) {
      continue;
    }
    const field = agent.harness?.runsOn || (agent.harness as { provider?: string } | undefined)?.provider ? `harness.runsOn "${target}"` : 'harness.modelProvider "bedrock"';
    refused.push({ resource: 'agents', slug: agent.slug, message: `${field} puts this agent's loop on the deployment's AgentCore infrastructure, which an operator chooses and an import cannot. Leave it out (or use in-process), or have an operator apply the workspace with workspace:apply.` });
  }

  const current = new Map(sources.map(s => [s.slug, s.configJson ?? {}]));
  for (const source of loaded.sources) {
    const keys = getConnector(source.kind)?.hostPathConfig ?? [];
    for (const key of keys) {
      const value = (source.config as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string' || value === current.get(source.slug)?.[key]) {
        continue;
      }
      if (leavesItsFolder(value)) {
        refused.push({ resource: 'sources', slug: source.slug, message: `config.${key} "${value}" points outside the folder this connector reads from (an absolute path, or one that climbs out with ..). An import cannot point a connector at the server's disk; an operator can, with workspace:apply.` });
      } else {
        warnings.push({ resource: 'source', slug: source.slug, message: `reads config.${key} "${value}" from this server's disk, and an import brings no files with it: it reads nothing until that folder is there. Point it at a connector that reads from where the data lives.` });
      }
    }
  }
  return { refused, warnings };
}

/**
 * Whether a connector's path names something outside the folder it is
 * resolved against: absolute (either separator, or a drive letter), or with a
 * `..` segment.
 * @param path - The path as authored.
 */
function leavesItsFolder(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path) || path.split(/[/\\]/).includes('..');
}
