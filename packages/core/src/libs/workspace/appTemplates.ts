/**
 * App templates — a ready function an app can stand up in a workspace.
 *
 * A template is a directory at `templates/apps/<app>/templates/<slug>/`: a
 * `template.yaml` (`AppTemplateManifestSchema` — its name, the plugins it
 * turns on and a one-to-three question interview) and a `files/` tree laid
 * out like a workspace (teams, agents, missions, automations, skills, a
 * `trust.yaml`). Installing one writes those files into the workspace folder
 * with the answers filled in, turns the plugins on and applies, so what it
 * stands up is the workspace's own context-as-code from then on — the same
 * teams, measures, missions, automations, trust rules and budgets a person
 * would author by hand (`services/apps/AppTemplateService.ts`).
 *
 * This module is the filesystem and text half: which templates an app ships,
 * what each one contains, and the pure steps — answering the interview,
 * filling the files, merging trust rules and the manifest — that the service
 * composes. Core names no template, no company type and no slug here; they are
 * concretions and live in the template directories (CLAUDE.md, "No
 * concretions in core logic").
 *
 * Placeholders are `{{key}}`: an interview answer by its key, or one of
 * `installer.email`, `installer.name`, `workspace.name`. YAML is filled value
 * by value through the parsed document, so an answer carrying a colon or a
 * quote can never change the file's shape, and the file's comments survive.
 */

import type { AppTemplateManifest } from './schemas';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, parse as parseYaml, visit, YAMLMap, YAMLSeq } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { APPS_REL } from './apps';
import { AppTemplateManifestSchema } from './schemas';

/** Where an app keeps its templates, under its own directory. */
export const APP_TEMPLATES_DIR = 'templates';

/** Where a template keeps the workspace files it writes. */
export const TEMPLATE_FILES_DIR = 'files';

/**
 * What a template may write into a workspace: these folders, and a
 * `trust.yaml` whose rules are merged into the workspace's own. Never the
 * manifest itself (the service edits `plugins:`, `lead:` and
 * `accountableUser:` in place) and never a source, a workflow or data.
 */
export const TEMPLATE_WRITABLE_DIRS = ['agents', 'teams', 'missions', 'automations', 'skills', 'playbooks', 'pages', 'learnings'] as const;
export const TEMPLATE_TRUST_FILE = 'trust.yaml';

/** The values every template may use besides its own interview's. */
export const BUILTIN_PLACEHOLDERS = ['installer.email', 'installer.name', 'workspace.name'] as const;

const PLACEHOLDER = /\{\{\s*([a-z][\w.]*)\s*\}\}/gi;

/** One file a template writes, at its workspace-relative path (posix). */
export type TemplateFile = { path: string; content: string };

export type LoadedAppTemplate = {
  /** The app it belongs to. */
  app: string;
  manifest: AppTemplateManifest;
  /** Absolute path of the template directory. */
  sourcePath: string;
  /** Its files, unfilled. */
  files: TemplateFile[];
};

/** What a template stands up, counted for the card — never the bodies. */
export type AppTemplateContents = {
  teams: string[];
  agents: string[];
  missions: string[];
  automations: string[];
  skills: string[];
  /** Actions its trust rules name. */
  trustRules: string[];
  /** Plugins it turns on (its own; the app's are added by the service). */
  plugins: string[];
  /** Agents that carry a spend cap. */
  budgets: string[];
};

function templatesRoot(appId: string): string {
  return fromRepoRoot(join(APPS_REL, appId, APP_TEMPLATES_DIR));
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/**
 * Whether a template may write this workspace-relative path.
 * @param path - Posix path relative to the workspace root.
 */
export function isWritableTemplatePath(path: string): boolean {
  if (path.includes('..') || path.startsWith('/')) {
    return false;
  }
  if (path === TEMPLATE_TRUST_FILE) {
    return true;
  }
  const [root, ...rest] = path.split('/');
  return rest.length > 0 && (TEMPLATE_WRITABLE_DIRS as readonly string[]).includes(root ?? '');
}

/**
 * The placeholders a text uses, by key.
 * @param text - Any template text.
 */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map(m => m[1]!))];
}

