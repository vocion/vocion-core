/**
 * Base-pack compose (ticket 007 · step 3).
 *
 * Resolves each resource slug across two layers — the activated base pack and
 * the workspace — into one list per kind, tagging provenance. Runs at the RAW
 * YAML level, BEFORE Zod validation, so an override file may carry directives
 * (`{ $append: [x] }`) and partial fields; the merged object is validated by
 * the normal schema afterwards (in loader.ts).
 *
 * The per-slug ladder (see the plan / docs/workspace.md):
 *   - base activated, no workspace file          → origin: core
 *   - workspace file, no base twin               → origin: workspace
 *   - workspace file `extends: core` + base twin → deep-merge → origin: merged
 *   - workspace file, base twin, NO `extends`    → hard error (declare intent)
 *   - override `extends: core`, base NOT active  → hard error (activate it first)
 *
 * Activation is agent-rooted and lives ONLY in workspace.yaml `use:` — see
 * {@link resolveActivation}. This module never reads the filesystem for
 * activation; it's handed already-parsed raw entries.
 */

import type { Origin } from './merge';
import { EXTENDS_CORE, mergeManifest } from './merge';

export type { Origin };

/** A parsed-but-unvalidated resource, keyed later by its `slug`. */
export type RawEntry = { slug: string; raw: Record<string, unknown>; sourceFile: string };

/** A composed resource: raw object + where it came from + which file "owns" it. */
export type ComposedEntry = { raw: Record<string, unknown>; sourceFile: string; origin: Origin };

/** The YAML resource kinds the base pack can ship + a workspace can override. */
export type ComposableKind = 'agent' | 'object type' | 'mission';

/**
 * Compose one kind's base + workspace entries into a single provenance-tagged
 * list. `activatedBase` holds only base entries the workspace activated;
 * `allBaseSlugs` is the FULL pack (activated or not) and is used purely for
 * collision detection, so shadowing a core slug you never activated is still
 * an error, not a silent win.
 * @param kind - resource kind, for error messages
 * @param workspaceEntries - raw workspace files of this kind (in walk order)
 * @param activatedBase - activated base entries keyed by slug
 * @param allBaseSlugs - every slug the pack ships for this kind
 */
export function composeKind(
  kind: ComposableKind,
  workspaceEntries: RawEntry[],
  activatedBase: Map<string, RawEntry>,
  allBaseSlugs: Set<string>,
): ComposedEntry[] {
  const out: ComposedEntry[] = [];
  const wsSlugs = new Set<string>();

  for (const ws of workspaceEntries) {
    wsSlugs.add(ws.slug);
    const isPatch = ws.raw.extends === EXTENDS_CORE;

    if (isPatch) {
      const base = activatedBase.get(ws.slug);
      if (!base) {
        const inPack = allBaseSlugs.has(ws.slug);
        throw new Error(
          inPack
            ? `${kind} "${ws.slug}" is marked \`extends: core\` but that base default isn't active — add it to workspace.yaml \`use:\` before overriding it (${ws.sourceFile})`
            : `${kind} "${ws.slug}" is marked \`extends: core\` but the base pack ships no such ${kind} (${ws.sourceFile})`,
        );
      }
      const patch = stripExtends(ws.raw);
      out.push({ raw: mergeManifest(base.raw, patch), sourceFile: ws.sourceFile, origin: 'merged' });
    } else {
      if (allBaseSlugs.has(ws.slug)) {
        throw new Error(
          `${kind} slug "${ws.slug}" collides with a base default — add \`extends: core\` to intentionally override it, or rename (${ws.sourceFile})`,
        );
      }
      out.push({ raw: ws.raw, sourceFile: ws.sourceFile, origin: 'workspace' });
    }
  }

  // Activated base defaults with no workspace file → inherited as-is.
  for (const [slug, base] of activatedBase) {
    if (!wsSlugs.has(slug)) {
      out.push({ raw: base.raw, sourceFile: base.sourceFile, origin: 'core' });
    }
  }

  return out;
}

/**
 * Return a shallow copy of `raw` with the `extends` marker removed.
 * @param raw
 */
function stripExtends(raw: Record<string, unknown>): Record<string, unknown> {
  const { extends: _drop, ...rest } = raw;
  return rest;
}

/**
 * A workspace's `use:` selector, already schema-parsed.
 * `'all'` activates the whole pack; the object form names agents (their skills
 * + object types + the skills' attached playbooks follow transitively), any
 * standalone skills, and any standalone playbooks; `null` (`extends` set,
 * `use` omitted) activates nothing.
 */
export type ActivationSelector = 'all' | { agents?: string[]; skills?: string[]; playbooks?: string[] } | null | undefined;

/**
 * A base-pack SKILL.md folder, reduced to what activation needs: its slug
 * and the playbook slugs its frontmatter attaches.
 */
export type FolderEntry = { slug: string; playbooks: string[] };

