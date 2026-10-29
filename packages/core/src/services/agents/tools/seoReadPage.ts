/**
 * seo_read_page — one SEO page whole, in one call: the first read of the
 * writer, the editor and the strategist.
 *
 * A live run on Vocion Cloud (2026-10-27): the editor, run in the background
 * after the plan was signed off, said "I cannot open the draft (artifact 47),
 * the page brief (45) or SERP brief #43" and filed an ask instead of
 * reviewing. The draft and briefs are the page's own artifacts, but the
 * project-scoped reads (`read_project` find / source) cover the project's
 * sources, not a page's artifacts, and the generic artifact read sat behind
 * tool search for a teammate never told to search. So the page carries its
 * own read: the record (keyword, type, location, status, meta, byline, where
 * the gate holds it), the editor's open findings and the person's feedback,
 * and the full text of its SERP brief, page brief and current draft, each
 * with its artifact id and version. A long text is cut at a stated point and
 * the same call reads on from there.
 *
 * Reads only this workspace's pages and artifacts (`ctx.orgId`): a page of
 * another workspace is "no such page", never its words.
 */

import type { RuntimeContext } from '../types';
import type { SeoPageRecord } from '@/services/seo/records';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getArtifact } from '@/services/ArtifactService';
import { whyNotWritable } from '@/services/seo/gate';
import { seoProjectHref } from '@/services/seo/projects';
import { getSeoBatch, getSeoPage, readSeoGate } from '@/services/seo/records';
import { findingsMd } from '@/services/seo/work';
import { recordIdArg, recordIdOf } from './recordIdArg';

/** Characters of one text a read returns; the rest is read on from `offset`. */
export const SEO_PAGE_TEXT_CAP = 16_000;

const PARTS = { serp_brief: 'SERP brief', page_brief: 'Page brief', draft: 'Draft' } as const;
type Part = keyof typeof PARTS;

/**
 * The artifact a part of the page is.
 * @param page - The page.
 * @param part - Which text.
 */
function partArtifact(page: SeoPageRecord, part: Part): number | undefined {
  return part === 'serp_brief' ? page.meta.serpArtifactId : part === 'page_brief' ? page.meta.briefArtifactId : page.meta.draftArtifactId;
}

/**
 * One of the page's texts as a section: its artifact, version and words, cut
 * at the cap with the call that reads on.
 * @param ctx - The turn.
 * @param page - The page.
 * @param part - Which text.
 * @param offset - Where to start.
 */
async function textSection(ctx: RuntimeContext, page: SeoPageRecord, part: Part, offset = 0): Promise<string[]> {
  const label = PARTS[part];
  const id = partArtifact(page, part);
  if (!id) {
    return [`## ${label}`, '', part === 'draft' ? 'Not written yet.' : part === 'page_brief' ? 'No brief yet.' : 'No SERP brief attached yet.', ''];
  }
  const artifact = await getArtifact({ orgId: ctx.orgId, id });
  if (!artifact) {
    return [`## ${label} — artifact #${id}`, '', `Artifact #${id} is gone from this workspace; say so rather than guessing what it said.`, ''];
  }
  const spec = artifact.spec as { md?: unknown } | null;
  const text = typeof spec?.md === 'string' ? spec.md : JSON.stringify(artifact.spec ?? null);
  const start = Math.max(0, Math.min(offset, text.length));
  const shown = text.slice(start, start + SEO_PAGE_TEXT_CAP);
  const end = start + shown.length;
  const range = start > 0 || end < text.length ? `, characters ${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')}` : '';
  return [
    `## ${label} — artifact #${id}, version ${artifact.currentVersion}, "${artifact.title}"${range}`,
    '',
    shown,
    '',
    ...(end < text.length ? [`[Cut at ${end.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters. The rest: seo_read_page { page: ${page.id}, part: "${part}", offset: ${end} }.]`, ''] : []),
  ];
}

/**
 * The page's record as a writer or an editor reads it, before the texts.
 * @param ctx - The turn.
 * @param page - The page.
 */
