import type { AgentManifest, ObjectTypeManifest, SkillManifest } from './schemas';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  AgentManifestSchema,
  ObjectTypeManifestSchema,
  SkillManifestSchema,
} from './schemas';

/**
 * File-level authoring API for workspace repos.
 *
 * Writes YAML + markdown to the right paths and validates input against
 * the public Zod schemas before touching disk. Intended to be driven by
 * MCP tools, onboarding flows, or any other "write a skill" producer.
 *
 * This module does NOT apply to the DB or commit to git — chain with
 * `applyWorkspace` and `autoCommit` for the full loop.
 */

export type WriteSkillInput = {
  contextPath: string;
  manifest: SkillManifest;
  promptMd: string;
};

export type WriteAgentInput = {
  contextPath: string;
  manifest: AgentManifest;
  systemPromptMd: string;
};

export type WriteObjectTypeInput = {
  contextPath: string;
  manifest: ObjectTypeManifest;
  classificationPromptMd?: string;
};

export type WrittenResource = {
  kind: 'skill' | 'agent' | 'objectType';
  slug: string;
  files: string[];
};

/**
 * Convert DB-style slug (underscores) → directory-style slug (dashes).
 * @param slug
 */
export function slugToDirname(slug: string): string {
  return slug.replace(/_/g, '-');
}

export function writeSkill(input: WriteSkillInput): WrittenResource {
  const validated = SkillManifestSchema.parse({
    ...input.manifest,
    promptFile: 'prompt.md',
    promptTemplate: undefined,
  });
  const dir = resolve(input.contextPath, 'skills', slugToDirname(validated.slug));
  ensureDir(dir);
  const promptPath = join(dir, 'prompt.md');
  const yamlPath = join(dir, 'skill.yaml');
  writeText(promptPath, input.promptMd);
  writeText(yamlPath, stringifyYaml(stripDefaults(validated), { lineWidth: 0 }));
  return { kind: 'skill', slug: validated.slug, files: [yamlPath, promptPath] };
}

export function writeAgent(input: WriteAgentInput): WrittenResource {
  const validated = AgentManifestSchema.parse({
    ...input.manifest,
    systemPromptFile: `${input.manifest.slug}.system-prompt.md`,
    systemPrompt: undefined,
  });
  const dir = resolve(input.contextPath, 'agents');
  ensureDir(dir);
  const promptPath = join(dir, `${validated.slug}.system-prompt.md`);
  const yamlPath = join(dir, `${validated.slug}.yaml`);
  writeText(promptPath, input.systemPromptMd);
  writeText(yamlPath, stringifyYaml(stripDefaults(validated), { lineWidth: 0 }));
  return { kind: 'agent', slug: validated.slug, files: [yamlPath, promptPath] };
}

export function writeObjectType(input: WriteObjectTypeInput): WrittenResource {
  const classificationPromptFile = input.classificationPromptMd ? 'classification-prompt.md' : undefined;
  const validated = ObjectTypeManifestSchema.parse({
    ...input.manifest,
    classificationPromptFile,
    classificationPrompt: undefined,
  });
  const dir = resolve(input.contextPath, 'objects', slugToDirname(validated.slug));
  ensureDir(dir);
  const yamlPath = join(dir, 'type.yaml');
  const files = [yamlPath];

  if (input.classificationPromptMd) {
    const promptPath = join(dir, 'classification-prompt.md');
    writeText(promptPath, input.classificationPromptMd);
    files.push(promptPath);
  }

  writeText(yamlPath, stringifyYaml(stripDefaults(validated), { lineWidth: 0 }));
  return { kind: 'objectType', slug: validated.slug, files };
}

export function deleteResource(contextPath: string, kind: 'skill' | 'agent' | 'objectType', slug: string): string[] {
  const removed: string[] = [];
  if (kind === 'skill') {
    const dir = resolve(contextPath, 'skills', slugToDirname(slug));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
      removed.push(dir);
    }
  } else if (kind === 'agent') {
    const base = resolve(contextPath, 'agents');
    for (const name of [`${slug}.yaml`, `${slug}.yml`, `${slug}.system-prompt.md`]) {
      const p = join(base, name);
      if (existsSync(p)) {
        rmSync(p);
        removed.push(p);
      }
    }
  } else {
    const dir = resolve(contextPath, 'objects', slugToDirname(slug));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
      removed.push(dir);
    }
  }
  return removed;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  } else if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
}

function writeText(path: string, content: string): void {
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
}

/**
 * Strip empty defaults before writing so the on-disk YAML stays minimal —
 * `fewShotExamples: []` and similar don't round-trip as changes on re-apply.
 * @param obj
 */
function stripDefaults<T extends Record<string, unknown>>(obj: T): Partial<T> {
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
