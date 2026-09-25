/**
 * Read and validate a `deployment/` directory. Pure: parses and checks, and
 * touches no database, so `--dry-run` works with nothing reachable.
 */

import type { GroupsFile, PeopleFile, SeedGroup, SeedPerson } from './schemas';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GroupsFileSchema, PeopleFileSchema } from './schemas';

export type LoadedSeed = {
  dir: string;
  groups: SeedGroup[];
  people: SeedPerson[];
};

export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedValidationError';
  }
}

function readYaml<T>(path: string, schema: { parse: (v: unknown) => T }, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new SeedValidationError(`${path}: not valid YAML — ${(cause as Error).message}`);
  }
  const result = (schema as { safeParse?: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] }; data?: T } }).safeParse?.(raw);
  if (result && !result.success) {
    const lines = result.error!.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new SeedValidationError(`${path}:\n${lines.join('\n')}`);
  }
  return result ? result.data! : schema.parse(raw);
}

/**
 * Load `<dir>/groups.yaml` and `<dir>/people.yaml`.
 *
 * Either file may be absent — a deployment that only defines groups, or only
 * invites people, is a legitimate half-built state and should not need an empty
 * file to say so.
 * @param dir - The `deployment/` directory.
 */
export function loadSeed(dir: string): LoadedSeed {
  const groupsFile = readYaml<GroupsFile>(join(dir, 'groups.yaml'), GroupsFileSchema, { version: 1, groups: [] });
  const peopleFile = readYaml<PeopleFile>(join(dir, 'people.yaml'), PeopleFileSchema, { version: 1, people: [] });

  assertConsistent(groupsFile.groups, peopleFile.people);
  return { dir, groups: groupsFile.groups, people: peopleFile.people };
}

/**
 * Everything that can be known wrong without a database. Each of these is
 * silent at runtime if it slips through: a person in a group that does not
 * exist simply reaches nothing, which reads as a permissions bug months later.
 * @param groups - Declared groups.
 * @param people - Declared people.
 */
export function assertConsistent(groups: SeedGroup[], people: SeedPerson[]): void {
  const errors: string[] = [];

  const seenGroup = new Set<string>();
  for (const g of groups) {
    if (seenGroup.has(g.slug)) {
      errors.push(`groups.yaml: two groups share the slug "${g.slug}"`);
    }
    seenGroup.add(g.slug);

    const seenWorkspace = new Set<string>();
    for (const grant of g.grants) {
      if (seenWorkspace.has(grant.workspace)) {
        errors.push(`groups.yaml: group "${g.slug}" grants "${grant.workspace}" twice — one role per workspace`);
      }
      seenWorkspace.add(grant.workspace);
    }
  }

  const seenEmail = new Set<string>();
  for (const p of people) {
    if (seenEmail.has(p.email)) {
      errors.push(`people.yaml: "${p.email}" is listed twice`);
    }
    seenEmail.add(p.email);

    for (const slug of p.groups) {
      if (!seenGroup.has(slug)) {
        errors.push(`people.yaml: "${p.email}" is in group "${slug}", which groups.yaml does not define`);
      }
    }
    if (p.exclusive && p.groups.length === 0) {
      errors.push(
        `people.yaml: "${p.email}" is exclusive and in no group, which would revoke every workspace the backfill gave them. `
        + `Name the groups they should hold, or drop exclusive.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new SeedValidationError(`the deployment seed does not hold together:\n${errors.map(e => `  ${e}`).join('\n')}`);
  }
}