/**
 * Fill `{{key}}` from `values`, in one pass — an answer that itself carries
 * braces is written as it is, never filled again. A key with no value is left
 * as written; the loader refuses a template that uses an unknown key, so this
 * only happens to a caller that skipped answering.
 * @param text - The template text.
 * @param values - Values by key.
 */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => (Object.hasOwn(values, key) ? values[key]! : whole));
}

/** Ids of the apps that ship templates, by directory. */
export function listAppIdsWithTemplates(): string[] {
  const root = fromRepoRoot(APPS_REL);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root).sort().filter(app => listAppTemplateSlugs(app).length > 0);
}

/**
 * Slugs of an app's templates (their directory names), A–Z.
 * @param appId - The app.
 */
export function listAppTemplateSlugs(appId: string): string[] {
  const root = templatesRoot(appId);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .sort()
    .filter(name => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'template.yaml')));
}

/**
 * Read and validate one template. Throws, naming the file, when the manifest
 * fails its schema, its slug disagrees with its directory, it writes outside
 * what a template may write, or it uses a placeholder nothing answers.
 * @param appId - The app.
 * @param slug - The template (its directory name).
 */
export function loadAppTemplate(appId: string, slug: string): LoadedAppTemplate {
  const dir = join(templatesRoot(appId), slug);
  const file = join(dir, 'template.yaml');
  if (!existsSync(file)) {
    const known = listAppTemplateSlugs(appId);
    throw new Error(`unknown template "${slug}" for app "${appId}" — it ships: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }
  const result = AppTemplateManifestSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.length > 0 ? i.path.map(String).join('.') : '(root)'}: ${i.message}`);
    throw new Error(`template manifest validation failed at ${file}:\n  - ${messages.join('\n  - ')}`);
  }
  const manifest = result.data;
  if (manifest.slug !== slug) {
    throw new Error(`template at ${dir} declares slug "${manifest.slug}" but lives in a directory named "${slug}" — the two must agree`);
  }
  const filesDir = join(dir, TEMPLATE_FILES_DIR);
  const files = walk(filesDir).map(abs => ({ path: toPosix(relative(filesDir, abs)), content: readFileSync(abs, 'utf8') }));
  const outside = files.filter(f => !isWritableTemplatePath(f.path)).map(f => f.path);
  if (outside.length > 0) {
    throw new Error(`template "${slug}" writes outside what a template may write (${TEMPLATE_WRITABLE_DIRS.join(', ')}, ${TEMPLATE_TRUST_FILE}): ${outside.join(', ')}`);
  }
  const known = new Set<string>([...BUILTIN_PLACEHOLDERS, ...manifest.interview.map(q => q.key)]);
  const used = [...files.map(f => f.content), ...manifest.interview.map(q => q.default ?? '')].flatMap(placeholdersIn);
  const unknown = [...new Set(used.filter(k => !known.has(k)))];
  if (unknown.length > 0) {
    throw new Error(`template "${slug}" uses placeholders nothing answers: ${unknown.map(k => `{{${k}}}`).join(', ')} — answerable: ${[...known].join(', ')}`);
  }
  return { app: appId, manifest, sourcePath: dir, files };
}

/**
 * Every template an app ships, in picker order (`order`, then slug). Throws
 * on the first broken one — the test suite loads them all.
 * @param appId - The app.
 */
export function listAppTemplates(appId: string): LoadedAppTemplate[] {
  return listAppTemplateSlugs(appId)
    .map(slug => loadAppTemplate(appId, slug))
    .sort((a, b) => a.manifest.order - b.manifest.order || a.manifest.slug.localeCompare(b.manifest.slug));
}

/**
 * The app's templates, or none — a broken template must never take a page down.
 * @param appId - The app.
 */
