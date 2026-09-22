/**
 * wiki.write_page — an agent writes or revises a page of the workspace wiki.
 *
 * The write itself is `services/wiki/WikiService.ts` (a new version of a
 * markdown artifact). Going through the action framework is what makes it
 * DONE FOR YOU with a bar: the agent proposes with a confidence; a reversible,
 * low-risk kind executes on its own above the threshold (the wiki plugin's
 * trust.yaml sets it at 0.6 — a wiki edit is cheap to undo and expensive to
 * ask about every time) and shows in the Review queue's Decided tab with Undo;
 * below the bar the card carries the page and the reason, and a person decides.
 *
 * `undo` restores the previous version — history is append-only, so the undo
 * is itself a version, and nothing is ever lost.
 */

import type { Action } from './types';
import { z } from 'zod';

const wikiWriteInput = z.object({
  /** The page, by slug. A title works too; it is normalised the same way. */
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  /** The whole page body, markdown. Omit when appending. */
  md: z.string().max(60_000).optional(),
  /** Add a dated section at the end instead of rewriting the page. */
  append: z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(20_000) }).optional(),
  /** One line the index shows. */
  summary: z.string().max(200).optional(),
  /** Why — the version history reads this back. */
  reason: z.string().min(1).max(500),
  /**
   * The agent whose ledger this write earns on, when its `harness.ownLedger`
   * names `wiki.write_page`. Set by the `write_wiki_page` tool from the
   * agent it runs as — never offered to the model — and read by
   * `policyKeyFor`, so the wiki plugin can hold one agent's writes at review
   * while the curator's keep the shared bar.
   */
  by: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(120).optional(),
}).refine(v => Boolean(v.md) !== Boolean(v.append), 'pass exactly one of md (whole page) or append (a dated section)');

export type WikiWriteInput = z.infer<typeof wikiWriteInput>;

export const wikiWritePageAction: Action<typeof wikiWriteInput> = {
  id: 'wiki.write_page',
  name: 'Write a wiki page',
  description: 'Create or revise a page of the workspace wiki (long-term context: voice, standing rules, who is who, decisions). Reversible — the previous version is one Undo away.',
  inputSchema: wikiWriteInput,
  grant: 'write_wiki',
  external: false,
  // The wiki is what the system knows, so its bar is the workspace's
  // learning dial rather than the platform's flat one. The wiki plugin's
  // own `autoApproveAbove: 0.6` still wins where that plugin is on.
  selfImproving: true,
  // One action, one ledger per agent that asked for its own: the researcher's
  // writes are gated, tiered and scored under `wiki.write_page.wiki-researcher`
  // while a write with no `by` stays under the kind itself (`policyKey.ts`).
  policyKeyFor: input => (input.by ? `wiki.write_page.${input.by}` : 'wiki.write_page'),
  dedupKeyFor: input => `wiki.write_page:${input.slug.toLowerCase()}`,
  async reviewCard(ctx, input) {
    const { getWikiPage, wikiSlug } = await import('@/services/wiki/WikiService');
    const existing = await getWikiPage(ctx.orgId, input.slug);
    const body = input.md ?? `## ${input.append!.heading}\n\n${input.append!.body}`;
    return {
      title: `${existing ? 'Revise' : 'Create'} wiki page: ${input.title}`,
      system: 'Wiki',
      summary: input.reason,
      fields: [
        { label: 'Page', value: `${input.title} (${wikiSlug(input.slug)})`, ...(existing ? { href: existing.href } : {}) },
        { label: existing ? 'Change' : 'Content', value: input.append ? `appends a section "${input.append.heading}"` : `${body.length.toLocaleString()} characters${existing ? `, replaces v${existing.version}` : ''}` },
        { label: 'Preview', value: body.slice(0, 600) + (body.length > 600 ? '…' : '') },
        ...(input.by ? [{ label: 'Proposed by', value: `${input.by} — earns trust on its own ledger (wiki.write_page.${input.by})` }] : []),
      ],
      nextAction: existing ? `Approving writes v${existing.version + 1}; the previous version stays in the history.` : 'Approving creates the page in the wiki folder.',
      verbs: { approve: existing ? 'Revise' : 'Create', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { writeWikiPage } = await import('@/services/wiki/WikiService');
    const { track } = await import('@/services/adoption/track');
    const author = ctx.invokedBy?.startsWith('agent:')
      ? { kind: 'agent' as const, id: ctx.invokedBy }
      : { kind: ctx.reviewedBy ? 'human' as const : 'system' as const, id: ctx.reviewedBy ?? ctx.invokedBy ?? null };
    const res = await writeWikiPage(ctx.orgId, {
      slug: input.slug,
      title: input.title,
      md: input.md,
      append: input.append,
      summary: input.summary,
      author,
      reason: input.reason,
    });
    void track({ orgId: ctx.orgId, userId: ctx.reviewedBy ?? ctx.invokedBy ?? 'system' }, 'wiki.page_written', {
      agentSlug: ctx.invokedBy?.startsWith('agent:') ? ctx.invokedBy.slice(6) : undefined,
      meta: { mode: res.created ? 'created' : res.unchanged ? 'unchanged' : 'revised', append: Boolean(input.append) },
    });
    return {
      artifactId: res.page.id,
      slug: res.page.slug,
      version: res.page.version,
      previousVersion: res.previousVersion,
      created: res.created,
      unchanged: res.unchanged,
      href: res.page.href,
    };
  },
  async undo(ctx, _input, result) {
    const { deleteArtifact, restoreArtifactVersion } = await import('@/services/ArtifactService');
    const id = Number(result.artifactId);
    if (!Number.isInteger(id) || id <= 0) {
      return { undone: false, reason: 'no artifact id on the run' };
    }
    if (result.created) {
      await deleteArtifact({ orgId: ctx.orgId, id });
      return { undone: true, deleted: id };
    }
    const prev = Number(result.previousVersion);
    if (!Number.isInteger(prev) || prev <= 0) {
      return { undone: false, reason: 'no previous version to restore' };
    }
    const restored = await restoreArtifactVersion({ orgId: ctx.orgId, id, version: prev, author: { kind: 'human', id: ctx.reviewedBy ?? null } });
    return { undone: true, restoredVersion: prev, asVersion: restored.version.version };
  },
};
