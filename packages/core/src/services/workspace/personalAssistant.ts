/**
 * The agent every personal workspace starts with: the person's own assistant.
 *
 * A shared workspace gets its agents from its workspace YAML at apply. A
 * personal workspace has none — nobody authors it, and there is one for every
 * person on every account — so its agent is a core template
 * (`templates/personal/agents/assistant.yaml`), written into the workspace here.
 *
 * Why here and not a `workspace:apply` of a template directory: an apply owns
 * the workspace afterwards. It replaces plugins, sweeps rows the YAML no longer
 * names and records a workspace version, and a personal workspace is going to
 * hold the person's own things (their mail, their notes) that no template
 * names. Seeding one agent row, once, owns nothing but that row.
 *
 * The row is written once and then left alone: a voice the person sets, a cap
 * an admin puts on it, an instruction it learns, survive every later call.
 * Changing the template therefore reaches new workspaces only, which is the
 * same contract a hired agent from the catalogue has.
 *
 * Called from `ensurePersonalProject` (sign-in, sign-up, invite accept) and
 * lazily from the chat stream when a personal workspace has no agent yet, so a
 * workspace made before this existed heals on its first turn.
 */

import type { AgentManifest } from '@/libs/workspace/schemas';
import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { AgentManifestSchema } from '@/libs/workspace/schemas';
import { agentSchema, projectSchema } from '@/models/Schema';

/** Where the template lives, relative to the repo root (shipped by `outputFileTracingIncludes`'s `templates/**`). */
const TEMPLATE_REL = 'packages/core/templates/personal/agents/assistant.yaml';

let cached: AgentManifest | null = null;

/**
 * The assistant as the template authors it, validated by the schema every
 * workspace agent goes through. Read once per process.
 */
export function personalAssistantTemplate(): AgentManifest {
  if (!cached) {
    const raw = parseYaml(readFileSync(/* turbopackIgnore: true */ fromRepoRoot(TEMPLATE_REL), 'utf8'));
    cached = AgentManifestSchema.parse(raw);
  }
  return cached;
}

/** The assistant's slug — what a personal workspace's lead points at. */
export function personalAssistantSlug(): string {
  return personalAssistantTemplate().slug;
}

/**
 * The agent row the template becomes. The same fields `workspace:apply` writes
 * for an authored agent, minus everything a personal workspace has none of
 * (teams, parents, sources, object types).
 * @param projectId - The personal workspace.
 */
function assistantRow(projectId: string): typeof agentSchema.$inferInsert {
  const a = personalAssistantTemplate();
  return {
    orgId: projectId,
    projectId,
    slug: a.slug,
    name: a.name,
    description: a.description ?? null,
    systemPrompt: a.systemPrompt ?? '',
    temperature: String(a.temperature ?? '0.3'),
    voice: a.voice ?? null,
    skillSlugs: a.skills,
    playbookSlugs: a.playbooks,
    connectorSources: a.connectorSources,
    objectTypeSlugs: a.objectTypes,
    harnessConfig: a.harness,
    suggestions: a.suggestions,
    accent: a.accent ?? null,
    eyebrow: a.eyebrow ?? null,
    icon: a.icon ?? null,
    handles: a.handles,
    initiative: a.initiative,
    active: String(a.active),
    role: 'lead',
    agentType: a.agentType ?? null,
  };
}

/**
 * Give a personal workspace its assistant and make it the workspace's lead.
 * Idempotent and safe under concurrent calls: the insert loses quietly to an
 * existing row (`agent_org_slug_idx`), and the lead is only set where none is.
 *
 * Writes nothing to a shared workspace, whatever it is handed: only a row with
 * `kind = 'personal'` gets an assistant.
 * @param projectId - The workspace.
 * @returns True when the workspace is personal and now has its assistant.
 */
export async function ensurePersonalAssistant(projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ kind: projectSchema.kind, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  if (!project || project.kind !== 'personal') {
    return false;
  }
  const slug = personalAssistantSlug();
  await db.insert(agentSchema).values(assistantRow(projectId)).onConflictDoNothing();
  if (!project.leadAgentSlug) {
    await db
      .update(projectSchema)
      .set({ leadAgentSlug: slug })
      .where(and(eq(projectSchema.id, projectId), isNull(projectSchema.leadAgentSlug)));
  }
  return true;
}
