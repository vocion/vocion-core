/**
 * npm run migrate:automations -- <folder>... [--write] [--localize]
 * npm run migrate:automations -- --core-templates [--write]
 *
 * Moves workspaces, plugins and template folders to the 8.0 form (ADR 0008,
 * docs/deploy/migrating-8.md). Prints a diff and changes nothing unless
 * --write. Running it twice plans nothing the second time.
 */

import type { ForeignAutomation, MigrationEdit } from '@/libs/workspace/migrateAutomations';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { unifiedLineDiff } from '@/libs/workspace/lineDiff';
import { loadWorkspace } from '@/libs/workspace/loader';
import { planMigration } from '@/libs/workspace/migrateAutomations';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'write': { type: 'boolean', default: false },
    'localize': { type: 'boolean', default: false },
    'core-templates': { type: 'boolean', default: false },
    'help': { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || (positionals.length === 0 && !values['core-templates'])) {
  console.log('usage: npm run migrate:automations -- <workspace|plugin folder>... [--write] [--localize]\n       npm run migrate:automations -- --core-templates [--write]\n\nPrints the diff; --write applies it. See docs/deploy/migrating-8.md.');
  process.exit(0);
}

/** Core's own folders that carry automations or missions. */
function coreTemplateFolders(): string[] {
  const root = resolve(__dirname, '../../templates');
  const children = (p: string) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => join(p, d.name)) : []);
  return [
    ...children(join(root, 'plugins')),
    ...children(join(root, 'workspaces')),
    ...children(join(root, 'apps/company/templates')).map(d => join(d, 'files')),
  ].filter(d => existsSync(join(d, 'automations')) || existsSync(join(d, 'missions')));
}

/**
 * The plugins' automations a workspace composes, for the planner's "already kept" check.
 * @param dir - The workspace.
 */
function foreignAutomations(dir: string): ForeignAutomation[] {
  if (!existsSync(join(dir, 'workspace.yaml'))) {
    return [];
  }
  try {
    return loadWorkspace(dir).automations.filter(a => !a.sourceFile.startsWith(dir)).map(a => ({ slug: a.slug, schedule: a.when.schedule, checkMission: a.do.checkMission, active: a.status !== 'disabled', text: readFileSync(a.sourceFile, 'utf8') }));
  } catch (err) {
    console.warn(`  (could not load ${dir} to read its plugins' automations: ${(err as Error).message.split('\n')[0]})`);
    return [];
  }
}

function apply(edit: MigrationEdit): void {
  if (edit.after === null) {
    unlinkSync(edit.path);
    return;
  }
  mkdirSync(dirname(edit.path), { recursive: true });
  writeFileSync(edit.path, edit.after);
}

const folders = values['core-templates'] ? coreTemplateFolders() : positionals.map(p => resolve(p));
let total = 0;
for (const dir of folders) {
  const plan = planMigration(dir, { foreign: foreignAutomations(dir), localize: values.localize });
  if (plan.edits.length === 0 && plan.notes.length === 0) {
    continue;
  }
  console.log(`\n=== ${dir}`);
  for (const edit of plan.edits) {
    const label = edit.before === null ? 'new' : edit.after === null ? 'deleted' : 'changed';
    console.log(`\n--- ${edit.path} (${label})`);
    console.log(unifiedLineDiff(edit.before ?? '', edit.after ?? '', { context: 2 }));
    if (values.write) {
      apply(edit);
    }
  }
  for (const note of plan.notes) {
    console.log(`  • ${note}`);
  }
  total += plan.edits.length;
}
console.log(`\n${total} file${total === 1 ? '' : 's'} ${values.write ? 'written' : 'would change (dry run; pass --write to apply)'}.`);
