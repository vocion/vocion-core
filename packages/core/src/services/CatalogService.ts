import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { AgentManifestSchema } from '@/libs/workspace/schemas';
import { agentSchema } from '@/models/Schema';

/**
 * The agent catalog — the library a workspace hires from.
 *
 * `templates/catalog/` is authored in exactly the shape of a base pack
 * (`pack.yaml` + `agents/*.yaml` + `skills/<slug>/SKILL.md`) so it validates
 * against {@link AgentManifestSchema} and `workspace:check` with no new
 * parser. It is deliberately NOT a pack a workspace `extends`: nothing here
 * is composed in automatically. This service reads it, the Marketplace tab
 * lists what an org has not hired, and {@link hire} copies one entry into
 * the org's agent table.
 *
 * Definitions only. An entry declares what it reaches for by connector
 * CATEGORY (`crm`, never `salesforce`) so the catalog can say "needs a
 * ledger" without naming a product and no entry can quietly prefer one
 * vendor over another. Installing those connectors is separate work, and
 * every entry has a files-only path so hiring never waits on one.
 *
 * There is no permission field anywhere in this module, on purpose. Whether
 * an agent may write belongs to the installation, not to the definition —
 * a definition that declared its own tier would be a package asserting
 * something about somebody else's org. An entry's write ceiling is the
 * union of its skills' own write paths, derived rather than declared.
 */

/** One catalog entry, as the Marketplace tab renders it. */
export type CatalogEntry = {
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  accent: string | null;
  eyebrow: string | null;
  /** The agent's system prompt in full — the thing actually being hired. */
  systemPrompt: string;
  /** Skill slugs this entry composes — resolved from the library, not inlined. */
  skills: string[];
  /** Connector CATEGORIES it reaches for. Never vendors. */
  requires: string[];
  /** Categories that enrich it but are not needed to run. */
  optional: string[];
};

/** Absolute path of the catalog tree. Overridable for tests. */
export function catalogRoot(): string {
  return fromRepoRoot('packages/core/templates/catalog');
}

/**
 * Every entry in the catalog, sorted by name.
 *
 * Reads from disk on each call. The tree is small, ships inside the
 * runtime, and never changes between deploys — caching it would buy
 * nothing and would make the dev loop lie.
 * @param root - catalog directory; defaults to the shipped one.
 */
export function listCatalog(root: string = catalogRoot()): CatalogEntry[] {
  const dir = join(root, 'agents');
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.yaml'));
  } catch {
    // No catalog on disk is an empty catalog, not a crash. A deployment
    // that shipped without templates/ should render an empty Marketplace
    // rather than a 500 on a page that also lists live teams.
    return [];
  }

  return files
    .map((file) => {
      const raw = parseYaml(readFileSync(join(dir, file), 'utf8')) as unknown;
      const manifest = AgentManifestSchema.parse(raw);
      return {
        slug: manifest.slug,
        name: manifest.name,
        description: manifest.description ?? '',
        icon: manifest.icon ?? null,
        accent: manifest.accent ?? null,
        eyebrow: manifest.eyebrow ?? null,
        systemPrompt: (manifest.systemPrompt ?? '').trim(),
        skills: manifest.skills,
        requires: manifest.requires.connectors,
        optional: manifest.requires.optional,
      } satisfies CatalogEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Catalog entries this org has not hired — what the Marketplace tab shows.
 *
 * Diffed on slug against the org's own agents, so an entry hired and then
 * renamed stays hired. An org with no agents sees the whole catalog, which
 * is the correct first-run experience.
 * @param orgId - The workspace whose agents the catalog is diffed against.
 * @param root - catalog directory; defaults to the shipped one.
 */
export async function listUnhired(orgId: string, root: string = catalogRoot()): Promise<CatalogEntry[]> {
  const hired = await db
    .select({ slug: agentSchema.slug })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, orgId));
  const taken = new Set(hired.map(a => a.slug));
  return listCatalog(root).filter(e => !taken.has(e.slug));
}

/**
 * One entry by slug, or null when the catalog does not carry it.
 * @param slug - The catalog entry's slug.
 * @param root - Catalog directory; defaults to the shipped one.
 */
export function getCatalogEntry(slug: string, root: string = catalogRoot()): CatalogEntry | null {
  return listCatalog(root).find(e => e.slug === slug) ?? null;
}

/**
 * The full body of a catalog skill — what the entry's profile page shows
 * under each skill name. Returns null for a slug the library does not
 * carry, which is a broken manifest rather than a user error.
 * @param slug - The catalog entry's slug.
 * @param root - catalog directory; defaults to the shipped one.
 */
export function readCatalogSkill(slug: string, root: string = catalogRoot()): { slug: string; body: string } | null {
  const path = join(root, 'skills', slug, 'SKILL.md');
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  // Body is everything after the closing frontmatter fence.
  const end = raw.indexOf('\n---', 3);
  const body = end === -1 ? raw : raw.slice(end + 4);
  return { slug, body: body.trim() };
}

/**
 * Hire an entry: create the org's agent row from the catalog manifest.
 *
 * Idempotent on slug — hiring something already hired is a no-op that
 * returns `already`, never a duplicate agent or an error. Writes nothing
 * beyond the agent row: connectors are installed separately, and the
 * playbooks an implementation authors are created when somebody authors
 * them, not scaffolded as empty files nobody asked for.
 * @param orgId - The workspace whose agents the catalog is diffed against.
 * @param slug - The catalog entry's slug.
 * @param root - catalog directory; defaults to the shipped one.
 */
export async function hire(
  orgId: string,
  slug: string,
  root: string = catalogRoot(),
): Promise<{ status: 'hired' | 'already' | 'unknown'; entry: CatalogEntry | null }> {
  const entry = getCatalogEntry(slug, root);
  if (!entry) {
    return { status: 'unknown', entry: null };
  }

  const already = (await db
    .select({ slug: agentSchema.slug })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, orgId)))
    .some(a => a.slug === slug);
  if (already) {
    return { status: 'already', entry };
  }

  const manifest = AgentManifestSchema.parse(
    parseYaml(readFileSync(join(root, 'agents', `${slug}.yaml`), 'utf8')),
  );

  await db.insert(agentSchema).values({
    orgId,
    projectId: orgId,
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description ?? null,
    systemPrompt: manifest.systemPrompt ?? '',
    skillSlugs: manifest.skills,
    playbookSlugs: manifest.playbooks,
    connectorSources: manifest.connectorSources,
    icon: manifest.icon ?? null,
    accent: manifest.accent ?? null,
    eyebrow: manifest.eyebrow ?? null,
  });

  return { status: 'hired', entry };
}
