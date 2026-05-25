import type { ZodType } from 'zod';
import type { AgentManifest, ContextManifest, EvalDatasetManifest, LearningStepManifest, ObjectTypeManifest, PlaybookManifest, SkillManifest, WorkflowManifest } from './schemas';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import {
  AgentManifestSchema,
  ContextManifestSchema,
  EvalDatasetManifestSchema,
  LearningStepManifestSchema,
  ObjectTypeManifestSchema,
  PlaybookManifestSchema,
  SkillManifestSchema,
  WorkflowManifestSchema,
} from './schemas';
import { computeContextSha } from './sha';

export type LoadedAgent = AgentManifest & {
  resolvedSystemPrompt: string;
  resolvedSubagents: Array<{
    name: string;
    description: string;
    systemPrompt: string;
    tools?: string[];
    model?: string;
  }>;
  sourceFile: string;
};
export type LoadedSkill = SkillManifest & { resolvedPromptTemplate: string; sourceFile: string };
export type LoadedObjectType = ObjectTypeManifest & { resolvedClassificationPrompt: string | null; sourceFile: string };
export type LoadedWorkflow = WorkflowManifest & { sourceFile: string };

export type LoadedLearningStep = LearningStepManifest & { sourceFile: string };
export type LoadedEvalDataset = EvalDatasetManifest & { sourceFile: string };

export type LoadedPlaybook = PlaybookManifest & {
  /** Markdown body (everything after the YAML frontmatter). */
  body: string;
  /** SHA-256 of the body (not the frontmatter). */
  contentSha: string;
  /** Sibling resource paths, relative to the playbook folder. */
  sourceFiles: string[];
  /** Absolute path of the SKILL.md file. */
  sourceFile: string;
};

export type LoadedContext = {
  manifest: ContextManifest;
  agents: LoadedAgent[];
  skills: LoadedSkill[];
  objectTypes: LoadedObjectType[];
  workflows: LoadedWorkflow[];
  playbooks: LoadedPlaybook[];
  learningSteps: LoadedLearningStep[];
  evalDatasets: LoadedEvalDataset[];
  sha: string;
  sourcePath: string;
  fileCount: number;
};

/**
 * Read and validate a context directory. Throws on schema violations with a clear message.
 * @param contextPath
 */