/** The raw base pack, one map per kind (keyed by slug), plus the full slug sets. */
export type PackRaw = {
  agents: Map<string, RawEntry>;
  objectTypes: Map<string, RawEntry>;
  missions: Map<string, RawEntry>;
  /** SKILL.md skill folders the pack ships. */
  skills: Map<string, FolderEntry>;
  /** SKILL.md playbook folders the pack ships. */
  playbooks: Map<string, FolderEntry>;
};

export type ActivatedPack = {
  agents: Map<string, RawEntry>;
  objectTypes: Map<string, RawEntry>;
  missions: Map<string, RawEntry>;
  /** Activated base skill slugs. */
  skills: Set<string>;
  /** Activated base playbook slugs. */
  playbooks: Set<string>;
};

/**
 * Resolve which base resources a workspace activates. Agent-rooted: naming an
 * agent pulls in the skills it declares in `skills:`, the object types in
 * `objectTypes:`, the playbooks in `playbooks:`, and each activated skill's
 * attached playbooks transitively. `use: all` takes the whole pack; `disable`
 * subtracts named agents/skills/playbooks even under `all`. Missions activate
 * only under `use: all` (the selector has no per-mission key).
 * @param pack - the full raw base pack
 * @param use - the workspace `use:` selector
 * @param disable - the workspace `disable:` selector
 * @param disable.agents
 * @param disable.skills
 * @param disable.playbooks
 */
export function resolveActivation(
  pack: PackRaw,
  use: ActivationSelector,
  disable?: { agents?: string[]; skills?: string[]; playbooks?: string[] },
): ActivatedPack {
  const agentSlugs = new Set<string>();
  const skillSlugs = new Set<string>();
  const playbookSlugs = new Set<string>();
  const objSlugs = new Set<string>();
  const missionSlugs = new Set<string>();

  if (use === 'all') {
    for (const s of pack.agents.keys()) {
      agentSlugs.add(s);
    }
    for (const s of pack.skills.keys()) {
      skillSlugs.add(s);
    }
    for (const s of pack.playbooks.keys()) {
      playbookSlugs.add(s);
    }
    for (const s of pack.objectTypes.keys()) {
      objSlugs.add(s);
    }
    for (const s of pack.missions.keys()) {
      missionSlugs.add(s);
    }
  } else if (use && typeof use === 'object') {
    for (const slug of use.agents ?? []) {
      if (!pack.agents.has(slug)) {
        throw new Error(`workspace.yaml \`use.agents\` names "${slug}", which the base pack does not ship`);
      }
      agentSlugs.add(slug);
      const agent = pack.agents.get(slug)!;
      for (const dep of asStringArray(agent.raw.skills)) {
        skillSlugs.add(dep);
      }
      for (const dep of asStringArray(agent.raw.objectTypes)) {
        objSlugs.add(dep);
      }
      for (const dep of asStringArray(agent.raw.playbooks)) {
        playbookSlugs.add(dep);
      }
    }
    for (const slug of use.skills ?? []) {
      if (!pack.skills.has(slug)) {
        throw new Error(`workspace.yaml \`use.skills\` names "${slug}", which the base pack does not ship`);
      }
      skillSlugs.add(slug);
    }
    for (const slug of use.playbooks ?? []) {
      if (!pack.playbooks.has(slug)) {
        throw new Error(`workspace.yaml \`use.playbooks\` names "${slug}", which the base pack does not ship`);
      }
      playbookSlugs.add(slug);
    }
  }
  // use == null/undefined → activate nothing (use: none).

  // An activated base skill carries its attached playbooks with it.
  for (const slug of skillSlugs) {
    for (const pb of pack.skills.get(slug)?.playbooks ?? []) {
      if (pack.playbooks.has(pb)) {
        playbookSlugs.add(pb);
      }
    }
  }

  for (const slug of disable?.agents ?? []) {
    agentSlugs.delete(slug);
  }
  for (const slug of disable?.skills ?? []) {
    skillSlugs.delete(slug);
  }
  for (const slug of disable?.playbooks ?? []) {
    playbookSlugs.delete(slug);
  }

  return {
    agents: filterMap(pack.agents, agentSlugs),
    objectTypes: filterMap(pack.objectTypes, objSlugs),
    missions: filterMap(pack.missions, missionSlugs),
    // Only slugs the pack actually ships; a dep that's workspace-only
    // simply isn't in the base map (the workspace provides it).
    skills: new Set([...skillSlugs].filter(s => pack.skills.has(s))),
    playbooks: new Set([...playbookSlugs].filter(s => pack.playbooks.has(s))),
  };
}

function filterMap(map: Map<string, RawEntry>, keep: Set<string>): Map<string, RawEntry> {
  const out = new Map<string, RawEntry>();
  for (const [slug, entry] of map) {
    if (keep.has(slug)) {
      out.set(slug, entry);
    }
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
