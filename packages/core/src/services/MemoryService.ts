/**
 * MemoryService — typed, scoped agent memory on the LangGraph Store.
 *
 * Successor of LearningsService (Phase 1 of the scoped-memory plan): the
 * namespace manifest (`memory_namespace`, seeded by workspace:apply) is the
 * whitelist that `learning_step` used to be, and approved rules are entries
 * in the `memory` table — FileData-shaped values keyed by their file path
 * under `/memories/<namespace path>/`, readable by deepagents' StoreBackend
 * as ordinary files. Content is rendered once, at write time; runtime reads
 * (`assembleMemoryFiles`) select pre-rendered content and never re-render.
 *
 * The human approval gate stays the only write path for behavior-changing
 * memory: `addRule` is called by candidate approval, workspace:apply, and
 * the gated agent tool — never by an agent writing files (both loops deny
 * writes under `/memories/**`).
 *
 * Dedup: trigram Jaccard at 0.72, unchanged from LearningsService (see
 * rev-ai's difflib lineage in the git history of that file).
 */

import { and, asc, eq, like, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { MEMORY_STORE_NAMESPACE, pgTextArrayLiteral } from '@/libs/memory/store';
import { memoryNamespaceSchema, memorySchema } from '@/models/Schema';

const DEDUP_THRESHOLD = 0.72;

/* ------------------------------------------------------------------ */
/* Value + key shapes                                                  */
/* ------------------------------------------------------------------ */

/** Provenance carried on every rule entry, under `value.meta`. */
export type MemoryRuleMeta = {
  kind: 'rule';
  source: string | null;
  createdBy: string | null;
  /** How many separate pieces of feedback asked for this rule. */
  occurrenceCount: number;
  adoptedAt: string;
  /** 'correct' | 'reinforce' when the rule came through the feedback loop. */
  polarity?: string;
  /** 'preference' | 'knowledge' | 'procedure' | 'episode'. Absent = legacy procedure-flavoured rule. */
  type?: string;
};

/** The stored value: FileData (StoreBackend-readable) + provenance. */
export type MemoryRuleValue = {
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
  meta: MemoryRuleMeta;
};

export type MemoryRule = {
  /** The store key — the rule's file path. The rule's identity everywhere. */
  key: string;
  ruleText: string;
  source: string | null;
  createdBy: string | null;
  createdAt: Date;
  occurrenceCount: number;
  lastUsedAt: Date | null;
};

/**
 * Where the memory filesystem mounts in the agent's view. CompositeBackend
 * STRIPS this route prefix before handing a path to the StoreBackend, so
 * store KEYS are route-relative (`/workspace/global/r5.md`) and only the
 * mounted view carries `/memories` in front.
 */
export const MEMORY_MOUNT_ROOT = '/memories';

/**
 * The store-key directory for a namespace row, e.g. `/workspace/global/`.
 * @param path - The manifest row's `path`.
 */
export function namespaceFilePrefix(path: string): string {
  return `/${path}/`;
}

/**
 * The agent-visible path for a store key.
 * @param key - Route-relative store key.
 */
export function mountPathFor(key: string): string {
  return `${MEMORY_MOUNT_ROOT}${key}`;
}

/**
 * The store path for a namespace, derived from its scope. Phase 1 uses
 * workspace scope only; the other kinds land with Phase 2's classifier and
 * card support, but the derivation is total so nothing else needs to change.
 * @param scope - Scope kind, ref and name.
 * @param scope.scopeKind
 * @param scope.scopeRef
 * @param scope.name
 */
export function namespacePath(scope: { scopeKind: string; scopeRef?: string | null; name: string }): string {
  const ref = scope.scopeRef ?? '';
  switch (scope.scopeKind) {
    case 'workspace': return `workspace/${scope.name}`;
    case 'object': return `workspace/objects/${ref}/${scope.name}`;
    case 'agent': return `agents/${ref}/${scope.name}`;
    case 'user': return `users/${ref}/${scope.name}`;
    case 'workflow': return `workflows/${ref}/${scope.name}`;
    case 'mission': return `missions/${ref}/${scope.name}`;
    case 'run': return `runs/${ref}/${scope.name}`;
    default: throw new Error(`unknown memory scope kind ${JSON.stringify(scope.scopeKind)}`);
  }
}

function ruleToView(row: { key: string; value: Record<string, unknown>; createdAt: Date; lastUsedAt: Date | null }): MemoryRule {
  const value = row.value as Partial<MemoryRuleValue>;
  const meta = (value.meta ?? {}) as Partial<MemoryRuleMeta>;
  return {
    key: row.key,
    ruleText: typeof value.content === 'string' ? value.content : '',
    source: meta.source ?? null,
    createdBy: meta.createdBy ?? null,
    createdAt: row.createdAt,
    occurrenceCount: meta.occurrenceCount ?? 1,
    lastUsedAt: row.lastUsedAt,
  };
}

async function findNamespace(orgId: string, name: string) {
  const [row] = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(and(eq(memoryNamespaceSchema.orgId, orgId), eq(memoryNamespaceSchema.name, name)));
  return row;
}

async function rulesUnder(orgId: string, path: string) {
  return db
    .select()
    .from(memorySchema)
    .where(and(
      eq(memorySchema.orgId, orgId),
      like(memorySchema.key, `${namespaceFilePrefix(path)}%`),
      sql`(${memorySchema.expiresAt} is null or ${memorySchema.expiresAt} > now())`,
    ))
    .orderBy(asc(memorySchema.key));
}

/* ------------------------------------------------------------------ */
/* Namespace catalog                                                   */
/* ------------------------------------------------------------------ */

export async function listNamespaces(orgId: string) {
  const namespaces = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(eq(memoryNamespaceSchema.orgId, orgId))
    .orderBy(asc(memoryNamespaceSchema.id));

  const counts = await db
    .select({ key: memorySchema.key, lastUsedAt: memorySchema.lastUsedAt })
    .from(memorySchema)
    .where(and(
      eq(memorySchema.orgId, orgId),
      sql`(${memorySchema.expiresAt} is null or ${memorySchema.expiresAt} > now())`,
    ));

  return namespaces.map((ns) => {
    const mine = counts.filter(c => c.key.startsWith(namespaceFilePrefix(ns.path)));
    const lastUsedAt = mine.reduce<Date | null>(
      (max, c) => (c.lastUsedAt && (!max || c.lastUsedAt > max) ? c.lastUsedAt : max),
      null,
    );
    return {
      name: ns.name,
      scopeKind: ns.scopeKind,
      scopeRef: ns.scopeRef,
      path: ns.path,
      title: ns.title,
      description: ns.description,
      preamble: ns.preamble,
      agentSlugs: ns.agentSlugs,
      ruleCount: mine.length,
      /** Staleness: when an agent last had this namespace mounted. */
      lastUsedAt,
    };
  });
}

/**
 * One namespace's rules — throws on an unknown name, like getLearnings did.
 * @param orgId
 * @param name
 */
export async function getNamespace(orgId: string, name: string) {
  const ns = await findNamespace(orgId, name);
  if (!ns) {
    throw new Error(`unknown memory namespace ${JSON.stringify(name)}`);
  }
  const rows = await rulesUnder(orgId, ns.path);
  return {
    step: ns.name,
    name: ns.name,
    path: ns.path,
    title: ns.title,
    preamble: ns.preamble,
    rules: rows.map(ruleToView),
  };
}

/* ------------------------------------------------------------------ */
/* Dedup — trigram Jaccard (moved verbatim from LearningsService)      */
/* ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`#>]+/g, ' ') // strip markdown punct
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s: string): Set<string> {
  const n = normalize(s);
  const padded = `  ${n} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of A) {
    if (B.has(t)) {
      intersection++;
    }
  }
  const union = A.size + B.size - intersection;
  return intersection / union;
}

export async function checkDedup(
  orgId: string,
  namespaceName: string,
  ruleText: string,
): Promise<{ ok: true } | { ok: false; existingKey: string; existingRule: string; similarity: number }> {
  const data = await getNamespace(orgId, namespaceName);
  let best: { key: string; ruleText: string; score: number } | null = null;
  for (const r of data.rules) {
    const score = similarity(ruleText, r.ruleText);
    if (score >= DEDUP_THRESHOLD && (best === null || score > best.score)) {
      best = { key: r.key, ruleText: r.ruleText, score };
    }
  }
  if (best === null) {
    return { ok: true };
  }
  return {
    ok: false,
    existingKey: best.key,
    existingRule: best.ruleText,
    similarity: Math.round(best.score * 1000) / 1000,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations — every caller is on the approved side of the gate        */
/* ------------------------------------------------------------------ */

function newRuleKey(path: string): string {
  const slug = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${namespaceFilePrefix(path)}${slug}.md`;
}

/**
 * Write one approved rule into the store. Callers: candidate approval
 * (LearningCandidateService), workspace:apply seeding, the gated
 * `add_learning` tool, and the REST/oRPC admin surface.
 * @param opts
 * @param opts.orgId
 * @param opts.stepName - Namespace name (kept as `stepName` so the queue's column keeps meaning what it meant).
 * @param opts.ruleText
 * @param opts.source - Provenance: 'manual', 'feedback:<id>', 'workspace:<ruleId>', …
 * @param opts.createdBy
 * @param opts.agentSlug - For the adoption stream, when the rule is about one agent.
 * @param opts.occurrenceCount - Carried from the candidate on approval.
 * @param opts.polarity
 * @param opts.type
 * @param opts.key - Fixed key for idempotent writers (workspace:apply); omitted keys are generated.
 */
export async function addRule(opts: {
  orgId: string;
  stepName: string;
  ruleText: string;
  source?: string;
  createdBy?: string;
  agentSlug?: string | null;
  occurrenceCount?: number;
  polarity?: string;
  /** Memory type: 'preference' | 'knowledge' | 'procedure' | 'episode'. */
  type?: string;
  key?: string;
}) {
  const text = opts.ruleText.trim();
  if (!text) {
    throw new Error('rule text must not be empty');
  }
  const ns = await findNamespace(opts.orgId, opts.stepName);
  if (!ns) {
    throw new Error(`unknown memory namespace ${opts.stepName}`);
  }
  const dup = await checkDedup(opts.orgId, opts.stepName, text);
  if (!dup.ok && dup.existingKey !== opts.key) {
    return {
      ok: false as const,
      error: 'near_duplicate' as const,
      existing: dup,
      detail: `near-duplicate (similarity ${dup.similarity}) of existing rule ${dup.existingKey}. Use updateRule to refine that one, or reword if genuinely different.`,
    };
  }
  const now = new Date();
  const key = opts.key ?? newRuleKey(ns.path);
  const value: MemoryRuleValue = {
    content: text,
    mimeType: 'text/markdown',
    created_at: now.toISOString(),
    modified_at: now.toISOString(),
    meta: {
      kind: 'rule',
      source: opts.source ?? null,
      createdBy: opts.createdBy ?? null,
      occurrenceCount: opts.occurrenceCount ?? 1,
      adoptedAt: now.toISOString(),
      ...(opts.polarity ? { polarity: opts.polarity } : {}),
      ...(opts.type ? { type: opts.type } : {}),
    },
  };
  const [row] = await db
    .insert(memorySchema)
    .values({ orgId: opts.orgId, namespace: MEMORY_STORE_NAMESPACE, key, value })
    .onConflictDoUpdate({
      target: [memorySchema.orgId, memorySchema.namespace, memorySchema.key],
      // A fixed-key re-write (workspace re-apply) updates the text and stamps
      // modified_at, but keeps the original meta lineage fields fresh — the
      // seed rule IS its latest authored text.
      set: { value, updatedAt: new Date() },
    })
    .returning();

  if (opts.createdBy && row) {
    // Deliberately not awaited — adoption tracking must never slow down or
    // fail the write. Own catch: no caller is left to surface a rejection.
    void (async () => {
      try {
        const [{ track }, { agentSlugFromPrincipal }] = await Promise.all([
          import('@/services/adoption/track'),
          import('@/services/adoption/attribution'),
        ]);
        await track({ orgId: opts.orgId, userId: opts.createdBy! }, 'learning.added', {
          agentSlug: opts.agentSlug ?? agentSlugFromPrincipal(opts.source),
          resource: ['memory', row.key],
        });
      } catch (error) {
        console.error(`[MemoryService] could not track learning.added for ${row.key}`, error);
      }
    })();
  }
  return { ok: true as const, rule: ruleToView(row!) };
}

export async function updateRule(opts: { orgId: string; key: string; ruleText: string }) {
  const text = opts.ruleText.trim();
  if (!text) {
    throw new Error('rule text must not be empty');
  }
  const rows = await db.execute(sql`
    UPDATE memory
    SET value = jsonb_set(jsonb_set(value, '{content}', to_jsonb(${text}::text)), '{modified_at}', to_jsonb(${new Date().toISOString()}::text)),
        updated_at = now()
    WHERE org_id = ${opts.orgId} AND key = ${opts.key}
    RETURNING key, value, created_at, last_used_at
  `);
  const row = (rows as unknown as { rows: Array<{ key: string; value: Record<string, unknown>; created_at: string; last_used_at: string | null }> }).rows[0];
  if (!row) {
    return { ok: false as const, error: 'not_found' as const };
  }
  return {
    ok: true as const,
    rule: ruleToView({ key: row.key, value: row.value, createdAt: new Date(row.created_at), lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null }),
  };
}

export async function removeRule(opts: { orgId: string; key: string }) {
  const [row] = await db
    .delete(memorySchema)
    .where(and(eq(memorySchema.orgId, opts.orgId), eq(memorySchema.key, opts.key)))
    .returning();
  if (!row) {
    return { ok: false as const, error: 'not_found' as const };
  }
  return { ok: true as const, removedKey: row.key };
}

/**
 * Raise a rule's occurrence count — feedback restated an adopted rule.
 * @param orgId
 * @param key
 */
export async function bumpOccurrence(orgId: string, key: string): Promise<void> {
  await db.execute(sql`
    UPDATE memory
    SET value = jsonb_set(value, '{meta,occurrenceCount}',
          to_jsonb(coalesce((value #>> '{meta,occurrenceCount}')::int, 1) + 1)),
        updated_at = now()
    WHERE org_id = ${orgId} AND key = ${key}
  `);
}

/* ------------------------------------------------------------------ */
/* Scoped namespaces — created on first use, one per (kind, ref)       */
/* ------------------------------------------------------------------ */

/** The conventional bucket name per scope kind (the plan's memory structure). */
const SCOPE_BUCKET: Record<string, string> = {
  agent: 'procedures',
  user: 'preferences',
  object: 'knowledge',
  workflow: 'learnings',
  mission: 'context',
  run: 'episodes',
};

/**
 * Find or create the namespace for a scoped memory — `agents/<slug>/procedures`,
 * `users/<id>/preferences`, `workspace/objects/<type/id>/knowledge`, and so on.
 * Auto-created rows carry a derived unique `name` (the path with slashes
 * flattened) since `name` is unique per org and every agent's bucket is
 * called "procedures".
 * @param orgId
 * @param scopeKind - 'agent' | 'user' | 'object' | 'workflow' | 'mission' | 'run'.
 * @param scopeRef - The scoped entity (slug, user id, `type/id`).
 */
export async function ensureScopedNamespace(orgId: string, scopeKind: string, scopeRef: string) {
  const bucket = SCOPE_BUCKET[scopeKind];
  if (!bucket) {
    throw new Error(`unknown memory scope kind ${JSON.stringify(scopeKind)}`);
  }
  const path = namespacePath({ scopeKind, scopeRef, name: bucket });
  const [existing] = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(and(eq(memoryNamespaceSchema.orgId, orgId), eq(memoryNamespaceSchema.path, path)));
  if (existing) {
    return existing;
  }
  const [row] = await db
    .insert(memoryNamespaceSchema)
    .values({
      orgId,
      name: path.replace(/\//g, '-'),
      scopeKind,
      scopeRef,
      path,
      title: `${bucket[0]!.toUpperCase()}${bucket.slice(1)} · ${scopeRef}`,
      description: `${scopeKind}-scoped ${bucket} for ${scopeRef}`,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    return row;
  }
  // Lost a create race — the winner's row is the answer.
  const [raced] = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(and(eq(memoryNamespaceSchema.orgId, orgId), eq(memoryNamespaceSchema.path, path)));
  return raced!;
}

/* ------------------------------------------------------------------ */
/* Runtime assembly — what an agent's turn mounts                      */
/* ------------------------------------------------------------------ */

/**
 * Character budget for a turn's mounted memory. Rules are short; a workspace
 * past this is a consolidation problem (Phase 4), not a bigger-prompt
 * problem. Matches the digest middleware's own cap.
 */
const MEMORY_BUDGET_CHARS = 24_000;

/** Who this turn is for — resolves which memory layers apply. */
export type MemoryAssemblyContext = {
  agentSlug?: string;
  /** Workspace-scoped namespace names the agent mounts (agent.learningSteps). */
  workspaceSteps?: string[];
  userId?: string;
  missionSlug?: string;
  workflowSlug?: string;
};

/**
 * The memory files for one agent turn — the layer stack of the scoped-memory
 * plan, resolved with precedence:
 *
 *   workspace policies → agent procedures → workflow learnings →
 *   mission context → user preferences
 *
 * (Business-object knowledge deliberately does NOT mount here: "objects in
 * play" are only known once the agent looks one up, so object knowledge rides
 * the `lookup_objects` tool result instead.)
 *
 * Entries mount exactly as stored (content rendered at write time), plus a
 * `_preamble.md` per namespace that has one. Over budget, entries are kept by
 * layer precedence, then occurrence count, then recency — a memory nobody
 * repeated ages out of the prompt first. `last_used_at` is stamped on the
 * mounted entries fire-and-forget via raw SQL so the staleness signal never
 * churns `updated_at`.
 *
 * Unknown workspace names are skipped silently — the agent's `learningSteps`
 * list is the authoring contract; missing namespaces mean workspace:apply has
 * not seeded them yet.
 * @param orgId
 * @param ctx - The turn's identities; each present one adds its layer.
 */
export async function assembleAgentMemory(
  orgId: string,
  ctx: MemoryAssemblyContext,
): Promise<Record<string, string>> {
  // Layer resolution, in precedence order.
  const layers: Array<typeof memoryNamespaceSchema.$inferSelect> = [];
  for (const name of ctx.workspaceSteps ?? []) {
    const ns = await findNamespace(orgId, name);
    if (ns) {
      layers.push(ns);
    }
  }
  const scoped: Array<[string, string | undefined]> = [
    ['agent', ctx.agentSlug],
    ['workflow', ctx.workflowSlug],
    ['mission', ctx.missionSlug],
    ['user', ctx.userId],
  ];
  for (const [kind, ref] of scoped) {
    if (!ref) {
      continue;
    }
    const [ns] = await db
      .select()
      .from(memoryNamespaceSchema)
      .where(and(
        eq(memoryNamespaceSchema.orgId, orgId),
        eq(memoryNamespaceSchema.scopeKind, kind),
        eq(memoryNamespaceSchema.scopeRef, ref),
      ));
    if (ns) {
      layers.push(ns);
    }
  }

  type Entry = { path: string; content: string; key?: string; layer: number; occurrenceCount: number; createdAt: Date };
  const entries: Entry[] = [];
  for (const [layer, ns] of layers.entries()) {
    if (ns.preamble?.trim()) {
      entries.push({
        path: mountPathFor(`${namespaceFilePrefix(ns.path)}_preamble.md`),
        content: `# ${ns.title}\n\n${ns.preamble.trim()}`,
        layer,
        occurrenceCount: Number.MAX_SAFE_INTEGER, // a preamble never ages out before its rules
        createdAt: ns.createdAt,
      });
    }
    for (const row of await rulesUnder(orgId, ns.path)) {
      const value = row.value as Partial<MemoryRuleValue>;
      const meta = (value.meta ?? {}) as Partial<MemoryRuleMeta>;
      if (typeof value.content === 'string' && value.content.trim()) {
        entries.push({
          path: mountPathFor(row.key),
          content: value.content,
          key: row.key,
          layer,
          occurrenceCount: meta.occurrenceCount ?? 1,
          createdAt: row.createdAt,
        });
      }
    }
  }

  const total = entries.reduce((n, e) => n + e.content.length, 0);
  let kept = entries;
  if (total > MEMORY_BUDGET_CHARS) {
    const ranked = [...entries].sort((a, b) =>
      a.layer - b.layer
      || b.occurrenceCount - a.occurrenceCount
      || b.createdAt.getTime() - a.createdAt.getTime());
    kept = [];
    let used = 0;
    for (const entry of ranked) {
      if (used + entry.content.length > MEMORY_BUDGET_CHARS) {
        continue;
      }
      used += entry.content.length;
      kept.push(entry);
    }
  }

  const out: Record<string, string> = {};
  const mountedKeys: string[] = [];
  for (const entry of kept) {
    out[entry.path] = entry.content;
    if (entry.key) {
      mountedKeys.push(entry.key);
    }
  }
  if (mountedKeys.length > 0) {
    void db.execute(sql`
      UPDATE memory SET last_used_at = now()
      WHERE org_id = ${orgId} AND key = ANY(${pgTextArrayLiteral(mountedKeys)}::text[])
    `).catch((error) => {
      console.error('[MemoryService] could not stamp last_used_at', error);
    });
  }
  return out;
}

/**
 * Workspace-steps-only view of the assembly — what Phase 1 callers used.
 * @param orgId
 * @param namespaceNames - Workspace-scoped namespace names.
 */
export async function assembleMemoryFiles(
  orgId: string,
  namespaceNames: string[],
): Promise<Record<string, string>> {
  return assembleAgentMemory(orgId, { workspaceSteps: namespaceNames });
}

/**
 * Approved knowledge for specific business objects — the "entities in play"
 * layer, consumed by the lookup_objects tool so a client fact reaches the
 * model only on turns that actually touch that client.
 * @param orgId
 * @param refs - Object scope refs (`<type slug>/<object id>`).
 */
export async function objectKnowledge(
  orgId: string,
  refs: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ref of refs) {
    const [ns] = await db
      .select()
      .from(memoryNamespaceSchema)
      .where(and(
        eq(memoryNamespaceSchema.orgId, orgId),
        eq(memoryNamespaceSchema.scopeKind, 'object'),
        eq(memoryNamespaceSchema.scopeRef, ref),
      ));
    if (!ns) {
      continue;
    }
    const texts = (await rulesUnder(orgId, ns.path))
      .map(row => (row.value as Partial<MemoryRuleValue>).content)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    if (texts.length > 0) {
      out.set(ref, texts);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Visible intelligence — the agent page's growing-memory panel        */
/* ------------------------------------------------------------------ */

export type AgentMemoryStats = {
  /** Entries currently mounted for this agent (workspace steps + its own scoped buckets). */
  activeCount: number;
  /** Entries adopted in the last 90 days. */
  adoptedLast90: number;
  /** Composition: one badge per namespace the agent reads. */
  composition: Array<{ name: string; title: string; scopeKind: string; count: number }>;
  /** Cumulative adoption series: one point per day an adoption happened. */
  series: Array<{ day: string; cumulative: number }>;
};

/**
 * What this agent knows, for the agent page's growing-memory panel:
 * cumulative count stepped up by each adoption (consolidation steps it down,
 * Phase 4), composition by namespace. Counts what the agent READS; the
 * adoption page shows what reviewers decided.
 * @param orgId
 * @param agentSlug
 * @param workspaceSteps - The agent's mounted workspace namespace names.
 */
export async function agentMemoryStats(
  orgId: string,
  agentSlug: string,
  workspaceSteps: string[],
): Promise<AgentMemoryStats> {
  const namespaces: Array<typeof memoryNamespaceSchema.$inferSelect> = [];
  for (const name of workspaceSteps) {
    const ns = await findNamespace(orgId, name);
    if (ns) {
      namespaces.push(ns);
    }
  }
  const scopedRows = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(and(
      eq(memoryNamespaceSchema.orgId, orgId),
      eq(memoryNamespaceSchema.scopeKind, 'agent'),
      eq(memoryNamespaceSchema.scopeRef, agentSlug),
    ));
  namespaces.push(...scopedRows);

  const composition: AgentMemoryStats['composition'] = [];
  const adoptedAts: Date[] = [];
  for (const ns of namespaces) {
    const rules = await rulesUnder(orgId, ns.path);
    composition.push({ name: ns.name, title: ns.title, scopeKind: ns.scopeKind, count: rules.length });
    for (const row of rules) {
      adoptedAts.push(row.createdAt);
    }
  }
  adoptedAts.sort((a, b) => a.getTime() - b.getTime());
  const series: AgentMemoryStats['series'] = [];
  let cumulative = 0;
  for (const at of adoptedAts) {
    cumulative++;
    const day = at.toISOString().slice(0, 10);
    const last = series[series.length - 1];
    if (last && last.day === day) {
      last.cumulative = cumulative;
    } else {
      series.push({ day, cumulative });
    }
  }
  const quarterAgo = Date.now() - 90 * 86_400_000;
  return {
    activeCount: adoptedAts.length,
    adoptedLast90: adoptedAts.filter(at => at.getTime() >= quarterAgo).length,
    composition,
    series,
  };
}
