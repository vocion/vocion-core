#!/usr/bin/env tsx
/**
 * Manual escape hatch to run the discovery-call detection sweep now (ticket 011).
 * It fires the `discovery-sweep` automation, so it uses the exact same code path
 * and parameters (the automation's `do.input`) as the scheduled hourly run —
 * there is no separate config to drift. The scheduled run is the normal path;
 * this is for a one-off / debugging.
 *
 * Usage: npm run discovery:sweep -- --project metacto-revenue [--day 2026-08-12] [--dry-run]
 *
 * `--day` / `--dry-run` are the same overrides the dashboard's Test run sends,
 * so the CLI and the button exercise identical behaviour.
 */
import process from 'node:process';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { fireAutomation } from '@/services/AutomationService';

function parseArgs(argv: string[]): { project?: string; day?: string; dryRun?: boolean } {
  const out: { project?: string; day?: string; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      out.project = argv[++i];
    } else if (argv[i] === '--day') {
      out.day = argv[++i];
    } else if (argv[i] === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error('Usage: discovery:sweep --project <id|slug>');
    process.exit(1);
  }

  const [project] = await db
    .select({ id: projectSchema.id, name: projectSchema.name })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, args.project), eq(projectSchema.slug, args.project)))
    .limit(1);
  if (!project) {
    console.error(`No project matches "${args.project}".`);
    process.exit(1);
  }

  const input: Record<string, unknown> = {};
  if (args.day) {
    input.day = args.day;
  }
  if (args.dryRun) {
    input.dryRun = true;
  }

  const res = await fireAutomation(project.id, 'discovery-sweep', {
    input,
    invokedBy: 'cli:discovery-sweep',
    dryRun: args.dryRun,
  });
  console.log(`discovery sweep · project ${project.id} (${project.name})`);
  console.log(`automation_run #${res.automationRunId}${args.dryRun ? ' (dry run)' : ''}`);
  console.log(JSON.stringify(res.result ?? res, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
