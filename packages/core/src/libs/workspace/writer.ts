import type { AgentManifest, MissionManifest, ObjectTypeManifest, PlaybookManifest } from './schemas';
import type { SourceKind } from './source';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  AgentManifestSchema,
  MissionManifestSchema,
  ObjectTypeManifestSchema,
  PlaybookManifestSchema,
} from './schemas';
import { sourceRelPath, validateSourceText } from './source';

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
  manifest: PlaybookManifest;
  /** The SKILL.md markdown body (below the frontmatter). */
  promptMd: string;
  /** skills/ (default) or playbooks/. */
  kind?: 'skill' | 'playbook';
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

export type WriteMissionInput = {
  contextPath: string;
  manifest: MissionManifest;
};

export type WrittenResource = {
  kind: 'skill' | 'playbook' | 'agent' | 'objectType' | 'mission';
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
  const validated = PlaybookManifestSchema.parse(input.manifest);
  const dirName = input.kind === 'playbook' ? 'playbooks' : 'skills';
  const dir = resolve(input.contextPath, dirName, slugToDirname(validated.slug));
  ensureDir(dir);
  const skillMdPath = join(dir, 'SKILL.md');
  const frontmatter = stringifyYaml(stripDefaults(validated), { lineWidth: 0 }).trimEnd();
  writeText(skillMdPath, `---\n${frontmatter}\n---\n\n${input.promptMd}`);
  return { kind: input.kind === 'playbook' ? 'playbook' : 'skill', slug: validated.slug, files: [skillMdPath] };
}

/**
 * Write a mission as `missions/<slug>.yaml` — the same manifest-in, file-out
 * shape as `writeSkill`, validated through the real schema before disk.
 * @param input
 */
export function writeMission(input: WriteMissionInput): WrittenResource {
  const validated = MissionManifestSchema.parse(input.manifest);
  const dir = resolve(input.contextPath, 'missions');
  ensureDir(dir);
  const yamlPath = join(dir, `${slugToDirname(validated.slug)}.yaml`);
  writeText(yamlPath, stringifyYaml(stripDefaults(validated), { lineWidth: 0 }));
  return { kind: 'mission', slug: validated.slug, files: [yamlPath] };
}

export type WriteSourceTextInput = {
  contextPath: string;
  kind: SourceKind;
  slug: string;
  /** The whole file, exactly as a person or an agent authored it. */
  content: string;
};

export type WrittenSourceText = WrittenResource & {
  /** Absolute path of the file written. */
  path: string;
  /** What the file held before, or null when it did not exist. */
  previous: string | null;
  /** The title the manifest gives the resource (`name`). */
  title: string;
};

/**
 * Write a mission YAML or a SKILL.md VERBATIM — comments, key order and
 * spacing kept — after validating the text through the real schema
 * (`libs/workspace/source.ts`). This is the pane's Save and an agent's edit:
 * the text a person sees is the text on disk, byte for byte. `writeMission` /
 * `writeSkill` remain the manifest-shaped door for callers that hold data
 * rather than a file.
 * @param input
 */
export function writeSourceText(input: WriteSourceTextInput): WrittenSourceText {
  const validated = validateSourceText(input.kind, input.slug, input.content);
  const path = resolve(input.contextPath, sourceRelPath(input.kind, input.slug));
  ensureDir(dirname(path));
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  writeText(path, input.content);
  return {
    kind: input.kind === 'skill' ? 'skill' : input.kind === 'playbook' ? 'playbook' : 'mission',
    slug: input.slug,
    files: [path],
    path,
    previous,
    title: validated.title,
  };
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

export function deleteResource(contextPath: string, kind: 'skill' | 'playbook' | 'agent' | 'objectType' | 'mission', slug: string): string[] {
  const removed: string[] = [];
  if (kind === 'skill' || kind === 'playbook') {
    const dir = resolve(contextPath, kind === 'skill' ? 'skills' : 'playbooks', slugToDirname(slug));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
      removed.push(dir);
    }
  } else if (kind === 'mission') {
    const file = resolve(contextPath, 'missions', `${slugToDirname(slug)}.yaml`);
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
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