export function safeListAppTemplates(appId: string): LoadedAppTemplate[] {
  try {
    return listAppTemplates(appId);
  } catch (error) {
    console.warn('apps: could not read an app\'s templates', { appId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

function names(files: readonly TemplateFile[], dir: string): string[] {
  return files
    .filter(f => f.path.startsWith(`${dir}/`) && /\.ya?ml$/.test(f.path) && f.path.split('/').length === 2)
    .map(f => f.path.slice(dir.length + 1).replace(/\.ya?ml$/, ''))
    .filter(n => !n.endsWith('.system-prompt'))
    .sort();
}

/**
 * What a template stands up, read off its files.
 * @param template - The loaded template.
 */
export function appTemplateContents(template: LoadedAppTemplate): AppTemplateContents {
  const trust = template.files.find(f => f.path === TEMPLATE_TRUST_FILE);
  const rules = trust ? ((parseYaml(trust.content) as { rules?: Array<{ action?: string }> } | null)?.rules ?? []) : [];
  const budgets = template.files
    .filter(f => /^agents\/[^/]+\.ya?ml$/.test(f.path) && !f.path.includes('.system-prompt'))
    .filter(f => (parseYaml(f.content) as { budget?: unknown } | null)?.budget !== undefined)
    .map(f => f.path.replace(/^agents\//, '').replace(/\.ya?ml$/, ''))
    .sort();
  return {
    teams: names(template.files, 'teams'),
    agents: names(template.files, 'agents'),
    missions: names(template.files, 'missions'),
    automations: names(template.files, 'automations'),
    skills: [...new Set(template.files.filter(f => /^skills\/[^/]+\//.test(f.path)).map(f => f.path.split('/')[1]!))].sort(),
    trustRules: rules.map(r => String(r.action ?? '')).filter(Boolean),
    plugins: [...template.manifest.plugins],
    budgets,
  };
}

/** Who is installing and where, for the built-in placeholders. */
export type TemplateInstallContext = {
  installer: { email: string; name: string };
  workspace: { name: string };
};

export type AnswerResult
  = | { ok: true; values: Record<string, string> }
    | { ok: false; problems: Record<string, string> };

/**
 * Answer the interview: each answer trimmed and kept to one line, an empty
 * one replaced by the question's default (with the built-ins filled), and a
 * missing or over-long one named. Keys the interview does not ask are
 * ignored. The values returned fill every placeholder the template uses.
 * @param manifest - The template's manifest.
 * @param raw - The answers as submitted, by question key.
 * @param ctx - The installer and the workspace.
 */
export function answerInterview(manifest: AppTemplateManifest, raw: Readonly<Record<string, unknown>>, ctx: TemplateInstallContext): AnswerResult {
  const builtins: Record<string, string> = {
    'installer.email': ctx.installer.email,
    'installer.name': ctx.installer.name || ctx.installer.email,
    'workspace.name': ctx.workspace.name,
  };
  const values: Record<string, string> = { ...builtins };
  const problems: Record<string, string> = {};
  for (const q of manifest.interview) {
    const given = typeof raw[q.key] === 'string' ? (raw[q.key] as string).replace(/\s+/g, ' ').trim() : '';
    const value = given || (q.default ? fillPlaceholders(q.default, builtins).trim() : '');
    if (!value) {
      problems[q.key] = 'needs an answer';
    } else if (value.length > q.maxLength) {
      problems[q.key] = `keep it under ${q.maxLength} characters`;
    } else {
      values[q.key] = value;
    }
  }
  return Object.keys(problems).length > 0 ? { ok: false, problems } : { ok: true, values };
}

/**
 * Fill one file. YAML is filled scalar by scalar through the parsed document,
 * so the answer is a value and never markup, and comments survive; anything
 * else is filled as text.
 * @param file - The template file.
 * @param values - Values by placeholder key.
 */
export function fillTemplateFile(file: TemplateFile, values: Readonly<Record<string, string>>): TemplateFile {
  if (!/\.ya?ml$/.test(file.path)) {
    return { path: file.path, content: fillPlaceholders(file.content, values) };
  }
  const doc = parseDocument(file.content);
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && placeholdersIn(node.value).length > 0) {
        node.value = fillPlaceholders(node.value, values);
      }
    },
  });
  return { path: file.path, content: doc.toString() };
}

/**
 * Every file of a template, filled.
 * @param template - The loaded template.
 * @param values - The interview's values (`answerInterview`).
 */
export function renderAppTemplate(template: LoadedAppTemplate, values: Readonly<Record<string, string>>): TemplateFile[] {
  return template.files.map(f => fillTemplateFile(f, values));
}

/**
 * Add a template's trust rules to the workspace's, by action: a rule for an
 * action the workspace already rules on is left as the workspace wrote it —
 * a person's bar is never lowered or raised by a template — and a top-level
 * `risk:` entry is added only when the workspace states none for that action.
 * Comments in the workspace's file are kept.
 * @param existing - The workspace's `trust.yaml`, or null when it has none.
 * @param incoming - The template's filled `trust.yaml`.
 * @returns The file to write and the actions whose rules were added.
 */
export function mergeTrustRules(existing: string | null, incoming: string): { content: string; added: string[] } {
  const theirs = (parseYaml(incoming) ?? {}) as { rules?: Array<{ action: string }>; risk?: Record<string, string> };
  const rules = theirs.rules ?? [];
  if (existing === null || existing.trim() === '') {
    return { content: incoming, added: rules.map(r => r.action) };
  }
  const doc = parseDocument(existing);
  let seq = doc.get('rules');
  if (!isSeq(seq)) {
    seq = new YAMLSeq();
    doc.set('rules', seq);
  }
  const ruled = new Set((seq as YAMLSeq).items.map(item => (isMap(item) ? String(item.get('action') ?? '') : '')).filter(Boolean));
  const added: string[] = [];
  for (const rule of rules) {
    if (!ruled.has(rule.action)) {
      (seq as YAMLSeq).add(doc.createNode(rule));
      ruled.add(rule.action);
      added.push(rule.action);
    }
  }
  for (const [action, tier] of Object.entries(theirs.risk ?? {})) {
    let risk = doc.get('risk');
    if (!isMap(risk)) {
      risk = new YAMLMap();
      doc.set('risk', risk);
    }
    if (!(risk as YAMLMap).has(action)) {
      (risk as YAMLMap).set(action, tier);
    }
  }
  return { content: added.length > 0 || Object.keys(theirs.risk ?? {}).length > 0 ? doc.toString() : existing, added };
}

/** What the manifest edit changed. */
export type ManifestEdit = { content: string; pluginsAdded: string[]; leadSet: string | null; accountableUserSet: string | null };

/**
 * The workspace manifest with the template's plugins on and, where the
 * workspace names none, its lead and its accountable person set — edited in
 * place, comments kept. Never changes a lead or an accountable person the
 * workspace already names, and never turns a plugin off.
 * @param existing - The workspace's `workspace.yaml`.
 * @param edit - What to add.
 * @param edit.plugins - Plugin slugs to turn on.
 * @param edit.lead - The lead to set when there is none.
 * @param edit.accountableUser - The accountable person's email to set when there is none.
 */
export function editWorkspaceManifest(existing: string, edit: { plugins: readonly string[]; lead?: string; accountableUser?: string }): ManifestEdit {
  const doc = parseDocument(existing);
  const current = doc.get('plugins');
  const authored = isSeq(current) ? current.items.map(i => String(isScalar(i) ? i.value : i)) : [];
  const pluginsAdded = edit.plugins.filter((p, i) => !authored.includes(p) && edit.plugins.indexOf(p) === i);
  if (pluginsAdded.length > 0) {
    const seq = doc.createNode([...authored, ...pluginsAdded]) as YAMLSeq;
    seq.flow = true;
    doc.set('plugins', seq);
  }
  const absent = (key: string) => {
    const v = doc.get(key);
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  };
  const leadSet = edit.lead && absent('lead') ? edit.lead : null;
  if (leadSet) {
    doc.set('lead', leadSet);
  }
  const accountableUserSet = edit.accountableUser && absent('accountableUser') ? edit.accountableUser : null;
  if (accountableUserSet) {
    doc.set('accountableUser', accountableUserSet);
  }
  const changed = pluginsAdded.length > 0 || leadSet !== null || accountableUserSet !== null;
  return { content: changed ? doc.toString() : existing, pluginsAdded, leadSet, accountableUserSet };
}
