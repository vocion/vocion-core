import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { stringify as stringifyYaml } from 'yaml';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectTypeSchema, skillSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * One-time export: read current DB rows into context/<org>/ as YAML + markdown.
 * Meant to be run once per org when migrating to context-as-code.
 *
 * usage: npm run context:export -- --org <orgId> --name <dirName> [--out context]
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

  // context.yaml
  writeFile(join(outDir, 'context.yaml'), stringifyYaml({
    version: 1,
    orgId,
    name,
    description: `Exported context for ${name} on ${new Date().toISOString()}`,
    defaults: {
      model: mode(skills.map(s => s.model ?? 'gpt-4o')),
      temperature: '0.3',
    },
  }));

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
      model: a.model,
      temperature: a.temperature,
      systemPromptFile: promptFile,
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
  const skillsDir = join(outDir, 'skills');
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
