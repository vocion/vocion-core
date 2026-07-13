import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scaffold a new git-backed workspace directory: manifest, primitive
 * directories, and a tenant-facing README. The result is minimal-but-valid —
 * `loadWorkspace` accepts it as-is with zero resources.
 *
 * Pure filesystem logic; destination resolution and process exit codes are
 * the CLI wrapper's job (`scripts/scaffold-workspace.ts`).
 */

export const WORKSPACE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Primitive directories the loader reads. All optional — the loader
 * tolerates missing dirs — but scaffolding them documents the layout.
 */
export const PRIMITIVE_DIRS = [
  'agents',
  'operations',
  'playbooks',
  'workflows',
  'missions',
  'objects',
  'sources',
  'automations',
  'learnings',
] as const;

export function manifestYaml(name: string): string {
  return `version: 1
# Placeholder — resolved to the live project id at apply time via --project.
orgId: proj_${name.replace(/-/g, '_')}
name: ${name}
description: ${name} workspace
defaults:
  model: gpt-5.4-mini
  temperature: '0.3'
`;
}

export function readmeMd(name: string, applyPath: string): string {
  return `# ${name} workspace

Git-backed, version-controlled context for the \`${name}\` tenant: agent
definitions, operations (typed LLM calls), playbooks, workflows, missions,
object types, sources, automations, and learnings. Authored as YAML +
markdown, applied to the running platform's database — editing files here
changes nothing until re-applied.

## Layout

\`\`\`
${name}/
├── workspace.yaml   # manifest: orgId placeholder, name, model defaults
├── agents/          # <agent>.yaml (+ <agent>.system-prompt.md)
├── operations/      # <slug>/skill.yaml + prompt.md
├── playbooks/       # <slug>/SKILL.md (+ sibling resources)
├── workflows/       # <slug>.yaml — sequential steps with approve gates
├── missions/        # <slug>.yaml — recurring team objectives
├── objects/         # <slug>/type.yaml — business object type definitions
├── sources/         # <slug>.yaml — connector definitions (no credentials!)
├── automations/     # <slug>.yaml
└── learnings/       # rule-step buckets
\`\`\`

## Example agent

\`\`\`yaml
# agents/example-assistant.yaml
slug: example_assistant
name: Example Assistant
description: What this agent is for.
active: true
systemPromptFile: example-assistant.system-prompt.md
\`\`\`

## Applying

Validate, then sync to the database (from the vocion-core checkout):

\`\`\`bash
npm run workspace:check -- ${applyPath}
npm run workspace:apply -- ${applyPath} --project <id|slug>
\`\`\`

Long-running deployments should set \`WORKSPACE_PATH=${applyPath}\` so the
app (dashboard file views, playbook mounts, postprocess scripts) reads
from this directory.

Every apply records a \`workspace_version\` row; every run stamps the
active \`workspace_sha\` so outputs trace back to the exact prompts that
produced them. See \`docs/workspace.md\` in vocion-core for authoring
reference and validation rules.
`;
}

export type ScaffoldOptions = {
  /** Workspace name (lowercase, digits, dashes; e.g. `acme-revenue`). */
  name: string;
  /** Absolute destination directory. Must not already exist. */
  dest: string;
  /** Path shown in the README's apply instructions (defaults to `dest`). */
  applyPath?: string;
};

/**
 * Create the workspace at `opts.dest`. Throws on an invalid name or an
 * existing destination; never overwrites.
 * @param opts - name, destination directory, and optional README apply path
 */
export function scaffoldWorkspace(opts: ScaffoldOptions): void {
  const { name, dest } = opts;
  if (!WORKSPACE_NAME_RE.test(name)) {
    throw new Error(`invalid name "${name}" — use lowercase letters, digits, and dashes, starting with a letter.`);
  }
  if (existsSync(dest)) {
    throw new Error(`refusing to overwrite: ${dest} already exists.`);
  }

  mkdirSync(dest, { recursive: true });
  for (const dir of PRIMITIVE_DIRS) {
    mkdirSync(join(dest, dir));
    // git doesn't track empty directories
    writeFileSync(join(dest, dir, '.gitkeep'), '');
  }

  writeFileSync(join(dest, 'workspace.yaml'), manifestYaml(name));
  writeFileSync(join(dest, 'README.md'), readmeMd(name, opts.applyPath ?? dest));
}