async function recordSection(ctx: RuntimeContext, page: SeoPageRecord): Promise<string[]> {
  const m = page.meta;
  const [batch, gate] = await Promise.all([getSeoBatch(ctx.orgId, m.batchId), readSeoGate(ctx.orgId, m.batchId)]);
  const why = gate ? whyNotWritable(gate.project, page.id) : null;
  const fact = (label: string, value: string | number | null | undefined) => (value === undefined || value === null || value === '' ? null : `- **${label}:** ${value}`);
  const lines: Array<string | null> = [
    `# SEO page #${page.id}: ${page.title}`,
    '',
    fact('Project', `${m.projectName ?? `#${m.projectId}`} (project_id ${m.projectId}, ${seoProjectHref(m.projectId)})`),
    fact('Batch', `${batch?.title ?? `#${m.batchId}`} (#${m.batchId}, /dashboard/p/seo-pages?batch=${m.batchId})`),
    fact('Keyword', m.keyword),
    fact('Secondary keywords', m.secondaryKeywords?.join(', ')),
    fact('Page type', m.pageType),
    fact('Location', m.location),
    fact('Intent', m.intent),
    fact('Cluster', m.cluster),
    fact('Target', m.target),
    fact('Refreshes', m.existingUrl),
    fact('Byline', m.author ? `${m.author.name}${m.author.title ? `, ${m.author.title}` : ''}${m.author.url ? ` (${m.author.url})` : ''}${m.author.from === 'default' ? ' — the project\'s default author' : ''}. A field: it goes in the site's frontmatter, never in the body` : 'none yet: the project names no default author'),
    fact('Status', m.status),
    fact('Draft round', m.draftRound),
    fact('Editor rounds on this draft', m.editorRounds),
    fact('Meta title', m.metaTitle),
    fact('Meta description', m.metaDescription),
    fact('Slug', m.slug ? `/${m.slug}` : undefined),
    fact('Category', m.category),
    fact('Tags', m.tags?.length ? m.tags.join(', ') : undefined),
    fact('Excerpt', m.excerpt),
    fact('Models', m.modelsLine),
    fact('Gate', gate ? `${gate.gate.line}. This page: ${why ? `not released — ${why}` : 'released, it may be written now'}` : m.batchLine),
    fact('Sign-off', m.signoff ? `${m.signoff.decision} by ${m.signoff.by ?? 'unknown'} on ${m.signoff.at.slice(0, 10)} (ask #${m.signoff.askId}, round ${m.signoff.round ?? 1})` : m.signoffAsk ? `waiting on a person (ask #${m.signoffAsk.askId}, round ${m.signoffAsk.round})` : undefined),
    '',
  ];
  const review = m.review;
  if (review) {
    lines.push(`## The editor's last review: ${review.verdict} (${review.at.slice(0, 10)})`, '');
    if (review.findings?.length) {
      lines.push(review.verdict === 'fix' ? 'Open findings, each to answer in the redraft:' : 'Findings:', '', findingsMd(review.findings), '');
    }
    if (review.similarTo?.length) {
      lines.push(`Too similar to ${review.similarTo.map(d => `page #${d.pageId} (${Math.round(d.similarity * 100)}%)`).join(', ')}.`, '');
    }
    lines.push(review.notes.trim(), '');
    if (review.notesArtifactId) {
      lines.push(`The whole review: artifact #${review.notesArtifactId} (/dashboard/artifacts/${review.notesArtifactId}).`, '');
    }
  }
  const feedback = m.feedback ?? [];
  if (feedback.length > 0) {
    lines.push('## A person\'s feedback on this page', '');
    for (const f of feedback) {
      lines.push(`- ${f.at ? `${f.at.slice(0, 10)} · ` : ''}"${f.note}"${f.scope ? ` (${f.scope})` : ''} — ${f.filedTo ? `filed to ${f.filedTo}` : 'not filed yet'}${f.draftArtifactId ? `, about draft #${f.draftArtifactId}` : ''}`);
    }
    lines.push('');
  }
  return lines.filter((l): l is string => l !== null);
}

export function seoReadPageTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { page: number | string; part?: Part; offset?: number };
      const ref = await recordIdOf(ctx.orgId, args.page);
      if ('reason' in ref) {
        return `No such page: ${ref.reason}.`;
      }
      const page = await getSeoPage(ctx.orgId, ref.id);
      if (!page) {
        return `#${ref.id} is not an SEO page in this workspace.`;
      }
      if (args.part) {
        return (await textSection(ctx, page, args.part, args.offset ?? 0)).join('\n');
      }
      const sections = [
        ...await recordSection(ctx, page),
        ...await textSection(ctx, page, 'serp_brief'),
        ...await textSection(ctx, page, 'page_brief'),
        ...await textSection(ctx, page, 'draft'),
        `The client's voice, rules and guidelines are on project ${page.meta.projectId}: read_project { project_id: ${page.meta.projectId} }.`,
      ];
      return sections.join('\n');
    },
    {
      name: 'seo_read_page',
      description: 'Read one SEO page whole, as the first read before researching, briefing, writing or reviewing it: its record (keyword, page type, location, intent, cluster, target, status, byline, meta title, description and slug, and where the gate holds it), the editor\'s open findings and every note a person gave, then the full text of its SERP brief, its page brief and its current draft, each with its artifact id and version. A text past the cap is cut where it says, with the call that reads on (`part` and `offset`). Only pages of this workspace.',
      schema: z.object({
        page: recordIdArg('The SEO page'),
        part: z.enum(['serp_brief', 'page_brief', 'draft']).optional().describe('Read only this text, from `offset`: the call a cut names.'),
        offset: z.number().int().min(0).optional().describe('With `part`: the character to start from.'),
      }),
    },
  );
}
