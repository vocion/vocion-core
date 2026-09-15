import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { MEASURE_WINDOWS, MeasureSourceSchema, SlugSchema } from '@/libs/workspace/schemas';
import { invalidateChipCache } from '@/services/chat/synthesis';
import { planWorkforceConfig, trace } from '@/services/team-report';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';
import { workspacePathForProject } from './Workspace';

/**
 * Team-report routes (`router.teamReport.*`) — the outcome lineage sheet and
 * the guided "Configure workforce" form behind the setup state
 * (docs/specs/team-report-v2.md §10–§11, "Outcome lineage").
 *
 * Reading lineage is open to every member: it is the evidence behind a
 * number already on the page. Planning the configuration is open too (it
 * writes nothing — it shows the YAML the form would produce). Applying it
 * is admin-only, and goes through the same loadWorkspace → applyWorkspace
 * pipeline as every other apply, so the dashboard and the files agree.
 */

const LineageInput = z.object({
  teamSlug: SlugSchema,
  measureKey: SlugSchema,
});

const ConfigureInputSchema = z.object({
  goal: z.string().max(500).optional(),
  teams: z.array(z.object({
    slug: SlugSchema,
    mission: z.string().max(500).optional(),
    measure: z.object({
      label: z.string().min(1).max(120),
      key: z.string().max(80).optional(),
      target: z.number().positive(),
      unit: z.string().max(20).optional(),
      window: z.enum(MEASURE_WINDOWS).optional(),
      source: MeasureSourceSchema,
    }).optional(),
  })).max(50),
});

export const lineageRoute = os
  .input(LineageInput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const funnel = await trace(orgId, input.teamSlug, input.measureKey);
    if (!funnel) {
      throw ApiError.notFound(`No measure ${input.measureKey} on team ${input.teamSlug}`);
    }
    return funnel;
  });

/**
 * Read the files the plan edits, from the project's workspace folder on
 * this host. Null when the host has no folder for the project — the plan
 * still renders, as YAML to copy.
 * @param projectId
 * @param teamSlugs
 */
async function readExisting(projectId: string, teamSlugs: string[]): Promise<{ base: string; workspaceYaml: string | null; teamYaml: Map<string, string | null> } | null> {
  const path = await workspacePathForProject(projectId);
  if (!path) {
    return null;
  }
  const base = fromRepoRoot(path);
  if (!existsSync(base)) {
    return null;
  }
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
  return {
    base,
    workspaceYaml: read(join(base, 'workspace.yaml')),
    teamYaml: new Map(teamSlugs.map(slug => [slug, read(join(base, 'teams', `${slug}.yaml`))])),
  };
}

function planOrThrow(input: z.infer<typeof ConfigureInputSchema>, existing: { workspaceYaml: string | null; teamYaml: Map<string, string | null> }) {
  try {
    return planWorkforceConfig(input, existing);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw ApiError.badRequest(err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    throw err;
  }
}

export const planConfigRoute = os
  .input(ConfigureInputSchema)
  .handler(async ({ input }) => {
    const { projectId } = await guardAuth();
    const existing = await readExisting(projectId!, input.teams.map(t => t.slug));
    const files = planOrThrow(input, existing ?? { workspaceYaml: null, teamYaml: new Map() });
    return { files, canApply: existing !== null };
  });

export const applyConfigRoute = os
  .input(ConfigureInputSchema)
  .handler(async ({ input }) => {
    const ctx = await guardAuth();
    if (!ctx.has({ role: 'org:admin' })) {
      throw ApiError.forbidden();
    }
    const existing = await readExisting(ctx.projectId!, input.teams.map(t => t.slug));
    if (!existing) {
      throw new ORPCError('NOT_FOUND', { message: 'This host has no workspace folder for the project, so the change cannot be written here. Copy the YAML into the workspace repo instead.' });
    }
    const files = planOrThrow(input, existing);
    const written: string[] = [];
    for (const f of files) {
      if (f.unchanged) {
        continue;
      }
      // Paths are built here from validated slugs — `teams/<slug>.yaml` and
      // `workspace.yaml` — never from caller-supplied paths.
      const abs = join(existing.base, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.after, 'utf-8');
      written.push(f.path);
    }
    let applied: { sha: string | null; errors: { resource: string; slug: string; message: string }[] } = { sha: null, errors: [] };
    if (written.length > 0) {
      try {
        const loaded = loadWorkspace(await workspacePathForProject(ctx.projectId!) as string);
        const result = await applyWorkspace(loaded, { orgId: ctx.orgId, appliedBy: 'team-report-configure' });
        invalidateCurrentContextShaCache();
        invalidateChipCache(ctx.orgId);
        applied = { sha: loaded.sha, errors: result.errors };
      } catch (err) {
        throw new ORPCError('APPLY_FAILED', { message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { files, written, applied };
  });
