/**
 * list_wiki_pages / read_wiki_page / write_wiki_page — the workspace wiki as
 * the agent works it. Present only while the `wiki` plugin is on.
 *
 * The wiki is slow-changing, long-term context: the voice, the standing
 * rules, who is who, the decisions that hold. Its index is already mounted at
 * `/wiki/index.md` (and the pages that fit at `/wiki/<slug>.md`), so these
 * tools are for what the mount cannot do — read a page that did not fit, and
 * WRITE.
 *
 * Writing goes through the `wiki.write_page` action so it is done for you
 * with a bar (`libs/actions/wiki-write-page.ts`): above the plugin's
 * confidence threshold the page is written at once and shows with Undo;
 * below it a person decides on the card. The receipt says which.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ActionError, proposeAction } from '@/services/ActionService';
import { getWikiPage, listWikiPages, wikiSlug } from '@/services/wiki/WikiService';
import { emitSelfUpdate } from '../selfUpdateEvent';

export const WIKI_PLUGIN = 'wiki';

export function wikiPluginOn(ctx: RuntimeContext): boolean {
  return (ctx.enabledPlugins ?? []).includes(WIKI_PLUGIN);
}

export function listWikiPagesTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const pages = await listWikiPages(ctx.orgId);
      if (pages.length === 0) {
        return 'The wiki has no pages yet. The first durable fact you learn (a voice rule, a standing decision, who owns what) starts it — write_wiki_page.';
      }
      return pages.map(p => `- ${p.title} (slug ${p.slug}, v${p.version}, updated ${p.updatedAt.toISOString().slice(0, 10)}) — ${p.summary || 'no summary'} · ${p.href}`).join('\n');
    },
    {
      name: 'list_wiki_pages',
      description: 'List the workspace wiki\'s pages: title, slug, version, last update and one-line summary. The same list is mounted at /wiki/index.md; call this when you need it fresh mid-turn.',
      schema: z.object({}),
    },
  );
}

export function readWikiPageTool(ctx: RuntimeContext) {
  return tool(
    async ({ slug }) => {
      const page = await getWikiPage(ctx.orgId, slug);
      if (!page) {
        const pages = await listWikiPages(ctx.orgId);
        return `No wiki page "${wikiSlug(slug)}". Pages: ${pages.map(p => p.slug).join(', ') || '(none)'}.`;
      }
      return `# ${page.title}\n(slug ${page.slug} · v${page.version} · updated ${page.updatedAt.toISOString().slice(0, 10)} by ${page.lastAuthorKind} · ${page.href})\n\n${page.md}`;
    },
    {
      name: 'read_wiki_page',
      description: 'Read one wiki page in full by slug (or title). Cite it — the receipt line carries its link — when a standing fact you state came from it.',
      schema: z.object({
        slug: z.string().min(1).describe('The page slug, e.g. "founder-voice"; a title is normalised the same way.'),
      }),
    },
  );
}

export function writeWikiPageTool(ctx: RuntimeContext) {
  return tool(
    async (input) => {
      const { slug, title, md, append, summary, reason, confidence } = input as {
        slug: string;
        title: string;
        md?: string;
        append?: { heading: string; body: string };
        summary?: string;
        reason: string;
        confidence: number;
      };
      // An agent whose `harness.ownLedger` names this kind earns trust on its
      // own ledger: the write keys the ladder on `wiki.write_page.<slug>`.
      // Read from the agent's config, never from the model's arguments.
      const ownLedger = (ctx.harnessConfig.ownLedger ?? []).includes('wiki.write_page') && ctx.agentSlug ? ctx.agentSlug : undefined;
      const proposalInput = { slug, title, md, append, summary, reason, ...(ownLedger ? { by: ownLedger } : {}) };
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: 'wiki.write_page',
          input: proposalInput,
          principal: {
            kind: 'agent',
            id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
            scope: { orgId: ctx.orgId },
            grants: ['*'],
            autonomy: 2,
          },
          invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
          proposal: {
            confidence,
            rationale: reason,
            suggestedDecision: 'approve',
            suggestedDecisionReason: reason.slice(0, 160),
          },
        });
        ctx.emit({ type: 'tool_progress', tool: 'write_wiki_page', meta: { runId: res.runId, status: res.status, outcome: res.outcome } } as never);
        emitSelfUpdate(ctx, { actionId: 'wiki.write_page', input: proposalInput, res });
        if (res.outcome === 'already_decided') {
          return `Not written: a person already decided an identical change to "${slug}" (run #${res.runId}, ${res.status}). Say so; do not propose it again.`;
        }
        if (res.status === 'pending') {
          return `Wiki change to "${title}" is PENDING a person's decision (run #${res.runId}, confidence ${confidence} was under the bar). Do NOT say the page was written — say it is queued in Review.`;
        }
        const r = (res.result ?? {}) as { href?: string; version?: number; created?: boolean; unchanged?: boolean };
        if (r.unchanged) {
          return `Wiki page "${title}" already said exactly this — no new version was written (run #${res.runId}).`;
        }
        return `Wiki page "${title}" ${r.created ? 'created' : `revised to v${r.version}`} — done for you (run #${res.runId}, confidence ${confidence}). ${r.href ?? ''} A person can undo it from Review › Decided.`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Wiki write refused (${err.code}): ${err.message}`;
        }
        return `Wiki write failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'write_wiki_page',
      description: 'Create or revise a page of the workspace wiki — long-term context: the voice, standing rules, who is who, decisions that hold. Use it when you learn a durable fact, when a person corrects a standing one, or when the curator consolidates. Pass the WHOLE page in `md` to rewrite, or `append` a dated section to a running page. Done for you above the confidence bar (the page is written and undoable); below it a person decides on a Review card. Never write activity logs or pasted data here — the wiki is for what stays true.',
      schema: z.object({
        slug: z.string().min(1).max(120).describe('Page slug, e.g. "founder-voice", "standing-rules", "who-is-who", "decisions". Reuse an existing slug to revise.'),
        title: z.string().min(1).max(200).describe('Page title.'),
        md: z.string().max(60_000).optional().describe('The whole page body, markdown. Omit when appending.'),
        append: z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(20_000) }).optional().describe('Add a dated section at the end instead of rewriting. For running pages: decisions, glossary, changes.'),
        summary: z.string().max(200).optional().describe('One line the index shows.'),
        reason: z.string().min(1).max(500).describe('Why this change, in one or two sentences a person can check — it becomes the version\'s change summary.'),
        confidence: z.number().min(0).max(1).describe('Your confidence this belongs in the wiki as written, 0–1. An honest number decides whether it is written now or reviewed first.'),
      }),
    },
  );
}

/**
 * The wiki tool set — empty unless the `wiki` plugin is on for this workspace.
 * @param ctx
 */
export function wikiTools(ctx: RuntimeContext) {
  if (!wikiPluginOn(ctx)) {
    return [];
  }
  return [listWikiPagesTool(ctx), readWikiPageTool(ctx), writeWikiPageTool(ctx)];
}
