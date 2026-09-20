/**
 * A mission or a playbook as the thing a person EDITS: one file in the
 * workspace, mirrored into an artifact so it inherits versions, restore, the
 * pane, share and select-to-ask (design principle 7 — anything that is
 * referenced, edited, versioned or cited is an artifact; a second version
 * history is the tell that a noun is being duplicated).
 *
 * The FILE stays the source of truth, exactly as it is for the `mission` and
 * `playbook` rows the applier already reconciles from it. The mirror is one
 * more row the applier keeps in step: `record { type, id: slug, role: 'source' }`,
 * spec = the authored text. Writing goes the other way through
 * `services/workspace/WorkspaceSourceService.ts` — validate, write the file,
 * load, mirror, apply — so the pane's Save and an agent's tool call land on
 * disk first and in the database second, never the reverse.
 *
 * Pure: no filesystem, no database. The applier, the service, the router and
 * the tools all read the same shape from here.
 */

import type { ArtifactKind } from '@/libs/cards/specs';
import { parse as parseYaml } from 'yaml';
import { MissionManifestSchema, PlaybookManifestSchema, SlugSchema } from './schemas';

/** What a workspace source file can be. Skills share the playbook page and the playbook shape. */
export type SourceKind = 'mission' | 'playbook' | 'skill';

export const SOURCE_KINDS: readonly SourceKind[] = ['mission', 'playbook', 'skill'];

/** What the mirror IS to its record: the authored file. */
export const SOURCE_ROLE = 'source';

/** The artifact kinds that mirror a workspace file. Membership decides the write path in the router and the tools. */
export const SOURCE_ARTIFACT_KINDS: ReadonlySet<string> = new Set(['mission', 'playbook']);

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * The artifact kind a source kind mirrors into. A skill is a SKILL.md folder
 * exactly like a playbook, so it mirrors as `playbook` and the spec says which.
 * @param kind
 */
export function sourceArtifactKind(kind: SourceKind): ArtifactKind {
  return kind === 'mission' ? 'mission' : 'playbook';
}

/**
 * The record a mirror is anchored to. Skills and playbooks share the
 * `playbook` record type because they share the catalog and the page.
 * @param kind
 * @param slug
 */
export function sourceRecord(kind: SourceKind, slug: string): { type: 'mission' | 'playbook'; id: string; role: typeof SOURCE_ROLE } {
  return { type: kind === 'mission' ? 'mission' : 'playbook', id: slug, role: SOURCE_ROLE };
}

/**
 * Where the mirror files in the artifacts log. A label, not a tree.
 * @param kind
 */
export function sourceFolder(kind: SourceKind): string {
  return `workspace/${sourceDir(kind)}`;
}

/**
 * The workspace directory for a kind.
 * @param kind
 */
export function sourceDir(kind: SourceKind): 'missions' | 'playbooks' | 'skills' {
  return kind === 'mission' ? 'missions' : kind === 'playbook' ? 'playbooks' : 'skills';
}

/**
 * The file's path relative to the workspace root, in the layout the loader
 * reads: a flat YAML for a mission, a SKILL.md folder for a playbook or skill.
 * @param kind
 * @param slug
 */
export function sourceRelPath(kind: SourceKind, slug: string): string {
  // DB-style slugs use underscores; the directory layout uses dashes
  // (`writer.ts` slugToDirname — inlined so this module stays import-free).
  const dir = slug.replace(/_/g, '-');
  return kind === 'mission'
    ? `${sourceDir(kind)}/${dir}.yaml`
    : `${sourceDir(kind)}/${dir}/SKILL.md`;
}

/** The spec a mirror stores — the authored text, plus what it is. */
export type MissionSourceSpec = { slug: string; yaml: string };
export type PlaybookSourceSpec = { slug: string; kind: 'skill' | 'playbook'; md: string };

/**
 * The mirror's spec for a kind and its file text.
 * @param kind
 * @param slug
 * @param content - The whole file, as authored.
 */
export function sourceSpec(kind: SourceKind, slug: string, content: string): MissionSourceSpec | PlaybookSourceSpec {
  return kind === 'mission'
    ? { slug, yaml: content }
    : { slug, kind, md: content };
}

/**
 * The file text held in a mirror's spec, whichever kind it is.
 * @param spec
 */
