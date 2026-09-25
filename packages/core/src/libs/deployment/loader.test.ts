/**
 * What the seed can be caught getting wrong before a database is involved.
 *
 * Each of these is silent at runtime if it slips through. A person in a group
 * that does not exist simply reaches nothing, which surfaces months later as
 * "permissions are broken" rather than as a typo in a file.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSeed, SeedValidationError } from './loader';

let dir: string;

function seedDir(files: { groups?: string; people?: string }): string {
  dir = mkdtempSync(path.join(tmpdir(), 'vocion-seed-'));
  if (files.groups !== undefined) {
    writeFileSync(path.join(dir, 'groups.yaml'), files.groups, 'utf8');
  }
  if (files.people !== undefined) {
    writeFileSync(path.join(dir, 'people.yaml'), files.people, 'utf8');
  }
  return dir;
}

const GROUPS = `version: 1
groups:
  - slug: revops
    name: RevOps
    grants:
      - workspace: revenue
        role: pm
`;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('deployment seed loader', () => {
  it('loads a group and a person', () => {
    const seed = loadSeed(seedDir({
      groups: GROUPS,
      people: `version: 1
people:
  - email: Alex@Northwind.Example
    groups: [revops]
`,
    }));

    expect(seed.groups[0]!.grants).toEqual([{ workspace: 'revenue', role: 'pm' }]);
    // Lower-cased on the way in, because the user table is unique on a
    // lower-cased email and a capital would simply never match.
    expect(seed.people[0]!.email).toBe('alex@northwind.example');
    expect(seed.people[0]!.exclusive).toBe(false);
    expect(seed.people[0]!.invite).toBe(false);
  });

  it('treats a missing file as empty rather than an error', () => {
    // A deployment that defines groups but has not listed anyone yet is a real
    // intermediate state, not a broken one.
    const seed = loadSeed(seedDir({ groups: GROUPS }));

    expect(seed.groups).toHaveLength(1);
    expect(seed.people).toEqual([]);
  });

  it('refuses a person in a group that does not exist', () => {
    const run = () => loadSeed(seedDir({
      groups: GROUPS,
      people: `version: 1
people:
  - email: alex@northwind.example
    groups: [marketing]
`,
    }));

    expect(run).toThrow(SeedValidationError);
    expect(run).toThrow(/group "marketing", which groups.yaml does not define/);
  });

  it('refuses an exclusive person in no group', () => {
    // This would revoke every workspace the backfill gave them and grant
    // nothing back — a quiet way to lock someone out of everything.
    const run = () => loadSeed(seedDir({
      groups: GROUPS,
      people: `version: 1
people:
  - email: alex@northwind.example
    exclusive: true
`,
    }));

    expect(run).toThrow(/would revoke every workspace/);
  });

  it('refuses two groups with the same slug', () => {
    const run = () => loadSeed(seedDir({
      groups: `version: 1
groups:
  - slug: revops
    name: One
  - slug: revops
    name: Two
`,
    }));

    expect(run).toThrow(/two groups share the slug "revops"/);
  });

  it('refuses one group granting the same workspace twice', () => {
    const run = () => loadSeed(seedDir({
      groups: `version: 1
groups:
  - slug: revops
    name: RevOps
    grants:
      - { workspace: revenue, role: pm }
      - { workspace: revenue, role: owner }
`,
    }));

    expect(run).toThrow(/grants "revenue" twice/);
  });

  it('refuses the same person listed twice', () => {
    const run = () => loadSeed(seedDir({
      groups: GROUPS,
      people: `version: 1
people:
  - email: alex@northwind.example
  - email: alex@northwind.example
`,
    }));

    expect(run).toThrow(/is listed twice/);
  });

  it('refuses a role outside the four the grant model knows', () => {
    const run = () => loadSeed(seedDir({
      groups: `version: 1
groups:
  - slug: revops
    name: RevOps
    grants:
      - { workspace: revenue, role: superuser }
`,
    }));

    expect(run).toThrow(SeedValidationError);
  });

  it('refuses a key it does not recognise, rather than ignoring it', () => {
    // A typo in a key is the failure mode that would otherwise be silent: the
    // file looks right and the setting does nothing.
    const run = () => loadSeed(seedDir({
      groups: GROUPS,
      people: `version: 1
people:
  - email: alex@northwind.example
    exlusive: true
`,
    }));

    expect(run).toThrow(SeedValidationError);
  });
});
