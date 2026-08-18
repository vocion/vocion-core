#!/usr/bin/env tsx
/**
 * Run the discovery-call detection sweep from the CLI — the cron/ops entrypoint
 * for ticket 011. Resolves the project's org, reads the workspace-authored
 * parameters, and runs the funnel. The privacy gate lives in the service; this
 * only passes the workspace configuration through.
 *
 * Usage:
 *   npm run discovery:sweep -- --project metacto-revenue
 *   npm run discovery:sweep -- --project <id|slug> --config <path/to/sweep.yaml>
 *
 * Config defaults to `$WORKSPACE_PATH/discovery/sweep.yaml`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { eq, or } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { runSweep } from '@/services/DiscoveryDetectionService';

const configSchema = z.object({
  sellerDomain: z.string().min(1),
  eligible: z
    .object({
      ownerIds: z.array(z.string()).optional(),
      lifecycleStages: z.array(z.string()).optional(),
      dealStages: z.array(z.string()).optional(),
    })
    .default({}),
  sinceDays: z.number().positive().default(3),
  thresholds: z
    .object({ discovery: z.number().min(0).max(1), ready: z.number().min(0).max(1) })
    .default({ discovery: 0.6, ready: 0.75 }),
  supervised: z.boolean().default(true),
});

function parseArgs(argv: string[]): { project?: string; config?: string } {
  const out: { project?: string; config?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--project') {
      out.project = argv[++i];
    } else if (a === '--config') {
      out.config = argv[++i];
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error('Usage: discovery:sweep --project <id|slug> [--config <path>]');
    process.exit(1);
  }

  const configPath = args.config
    ?? path.join(process.env.WORKSPACE_PATH ?? '../workspace/metacto-revenue', 'discovery/sweep.yaml');
  if (!fs.existsSync(configPath)) {
    console.error(`No sweep config at ${configPath}. Pass --config <path>.`);
    process.exit(1);
  }
  const cfg = configSchema.parse(parseYaml(fs.readFileSync(configPath, 'utf8')));

  const [project] = await db
    .select({ id: projectSchema.id, name: projectSchema.name })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, args.project), eq(projectSchema.slug, args.project)))
    .limit(1);
  if (!project) {
    console.error(`No project matches "${args.project}".`);
    process.exit(1);
  }

  const result = await runSweep(project.id, {
    eligible: cfg.eligible,
    sellerDomain: cfg.sellerDomain,
    sinceDays: cfg.sinceDays,
    discoveryThreshold: cfg.thresholds.discovery,
    readyThreshold: cfg.thresholds.ready,
    supervised: cfg.supervised,
  });

  console.log(`discovery sweep · project ${project.id} (${project.name})`);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
