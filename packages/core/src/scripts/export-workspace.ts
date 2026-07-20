import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { stringify as stringifyYaml } from 'yaml';
import { db } from '@/libs/DB';
import { projectLeadToManifestKeys, teamRowToManifest } from '@/libs/workspace/team-export';
import { agentSchema, businessObjectTypeSchema, projectSchema, skillSchema, teamSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * One-time export: read current DB rows into workspace/<org>/ as YAML + markdown.
 * Meant to be run once per org when migrating to workspace-as-code.
 *
 * usage: npm run workspace:export -- --org <orgId> --name <dirName> [--out context]
 */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const orgId = args.org ?? process.env.SEED_ORG_ID ?? 'org_3B7f6cPKTKnJOExO55asDaUVAay';
  const name = args.name ?? 'metacto';
  const outRoot = args.out ?? 'context';
  const outDir = join(process.cwd(), outRoot, name);

  mkdirSync(outDir, { recursive: true });

  const agents = await db.select().from(agentSchema).where(eq(agentSchema.orgId, orgId));
  const skills = await db.select().from(skillSchema).where(eq(skillSchema.orgId, orgId));
  const objectTypes = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, orgId));
  const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId));
  const [project] = await db.select().from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);

  // accountable_user_id → email, for teams + the workspace default.
  const accountableIds = [
    ...teams.map(t => t.accountableUserId),
    project?.accountableUserId ?? null,
  ].filter((id): id is string => id !== null);
  const emailByUserId = new Map<string, string>(
    accountableIds.length > 0
      ? (await db.select({ id: userSchema.id, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, accountableIds)))
          .map(u => [u.id, u.email] as const)
      : [],
  );

  // workspace.yaml — workspace lead + default owner come from the project
  // row when one matches the org (workspace lead is project config).
  writeFile(join(outDir, 'workspace.yaml'), stringifyYaml({
    version: 1,
    orgId,
    name,
    description: `Exported context for ${name} on ${new Date().toISOString()}`,
    ...projectLeadToManifestKeys(
      project ?? { leadAgentSlug: null, accountableUserId: null },
      emailByUserId,
    ),
    defaults: {
      model: mode(skills.map(s => s.model ?? 'gpt-4o')),
      temperature: '0.3',
    },
  }));

  // teams/<slug>.yaml — slug is the filename; inherited accountability is
  // NOT baked in (NULL accountable_user_id exports as an absent key).
  if (teams.length > 0) {
    const teamsDir = join(outDir, 'teams');
    mkdirSync(teamsDir, { recursive: true });
    for (const t of teams) {
      writeFile(join(teamsDir, `${t.slug}.yaml`), stringifyYaml(teamRowToManifest(t, emailByUserId), { lineWidth: 0 }));
    }
  }

  // agents/<slug>.yaml + agents/<slug>.system-prompt.md
  const agentsDir = join(outDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const a of agents) {
    const promptFile = `${a.slug}.system-prompt.md`;
    writeFile(join(agentsDir, promptFile), a.systemPrompt);

    const manifest = stripNulls({
      slug: a.slug,
      name: a.name,
      description: a.description,
      icon: a.icon,
      active: a.active !== 'false',
      parent: a.parentAgentSlug ?? undefined,
      // Team membership (F1). Prefer the validated slug ref; fall back to
      // the legacy free-text label so pre-teams workspaces round-trip.
      // A lead's own team is OMITTED — apply auto-assigns it, so writing
      // it out would make the first re-apply a spurious update.
      team: teams.some(t => t.slug === a.teamSlug && t.leadAgentSlug === a.slug)
        ? undefined
        : a.teamSlug ?? a.team ?? undefined,
      // Work-mode label. Was silently dropped on export before F1, which
      // made every export→apply round-trip rewrite agentType to NULL.
      agentType: (a.agentType ?? undefined) as 'mission' | 'workflow' | 'operational' | undefined,
      model: a.model,
      temperature: a.temperature,
      systemPromptFile: promptFile,
      // Chat-UX ornaments + deepagents-runtime fields — without these an
      // export→apply round-trip silently resets them to schema defaults.
      accent: a.accent ?? undefined,
      eyebrow: a.eyebrow ?? undefined,
      suggestions: (a.suggestions ?? []).length > 0 ? a.suggestions : undefined,
      subagents: (a.subagents ?? []).length > 0 ? a.subagents : undefined,
      playbookTags: (a.playbookTags ?? []).length > 0 ? a.playbookTags : undefined,
      learningSteps: (a.learningSteps ?? []).length > 0 ? a.learningSteps : undefined,
      // Harness block — carries the execution-layer choice (BYOA
      // `provider: runtime`, agentcore, interrupts, excludeTools…).
      // Omitting this is how a round-trip would un-cut-over an agent.
      harness: Object.keys(a.harnessConfig ?? {}).length > 0 ? a.harnessConfig : undefined,
      skills: a.skillSlugs ?? [],
      connectorSources: a.connectorSources ?? [],
      objectTypes: a.objectTypeSlugs ?? [],
      documentSetIds: a.documentSetIds ?? [],
      searchConfig: a.searchConfig ?? {},
      fewShotExamples: a.fewShotExamples ?? [],
      approvalPolicy: a.approvalPolicy ?? {},
      langfuseProjectId: a.langfuseProjectId,
    });
    writeFile(join(agentsDir, `${a.slug}.yaml`), stringifyYaml(manifest, { lineWidth: 0 }));
  }

  // skills/<slug>/skill.yaml + skills/<slug>/prompt.md
  // v0.2 renamed skills/ → operations/; the loader prefers operations/
  // when both exist, so exporting to skills/ gets silently ignored in a
  // scaffolded workspace (scaffold creates operations/).
  const skillsDir = join(outDir, 'operations');
  mkdirSync(skillsDir, { recursive: true });
  for (const s of skills) {
    const skillDir = join(skillsDir, s.slug.replace(/_/g, '-'));
    mkdirSync(skillDir, { recursive: true });

    writeFile(join(skillDir, 'prompt.md'), s.promptTemplate);

    const manifest = stripNulls({
      slug: s.slug,
      name: s.name,
      description: s.description,
      category: (s.category ?? 'query') as 'query' | 'mutation' | 'composite',
      status: (s.status ?? 'active') as 'active' | 'disabled' | 'draft',
      version: s.version ?? 1,
      model: s.model,
      temperature: s.temperature,
      requiresApproval: s.requiresApproval !== 'false',
      promptFile: 'prompt.md',
      inputSchema: s.inputSchema ?? undefined,
    });
    writeFile(join(skillDir, 'skill.yaml'), stringifyYaml(manifest, { lineWidth: 0 }));
  }

  // objects/<slug>/type.yaml + objects/<slug>/classification-prompt.md
  const objectsDir = join(outDir, 'objects');
  mkdirSync(objectsDir, { recursive: true });
  for (const ot of objectTypes) {
    const otDir = join(objectsDir, ot.slug.replace(/_/g, '-'));
    mkdirSync(otDir, { recursive: true });

    let classificationPromptFile: string | undefined;
    if (ot.classificationPrompt) {
      classificationPromptFile = 'classification-prompt.md';
      writeFile(join(otDir, classificationPromptFile), ot.classificationPrompt);
    }

    const manifest = stripNulls({
      slug: ot.slug,
      label: ot.label,
      description: ot.description,
      icon: ot.icon,
      schema: ot.schema ?? undefined,
      sourceRelevance: ot.sourceRelevance ?? undefined,
      classificationPromptFile,
      fewShotExamples: ot.fewShotExamples ?? [],
    });
    writeFile(join(otDir, 'type.yaml'), stringifyYaml(manifest, { lineWidth: 0 }));
  }

  console.log(`\n✓ exported to ${outDir}`);
  console.log(`  agents: ${agents.length}`);
  console.log(`  teams: ${teams.length}`);
  console.log(`  skills: ${skills.length}`);
  console.log(`  objectTypes: ${objectTypes.length}`);
  process.exit(0);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function mode<T>(arr: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of arr) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      continue;
    }
    out[k] = v;
  }
  return out as Partial<T>;
}

function writeFile(path: string, content: string): void {
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
