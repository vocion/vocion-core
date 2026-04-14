import type { ZodType } from 'zod';
import type { AgentManifest, ContextManifest, ObjectTypeManifest, SkillManifest } from './schemas';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  AgentManifestSchema,
  ContextManifestSchema,
  ObjectTypeManifestSchema,
  SkillManifestSchema,
} from './schemas';
import { computeContextSha } from './sha';

export type LoadedAgent = AgentManifest & { resolvedSystemPrompt: string; sourceFile: string };
export type LoadedSkill = SkillManifest & { resolvedPromptTemplate: string; sourceFile: string };
export type LoadedObjectType = ObjectTypeManifest & { resolvedClassificationPrompt: string | null; sourceFile: string };

export type LoadedContext = {
  manifest: ContextManifest;
  agents: LoadedAgent[];
  skills: LoadedSkill[];
  objectTypes: LoadedObjectType[];
  sha: string;
  sourcePath: string;
  fileCount: number;
};

/**
 * Read and validate a context directory. Throws on schema violations with a clear message.
 * @param contextPath
 */
export function loadContext(contextPath: string): LoadedContext {
  const abs = resolve(contextPath);
  const manifest = loadManifest(abs);
  const files: string[] = [];

  const agents = walkDir(join(abs, 'agents'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, AgentManifestSchema, 'agent');
      const resolvedSystemPrompt = resolvePromptField(file, parsed.systemPromptFile, parsed.systemPrompt, files);
      return { ...parsed, resolvedSystemPrompt, sourceFile: file };
    });

  const skills = walkDir(join(abs, 'skills'))
    .filter(f => (basename(f) === 'skill.yaml' || basename(f) === 'skill.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, SkillManifestSchema, 'skill');
      const resolvedPromptTemplate = resolvePromptField(file, parsed.promptFile, parsed.promptTemplate, files);
      return { ...parsed, resolvedPromptTemplate, sourceFile: file };
    });

  const objectTypes = walkDir(join(abs, 'objects'))
    .filter(f => (basename(f) === 'type.yaml' || basename(f) === 'type.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, ObjectTypeManifestSchema, 'objectType');
      const resolvedClassificationPrompt = parsed.classificationPromptFile || parsed.classificationPrompt
        ? resolvePromptField(file, parsed.classificationPromptFile, parsed.classificationPrompt, files)
        : null;
      return { ...parsed, resolvedClassificationPrompt, sourceFile: file };
    });

  assertUniqueSlugs(agents, 'agent');
  assertUniqueSlugs(skills, 'skill');
  assertUniqueSlugs(objectTypes, 'object type');

  const sha = computeContextSha(abs, files);

  return {
    manifest,
    agents,
    skills,
    objectTypes,
    sha,
    sourcePath: abs,
    fileCount: files.length + 1,
  };
}

function loadManifest(abs: string): ContextManifest {
  const candidates = ['context.yaml', 'context.yml'];
  for (const c of candidates) {
    const p = join(abs, c);
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = parseYaml(raw);
      return validateOrThrow(ContextManifestSchema, parsed, p, 'context manifest');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`context manifest not found at ${abs}/context.yaml`);
}

function parseFile<T>(file: string, schema: ZodType<T>, kind: string): T {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseYaml(raw);
  return validateOrThrow(schema, parsed, file, kind);
}

function validateOrThrow<T>(schema: ZodType<T>, value: unknown, file: string, kind: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const messages = result.error.issues.map(issue => `${issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'}: ${issue.message}`);
    throw new ContextValidationError(file, kind, messages);
  }
  return result.data;
}

function resolvePromptField(sourceFile: string, promptFile: string | undefined, inline: string | undefined, filesTracked: string[]): string {
  if (promptFile) {
    const abs = resolve(dirname(sourceFile), promptFile);
    const content = readFileSync(abs, 'utf8');
    filesTracked.push(abs);
    return content.trim();
  }
  return (inline ?? '').trim();
}

function walkDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    const out: string[] = [];
    for (const e of entries) {
      const full = join(dir, e);
      const st = statSync(full);
      if (st.isDirectory()) {
        out.push(...walkDir(full));
      } else {
        out.push(full);
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function assertUniqueSlugs<T extends { slug: string }>(items: T[], kind: string): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.slug, (seen.get(item.slug) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  if (dups.length > 0) {
    throw new Error(`duplicate ${kind} slugs: ${dups.join(', ')}`);
  }
}

export class ContextValidationError extends Error {
  constructor(public readonly file: string, public readonly kind: string, public readonly issues: string[]) {
    super(`${kind} validation failed at ${file}:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ContextValidationError';
  }
}
