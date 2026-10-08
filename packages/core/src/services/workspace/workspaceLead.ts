/**
 * The agent every shared workspace starts with: the workspace lead.
 *
 * A shared workspace gets its agents from its workspace YAML at apply, from a
 * plugin, an app template or a hire. A new one has none of those yet, and a
 * workspace with nobody in it opens on a blank chat and a link to the docs. So
 * core seeds one generic agent — `templates/workspace/agents/workspace-lead.yaml`
 * — and the skill it sets the workspace up with
 * (`templates/workspace/skills/workspace-setup/SKILL.md`), the same way a
 * personal workspace gets its assistant (`personalAssistant.ts`).
 *
 * Seeded only into a shared workspace with NO agent at all. A workspace that
 * already has a team — authored, hired or retired — is never given a second
 * lead it did not ask for. The rows are written once and then belong to the
 * workspace: a voice someone sets, a cap an admin puts on it, an edited prompt
 * survive every later call, and a template change reaches new workspaces only
 * (the same contract a hire from the catalog has).
 *
 * Called when a workspace is created (`src/scripts/create-local-user.ts`,
 * `setup-local-projects.ts`) and lazily wherever a chat surface loads its
 * roster (`loadChatAgentContext`) or a turn finds none (the stream route), so a
 * workspace made before this existed heals the first time someone opens chat.
 */

import type { AgentManifest, PlaybookManifest } from '@/libs/workspace/schemas';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { AgentManifestSchema, PlaybookManifestSchema } from '@/libs/workspace/schemas';
import { splitFrontmatter } from '@/libs/workspace/source';
import { agentSchema, playbookSchema, projectSchema } from '@/models/Schema';

/** Where the templates live, relative to the repo root (shipped by `outputFileTracingIncludes`'s `templates/**`). */
export const WORKSPACE_SEED_REL = 'packages/core/templates/workspace';
const LEAD_REL = `${WORKSPACE_SEED_REL}/agents/workspace-lead.yaml`;

let cachedLead: AgentManifest | null = null;
let cachedSkill: { manifest: PlaybookManifest; body: string } | null = null;

/**
 * The lead as the template authors it, validated by the schema every
 * workspace agent goes through. Read once per process.
 */
export function workspaceLeadTemplate(): AgentManifest {
  if (!cachedLead) {
    const raw = parseYaml(readFileSync(/* turbopackIgnore: true */ fromRepoRoot(LEAD_REL), 'utf8'));
    cachedLead = AgentManifestSchema.parse(raw);
  }
  return cachedLead;
}

/**
 * The setup skill the lead mounts, validated by the schema every SKILL.md
 * goes through. Read once per process.
 */
export function workspaceSetupSkillTemplate(): { manifest: PlaybookManifest; body: string } {
  if (!cachedSkill) {
    const slug = workspaceLeadTemplate().skills[0];
    if (!slug) {
      throw new Error(`${LEAD_REL} names no skill — the workspace lead sets the workspace up with one`);
    }
    const file = fromRepoRoot(`${WORKSPACE_SEED_REL}/skills/${slug}/SKILL.md`);
    const { data, body } = splitFrontmatter(readFileSync(/* turbopackIgnore: true */ file, 'utf8'));
    cachedSkill = { manifest: PlaybookManifestSchema.parse(data), body };
  }
  return cachedSkill;
}

/**
 * The agent row the template becomes — the fields `workspace:apply` writes for
 * an authored agent, minus what a new workspace has none of (teams, parents,
 * sources, object types).
 * @param projectId - The workspace.
 */
function leadRow(projectId: string): typeof agentSchema.$inferInsert {
  const a = workspaceLeadTemplate();
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
 * The skill's catalog row. `origin: 'core'` is what tells the mount and the
 * Skills page to read its body from the shipped template rather than from a
 * workspace folder this workspace may not have (`services/playbooks/mount.ts`).
 * @param projectId - The workspace.
 */
function skillRow(projectId: string): typeof playbookSchema.$inferInsert {
  const { manifest, body } = workspaceSetupSkillTemplate();
  return {
    orgId: projectId,
    projectId,
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    kind: 'skill',
    origin: 'core',
    attachedPlaybooks: manifest.playbooks,
    frontmatter: { slug: manifest.slug, name: manifest.name, description: manifest.description, playbooks: manifest.playbooks, version: manifest.version },
    contentSha: createHash('sha256').update(body, 'utf8').digest('hex'),
    sourceFiles: [],
    version: manifest.version,
  };
}

/**
 * Give a shared workspace with no agents its workspace lead, and make it the
 * workspace's lead. Idempotent and safe under concurrent calls: both inserts
 * lose quietly to an existing row (`agent_org_slug_idx`,
 * `playbook_org_slug_idx`), and the lead is only set where none is.
 *
 * Tenant-scoped by construction: every read and write is keyed on this one
 * project id, and nothing is written to a personal workspace (it has its own
 * assistant) or to a workspace that already has any agent.
 * @param projectId - The workspace.
 * @returns True when this call found the workspace empty and seeded it.
 */
export async function ensureWorkspaceLead(projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ kind: projectSchema.kind, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  if (!project || project.kind === 'personal') {
    return false;
  }
  const [agents] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, projectId));
  if (Number(agents?.n ?? 0) > 0) {
    return false;
  }
  await db.insert(playbookSchema).values(skillRow(projectId)).onConflictDoNothing();
  await db.insert(agentSchema).values(leadRow(projectId)).onConflictDoNothing();
  if (!project.leadAgentSlug) {
    await db
      .update(projectSchema)
      .set({ leadAgentSlug: workspaceLeadTemplate().slug })
      .where(and(eq(projectSchema.id, projectId), isNull(projectSchema.leadAgentSlug)));
  }
  return true;
}
