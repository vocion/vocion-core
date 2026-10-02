/**
 * NO CONCRETIONS IN THE FACTORY'S CORE LOGIC (backlog 045; principle 13,
 * point 5). The factory's services name no object type: they read each role's
 * slug from the plugin (`libs/factory/types.ts`), off the record they hold, or
 * off the run's `input.record`. This test reads the source and fails on a type
 * slug written where a type goes, naming the file and line.
 *
 * What counts as "where a type goes" is code shape, not words: the type
 * argument of an org-scoped object read, a `typeSlug` / `objectType` / `.type`
 * compared or assigned, a type-table `slug` filter, a `->> 'type'` SQL match.
 * A field that happens to share a type's name (`meta.product`, a section keyed
 * `release`, a failure class `environment`) is not a type and is not flagged.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashTerm, normalizeForScan } from '@/libs/fixtures/realDataGuard';
import { fromRepoRoot } from '@/libs/repo-root';

/** The code held to this, from the repo root. A directory is read whole; a file prefix matches by name. */
const FACTORY_CORE_SCOPE = [
  'packages/core/src/services/factory/',
  'packages/core/src/libs/factory/',
  'packages/core/src/libs/actions/factory',
  'packages/core/src/services/jobs/factoryCarry.ts',
  // The engineering runner (backlog 052): the record type is the one the run names.
  'packages/runner/src/',
];

/**
 * THE RUNNER NAMES NO PRODUCT (backlog 052). It was extracted from one product's repository, and
 * what was true of that product (its domains, its package names, its account) moved to the repo
 * record and the contract. These are that product's names, hashed the way `realDataGuard.ts`
 * hashes a banned name, so this file does not write them again: a one-word term is matched per
 * word, a two-word term per pair of words, over every file under packages/runner.
 */
const PRODUCT_TERMS: ReadonlyArray<{ hash: string; words: 1 | 2 }> = [
  { hash: '3ca746e495fb98f6', words: 1 }, // the product's company name
  { hash: 'e0afcdbf6ad4adf5', words: 1 }, // the product's name
  { hash: '288a7e6f13a22911', words: 1 }, // the product's domain
  { hash: '7802622f1ebd7ce0', words: 1 }, // its earlier domain
  { hash: '83bea22c73207a30', words: 2 }, // the GitHub owner of its repository
  { hash: 'd942351ae1120ad1', words: 1 }, // its AWS account id
];

/** Every object type slug a shipped plugin or sample workspace defines. */
function knownTypeSlugs(): Set<string> {
  const out = new Set<string>();
  for (const base of ['packages/core/templates/plugins', 'packages/core/templates/workspaces']) {
    const root = fromRepoRoot(base);
    if (!existsSync(root)) {
      continue;
    }
    for (const pack of readdirSync(root)) {
      const objects = join(root, pack, 'objects');
      if (existsSync(objects) && statSync(objects).isDirectory()) {
        for (const slug of readdirSync(objects)) {
          out.add(slug.replace(/\.ya?ml$/, ''));
        }
      }
    }
  }
  return out;
}

/**
 * Source files under the scope, tests excluded (a fixture may name a type).
 * @param scope - Paths from the repo root.
 */
function scopedFiles(scope: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(?:ts|tsx|mjs|js)$/.test(name) && !/\.test\.|\.spec\./.test(name)) {
        out.push(p);
      }
    }
  };
  for (const entry of scope) {
    const abs = fromRepoRoot(entry);
    if (entry.endsWith('/')) {
      if (existsSync(abs)) {
        walk(abs);
      }
      continue;
    }
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push(abs);
      continue;
    }
    const dir = abs.slice(0, abs.lastIndexOf('/'));
    const prefix = abs.slice(abs.lastIndexOf('/') + 1);
    for (const name of readdirSync(dir)) {
      if (name.startsWith(prefix) && /\.(?:ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
        out.push(join(dir, name));
      }
    }
  }
  return out;
}

/**
 * The line with its comments blanked, so a doc comment that explains a type
 * is not code that names one.
 * @param line - One source line.
 * @param inBlock - Whether a block comment is open at its start.
 */