export function loadContext(contextPath: string): LoadedContext {
  const abs = resolve(contextPath.startsWith('/') ? contextPath : fromRepoRoot(contextPath));
  const manifest = loadManifest(abs);
  const files: string[] = [];

  const agents = walkDir(join(abs, 'agents'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, AgentManifestSchema, 'agent');
      const resolvedSystemPrompt = resolvePromptField(file, parsed.systemPromptFile, parsed.systemPrompt, files);
      // Resolve each subagent's systemPrompt — either inline or from a sibling file.
      const resolvedSubagents = parsed.subagents.map(s => ({
        name: s.name,
        description: s.description,
        systemPrompt: resolvePromptField(file, s.systemPromptFile, s.systemPrompt, files),
        tools: s.tools,
        model: s.model,
      }));
      return { ...parsed, resolvedSystemPrompt, resolvedSubagents, sourceFile: file };
    });

  // v0.2: prefer context/<org>/operations/. Fall back to skills/ for
  // back-compat with v0.1 layouts. If both exist, operations wins and
  // skills is ignored entirely (no merge — keep the failure mode obvious).
  const operationsDir = join(abs, 'operations');
  const legacySkillsDir = join(abs, 'skills');
  const hasOperationsDir = walkDir(operationsDir).length > 0;
  const hasLegacySkillsDir = walkDir(legacySkillsDir).length > 0;
  if (hasOperationsDir && hasLegacySkillsDir) {
    console.warn(
      '[context] both context/<org>/operations/ and context/<org>/skills/ exist; '
      + 'operations/ wins. Move all entries to operations/ and delete skills/.',
    );
  } else if (hasLegacySkillsDir) {
    console.warn(
      '[context] context/<org>/skills/ is deprecated; rename to context/<org>/operations/.',
    );
  }
  const skillsDir = hasOperationsDir ? operationsDir : legacySkillsDir;
  const skills = walkDir(skillsDir)
    .filter(f => (basename(f) === 'skill.yaml' || basename(f) === 'skill.yml'
      || basename(f) === 'operation.yaml' || basename(f) === 'operation.yml'))
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

  const workflows = walkDir(join(abs, 'workflows'))
    .filter(f => (basename(f) === 'workflow.yaml' || basename(f) === 'workflow.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, WorkflowManifestSchema, 'workflow');
      return { ...parsed, sourceFile: file };
    });

  const playbooksDir = join(abs, 'playbooks');
  const playbooks = walkDir(playbooksDir)
    .filter(f => basename(f) === 'SKILL.md')
    .map((file) => {
      files.push(file);
      return loadPlaybook(file, playbooksDir, files);
    });

  const learningSteps = walkDir(join(abs, 'learnings'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, LearningStepManifestSchema, 'learningStep');
      return { ...parsed, sourceFile: file };
    });

  const evalDatasets = walkDir(join(abs, 'evals'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, EvalDatasetManifestSchema, 'evalDataset');
      return { ...parsed, sourceFile: file };
    });

  assertUniqueSlugs(agents, 'agent');
  assertUniqueSlugs(skills, 'skill');
  assertUniqueSlugs(objectTypes, 'object type');
  assertUniqueSlugs(workflows, 'workflow');
  assertUniqueSlugs(playbooks, 'playbook');
  assertUniqueNames(learningSteps, 'learning step');
  assertUniqueSlugs(evalDatasets, 'eval dataset');

  const sha = computeContextSha(abs, files);

  return {
    manifest,
    agents,
    skills,
    objectTypes,
    workflows,
    playbooks,
    learningSteps,
    evalDatasets,
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

/**
 * Parse a Playbook SKILL.md file: split YAML frontmatter from markdown
 * body, validate the frontmatter via {@link PlaybookManifestSchema},
 * compute a SHA-256 of the body, and discover sibling resource files.
 * @param file
 * @param _playbooksRoot
 * @param filesTracked
 */
function loadPlaybook(file: string, _playbooksRoot: string, filesTracked: string[]): LoadedPlaybook {
  const raw = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(raw, file);
  const parsed = validateOrThrow(PlaybookManifestSchema, fm.data, file, 'playbook');
  const contentSha = createHash('sha256').update(fm.body, 'utf8').digest('hex');

  // Walk sibling files within the playbook folder; skip the SKILL.md
  // itself and anything dotted.
  const folder = dirname(file);
  const siblings = walkDir(folder)
    .filter(f => f !== file && !basename(f).startsWith('.'))
    .map(f => relative(folder, f));
  for (const s of siblings) {
    filesTracked.push(join(folder, s));
  }

  return {
    ...parsed,
    body: fm.body,
    contentSha,
    sourceFiles: siblings,
    sourceFile: file,
    // If the manifest didn't declare `resources` explicitly, fall back
    // to every sibling we discovered.
    resources: parsed.resources.length > 0 ? parsed.resources : siblings,
  };
}

function parseFrontmatter(raw: string, file: string): { data: unknown; body: string } {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(fmRegex);
  if (!match) {
    throw new Error(`playbook ${file} is missing YAML frontmatter (expected leading ---...---)`);
  }
  const [, yamlText, body] = match;
  let data: unknown;
  try {
    data = parseYaml(yamlText ?? '');
  } catch (err) {
    throw new Error(`playbook ${file}: invalid YAML frontmatter — ${(err as Error).message}`);
  }
  return { data, body: (body ?? '').trim() };
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

function assertUniqueNames<T extends { name: string }>(items: T[], kind: string): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.name, (seen.get(item.name) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  if (dups.length > 0) {
    throw new Error(`duplicate ${kind} names: ${dups.join(', ')}`);
  }
}

export class ContextValidationError extends Error {
  constructor(public readonly file: string, public readonly kind: string, public readonly issues: string[]) {
    super(`${kind} validation failed at ${file}:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ContextValidationError';
  }
}