export function sourceContentOf(spec: Record<string, unknown>): string | null {
  const text = typeof spec.yaml === 'string' ? spec.yaml : typeof spec.md === 'string' ? spec.md : null;
  return text;
}

/**
 * The source kind a mirror artifact stands for, from its kind and spec.
 * @param artifactKind
 * @param spec
 */
export function sourceKindOf(artifactKind: string, spec: Record<string, unknown>): SourceKind | null {
  if (artifactKind === 'mission') {
    return 'mission';
  }
  if (artifactKind === 'playbook') {
    return spec.kind === 'skill' ? 'skill' : 'playbook';
  }
  return null;
}

export class SourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceValidationError';
  }
}

/** What validation hands back: the parsed manifest and the title the mirror shows. */
export type ValidatedSource = {
  kind: SourceKind;
  slug: string;
  title: string;
  description: string | null;
  manifest: Record<string, unknown>;
  /** For SKILL.md kinds: the markdown after the frontmatter. */
  body: string | null;
};

/**
 * Split a SKILL.md into its YAML frontmatter and its body. Same regex the
 * loader uses, with a message a person can act on.
 * @param raw
 */
export function splitFrontmatter(raw: string): { data: unknown; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new SourceValidationError('a SKILL.md starts with YAML frontmatter between two `---` lines (slug, name, description)');
  }
  const [, yamlText, body] = match;
  let data: unknown;
  try {
    data = parseYaml(yamlText ?? '');
  } catch (err) {
    throw new SourceValidationError(`the frontmatter is not valid YAML — ${(err as Error).message}`);
  }
  return { data, body: (body ?? '').trim() };
}

function issuesToText(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.map(i => `${i.path.length > 0 ? `${i.path.map(String).join('.')}: ` : ''}${i.message}`).join('; ');
}

/**
 * Validate a file's text through the REAL schema for its kind — the same
 * `MissionManifestSchema` / `PlaybookManifestSchema` the loader applies — and
 * refuse a slug that disagrees with the file it is being written as.
 * @param kind
 * @param slug - The slug the file is being written as.
 * @param content - The whole file.
 */
export function validateSourceText(kind: SourceKind, slug: string, content: string): ValidatedSource {
  if (!SlugSchema.safeParse(slug).success) {
    throw new SourceValidationError(`"${slug}" is not a valid slug (lowercase, start with a letter, letters/digits/dashes/underscores)`);
  }
  if (content.trim().length === 0) {
    throw new SourceValidationError('the file is empty');
  }
  if (kind === 'mission') {
    let raw: unknown;
    try {
      raw = parseYaml(content);
    } catch (err) {
      throw new SourceValidationError(`not valid YAML — ${(err as Error).message}`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new SourceValidationError('a mission file is a YAML mapping (slug, name, goal, agent, …)');
    }
    // `extends: core` marks a patch over a base default; the schema strips it,
    // so it is read here and validation runs on the rest.
    const parsed = MissionManifestSchema.partial().safeParse(raw);
    const isPatch = (raw as Record<string, unknown>).extends === 'core';
    const strict = isPatch ? parsed : MissionManifestSchema.safeParse(raw);
    if (!strict.success) {
      throw new SourceValidationError(issuesToText(strict.error.issues));
    }
    const m = strict.data as Record<string, unknown>;
    if (m.slug !== undefined && m.slug !== slug) {
      throw new SourceValidationError(`the file says slug "${String(m.slug)}" but is being written as "${slug}" — make them agree`);
    }
    return {
      kind,
      slug,
      title: typeof m.name === 'string' && m.name.trim() ? m.name : slug,
      description: typeof m.description === 'string' ? m.description : null,
      manifest: m,
      body: null,
    };
  }
  const fm = splitFrontmatter(content);
  const parsed = PlaybookManifestSchema.safeParse(fm.data);
  if (!parsed.success) {
    throw new SourceValidationError(issuesToText(parsed.error.issues));
  }
  if (parsed.data.slug !== slug) {
    throw new SourceValidationError(`the frontmatter says slug "${parsed.data.slug}" but is being written as "${slug}" — make them agree`);
  }
  return {
    kind,
    slug,
    title: parsed.data.name,
    description: parsed.data.description,
    manifest: parsed.data as Record<string, unknown>,
    body: fm.body,
  };
}