function codeOf(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let code = '';
  let i = 0;
  let block = inBlock;
  while (i < line.length) {
    if (block) {
      const end = line.indexOf('*/', i);
      if (end < 0) {
        return { code, inBlock: true };
      }
      i = end + 2;
      block = false;
      continue;
    }
    const open = line.indexOf('/*', i);
    const lineComment = line.indexOf('//', i);
    const next = [open, lineComment].filter(n => n >= 0).sort((a, b) => a - b)[0];
    if (next === undefined) {
      code += line.slice(i);
      break;
    }
    // `//` inside a string (a URL) is not a comment.
    const before = line.slice(0, next);
    const quotes = (before.match(/'/g) ?? []).length + (before.match(/`/g) ?? []).length;
    if (next === lineComment && quotes % 2 === 1) {
      code += line.slice(i, next + 2);
      i = next + 2;
      continue;
    }
    code += line.slice(i, next);
    if (next === open) {
      block = true;
      i = next + 2;
    } else {
      break;
    }
  }
  return { code, inBlock: block };
}

/** A type literal where a type goes. Group 1 is the literal. */
const TYPE_POSITIONS: RegExp[] = [
  // An org-scoped read handed a literal type: listBusinessObjects(orgId, 'x').
  /\b(?:listBusinessObjects|listRequests|objectsOfType|loadObjectRows|getObjectTypeBySlug)\(\s*[\w.]+\s*,\s*['"]([a-z][\w-]*)['"]/g,
  // A record's type compared or assigned.
  // (`typeof input.objectType === 'string'` checks a JS type, not a record's.)
  /(?<!typeof\s+(?:\w+\.)*)\b(?:typeSlug|objectType)\s*(?:===|!==|:)\s*['"]([a-z][\w-]*)['"]/g,
  // The type table filtered by slug: eq(businessObjectTypeSchema.slug, 'x').
  /TypeSchema\.slug\s*,\s*['"]([a-z][\w-]*)['"]/g,
  // SQL over a run's record ref: input -> 'record' ->> 'type' = 'x'.
  /->>\s*'type'\s*=\s*'([a-z][\w-]*)'/g,
];

/**
 * `type: 'x'` and `.type === 'x'` are too common a shape to flag alone (a
 * content block's `type: 'text'`, an artifact's `recordType: 'object'`); they
 * are flagged when x is a type some pack defines.
 */
const TYPE_KEYS: RegExp[] = [
  /\btype:\s*['"]([a-z][\w-]*)['"]/g,
  /\.type\s*(?:===|!==)\s*['"]([a-z][\w-]*)['"]/g,
];

type Finding = { file: string; line: number; text: string };

/**
 * Every type slug written where a type goes, in these files.
 * @param files - Absolute paths.
 * @param known - Type slugs the packs define.
 */
function typeSlugFindings(files: readonly string[], known: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  for (const file of files) {
    let inBlock = false;
    readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
      const r = codeOf(raw, inBlock);
      inBlock = r.inBlock;
      const hits = TYPE_POSITIONS.flatMap(re => [...r.code.matchAll(re)].map(m => m[1]!));
      hits.push(...TYPE_KEYS.flatMap(re => [...r.code.matchAll(re)].map(m => m[1]!)).filter(s => known.has(s)));
      if (hits.length > 0) {
        out.push({ file: relative(fromRepoRoot('.'), file), line: i + 1, text: raw.trim().slice(0, 160) });
      }
    });
  }
  return out;
}

describe('the factory core names no types', () => {
  it('finds no type slug written where a type goes', () => {
    const files = scopedFiles(FACTORY_CORE_SCOPE);

    expect(files.length).toBeGreaterThan(10);

    const found = typeSlugFindings(files, knownTypeSlugs());

    expect(found.map(f => `${f.file}:${f.line}  ${f.text}`)).toEqual([]);
  });

  it('catches each shape it is meant to', () => {
    const shapes = [
      `const t = await listBusinessObjects(orgId, 'engineering_task');`,
      `if (row.typeSlug !== 'request') {`,
      `href: link({ objectType: 'architecture_plan', id })`,
      `if (rec.type === 'engineering_task') {`,
      `.where(eq(businessObjectTypeSchema.slug, 'repo'))`,
      // eslint-disable-next-line no-template-curly-in-string -- the source text of a sql template
      'sql`${workerRunSchema.input} -> \'record\' ->> \'type\' = \'engineering_task\'`',
      `objectRefs: [{ type: 'request', id }]`,
    ];
    const known = new Set(['engineering_task', 'request', 'architecture_plan', 'repo']);
    const tmp = join(mkdtempSync(join(tmpdir(), 'no-concretions-')), 'sample.ts');
    writeFileSync(tmp, `${shapes.join('\n')}\n// listBusinessObjects(orgId, 'request') in a comment\nconst field = str(meta, 'product');\nif (typeof input.objectType === 'string') {}\n`);

    const found = typeSlugFindings([tmp], known);

    expect(found.map(f => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

/**
 * Every file under a directory, node_modules left out.
 * @param dir - Absolute path.
 */
function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') {
      continue;
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...allFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

describe('the runner names no product', () => {
  it('finds none of the product terms in any runner file, tests and image included', () => {
    const one = new Set(PRODUCT_TERMS.filter(t => t.words === 1).map(t => t.hash));
    const two = new Set(PRODUCT_TERMS.filter(t => t.words === 2).map(t => t.hash));
    const found: string[] = [];
    const root = fromRepoRoot('packages/runner');
    for (const file of allFiles(root)) {
      const rel = relative(fromRepoRoot('.'), file);
      [rel, ...readFileSync(file, 'utf8').split('\n')].forEach((line, i) => {
        const words = normalizeForScan(line).split(' ').filter(Boolean);
        const hit = words.some(w => one.has(hashTerm(w))) || words.slice(1).some((w, j) => two.has(hashTerm(`${words[j]} ${w}`)));
        if (hit) {
          found.push(i === 0 ? `${rel} (its path)` : `${rel}:${i}`);
        }
      });
    }

    expect(found).toEqual([]);
  });
});
