/**
 * Which resources a set of workspace files declares, read without loading
 * them — so an export can tell which rows no file accounts for before it has
 * a workspace that loads (a manifest may name a lead agent that exists only as
 * a row), and an import can tell which of this workspace's files an upload
 * replaces.
 *
 * Read where the loader reads each kind and by the key it uses: a `slug:`, a
 * learning step's `name:`, a team's file name, a SKILL.md folder's
 * frontmatter slug. Nothing is validated here — the load that follows does
 * that — and a file that does not parse declares nothing.
 */

import type { ExportFile } from './export';
import { Buffer } from 'node:buffer';
import { parse as parseYaml } from 'yaml';
import { splitFrontmatter } from './source';

/** What each YAML kind is keyed by, and the files beside it that it names. */
const KEYED: Record<string, { match: (name: string) => boolean; key: 'slug' | 'name'; siblings?: (raw: Record<string, unknown>) => unknown[] }> = {
  agents: { match: isYamlName, key: 'slug', siblings: raw => [raw.systemPromptFile, ...(Array.isArray(raw.subagents) ? raw.subagents.map(s => (s as Record<string, unknown> | null)?.systemPromptFile) : [])] },
  objects: { match: n => n === 'type.yaml' || n === 'type.yml', key: 'slug', siblings: raw => [raw.classificationPromptFile] },
  missions: { match: isYamlName, key: 'slug' },
  automations: { match: isYamlName, key: 'slug' },
  workflows: { match: n => n === 'workflow.yaml' || n === 'workflow.yml', key: 'slug' },
  sources: { match: isYamlName, key: 'slug' },
  evals: { match: isYamlName, key: 'slug' },
  learnings: { match: isYamlName, key: 'name' },
};

/**
 * `<top folder>:<key>` → the paths that resource is made of. The top folder
 * is the kind's (`agents`, `skills`, `teams` …).
 * @param files - The workspace's files, by path inside it.
 */
export function declaredResources(files: readonly ExportFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const paths = new Set(files.map(f => f.path));
  const add = (key: string, made: string[]) => out.set(key, [...(out.get(key) ?? []), ...made]);
  for (const file of files) {
    const top = file.path.split('/')[0] ?? '';
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const dir = file.path.slice(0, file.path.length - name.length);
    if (top === 'skills' || top === 'playbooks') {
      const slug = name === 'SKILL.md' ? frontmatterSlug(fileText(file)) : null;
      if (slug) {
        add(`${top}:${slug}`, files.filter(f => f.path.startsWith(dir)).map(f => f.path));
      }
      continue;
    }
    if (top === 'teams' && isYamlName(name)) {
      add(`teams:${name.replace(/\.ya?ml$/, '')}`, [file.path]);
      continue;
    }
    const kind = KEYED[top];
    if (!kind || !kind.match(name)) {
      continue;
    }
    const raw = yamlMap(fileText(file));
    const key = raw?.[kind.key];
    if (typeof key !== 'string' || key.length === 0) {
      continue;
    }
    const siblings = (kind.siblings?.(raw!) ?? [])
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map(s => `${dir}${s}`)
      .filter(p => paths.has(p));
    add(`${top}:${key}`, [file.path, ...siblings]);
  }
  return out;
}

/**
 * A file's text: as stored, or its bytes read as UTF-8.
 * @param file - The file.
 */
export function fileText(file: ExportFile): string {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
}

/**
 * A YAML document that is a map, or null for anything else (or nothing that parses).
 * @param source - The text.
 */
export function yamlMap(source: string): Record<string, unknown> | null {
  try {
    const value = parseYaml(source) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function frontmatterSlug(skill: string): string | null {
  try {
    const slug = (splitFrontmatter(skill).data as { slug?: unknown } | null)?.slug;
    return typeof slug === 'string' && slug.length > 0 ? slug : null;
  } catch {
    return null;
  }
}

function isYamlName(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml');
}
