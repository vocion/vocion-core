/**
 * The Prompts register's tools — AI-answer prompts per client, kept as
 * `seo_prompt` rows (`services/seo/prompts.ts`).
 *
 *   seo_save_prompts    the prompts the strategist proposes, saved in code the
 *                       moment it proposes them (never only in an artifact);
 *                       drops a prompt with why, or restores one
 *   seo_list_prompts    a project's register: each prompt, its group,
 *                       platforms and whether the client is mentioned or cited
 *   seo_import_prompts  an Ahrefs Brand Radar CSV export (a file dropped in
 *                       chat) read into the register, every column it read named
 *   seo_export_prompts  the register as a CSV for Brand Radar, a file to download
 *
 * Services load when a tool runs, not when it is listed.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const GROUPS = ['category', 'shortlist', 'problem', 'comparison', 'brand'] as const;
const PLATFORMS = ['chatgpt', 'google_ai_overviews', 'google_ai_mode', 'perplexity', 'gemini', 'copilot', 'claude'] as const;

/**
 * The agent saving or importing: its own act, never recorded under the person's id.
 * @param ctx
 */
const byOf = (ctx: RuntimeContext) => `agent:${ctx.agentSlug ?? 'seo-strategist'}`;

/**
 * seo_save_prompts.
 * @param ctx - The turn.
 */
export function seoSavePromptsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { keepPrompts, setPromptsTracked } = await import('@/services/seo/prompts');
      const lines: string[] = [];
      if (args.prompts?.length) {
        const kept = await keepPrompts(ctx.orgId, args.project_id, args.prompts.map(p => ({ prompt: p.prompt, group: p.group, ...(p.intent ? { intent: p.intent } : {}), platforms: p.platforms ?? [], ...(p.why ? { why: p.why } : {}) })), { source: 'agent', by: byOf(ctx) });
        if (!kept) {
          return `Not saved: project #${args.project_id} is not a project here, or the SEO app needs its update (no seo_prompt type).`;
        }
        const added = kept.rows.filter(r => r.created).length;
        lines.push(`Saved ${kept.rows.length} prompts to ${kept.project.title}'s register (${added} new, ${kept.rows.length - added} already there): /dashboard/p/seo-prompts?project=${kept.project.id}.`);
      }
      if (args.drop_ids?.length) {
        lines.push(...await setPromptsTracked(ctx.orgId, args.drop_ids, { drop: true, why: args.why }, byOf(ctx)));
      }
      if (args.restore_ids?.length) {
        lines.push(...await setPromptsTracked(ctx.orgId, args.restore_ids, { drop: false, why: args.why }, byOf(ctx)));
      }
      return lines.length ? lines.join('\n') : 'Nothing to save: pass prompts, drop_ids or restore_ids.';
    },
    {
      name: 'seo_save_prompts',
      description: 'Keep AI-answer prompts in a client\'s Prompts register: the questions buyers ask ChatGPT, AI Overviews, Perplexity and the rest, each with its group (category, shortlist, problem, comparison, brand), intent, the platforms to track and why. Call it whenever you propose prompts, in the same turn: a prompt only in chat or an artifact is lost. One row per prompt per client (saving again refreshes it). drop_ids / restore_ids take prompts out of tracking or back, with why.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project.'),
        prompts: z.array(z.object({
          prompt: z.string().min(3).max(400).describe('As a buyer would type it to an AI assistant.'),
          group: z.enum(GROUPS),
          intent: z.string().max(60).optional(),
          platforms: z.array(z.enum(PLATFORMS)).optional(),
          why: z.string().max(300).optional(),
        })).max(100).optional(),
        drop_ids: z.array(z.number().int().positive()).max(100).optional(),
        restore_ids: z.array(z.number().int().positive()).max(100).optional(),
        why: z.string().max(300).optional().describe('For a drop or restore.'),
      }),
    },
  );
}

/**
 * seo_list_prompts.
 * @param ctx - The turn.
 */
export function seoListPromptsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { listProjectPrompts } = await import('@/services/seo/prompts');
      const rows = (await listProjectPrompts(ctx.orgId, args.project_id)).filter(r => args.include_dropped || r.meta.status !== 'dropped');
      if (rows.length === 0) {
        return `No prompts tracked for project #${args.project_id} yet.`;
      }
      return JSON.stringify(rows.map(r => ({ id: r.id, prompt: r.meta.prompt, group: r.meta.group, intent: r.meta.intent, platforms: r.meta.platforms, visibility: r.meta.visibility, competitorsMentioned: r.meta.competitorsMentioned, checkedAt: r.meta.checkedAt, checkedWith: r.meta.checkedWith, source: r.meta.source, status: r.meta.status })));
    },
    {
      name: 'seo_list_prompts',
      description: 'A client\'s Prompts register: each AI-answer prompt with its id, group, platforms, whether the client is mentioned or cited and which competitors are, and when that was checked. Read it before proposing prompts, so none is proposed twice.',
      schema: z.object({ project_id: z.number().int().positive(), include_dropped: z.boolean().optional() }),
    },
  );
}

/**
 * seo_import_prompts.
 * @param ctx - The turn.
 */
export function seoImportPromptsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [{ getArtifact }, { keepPrompts, parseBrandRadarCsv }] = await Promise.all([import('@/services/ArtifactService'), import('@/services/seo/prompts')]);
      let text = args.text ?? '';
      if (args.artifact_id) {
        const file = await getArtifact({ orgId: ctx.orgId, id: args.artifact_id });
        const spec = (file?.spec ?? {}) as { text?: unknown; md?: unknown };
        text = typeof spec.text === 'string' ? spec.text : typeof spec.md === 'string' ? spec.md : '';
        if (!file || !text) {
          return `Not imported: artifact #${args.artifact_id} ${file ? 'has no text to read (is it the CSV export?)' : 'is not in this workspace'}.`;
        }
      }
      if (!text.trim()) {
        return 'Not imported: pass the uploaded CSV\'s artifact_id, or its text.';
      }
      const parsed = parseBrandRadarCsv(text, new Date().toISOString());
      if (!parsed.columns.prompt) {
        return `Not imported: no column holds the prompts. The header reads: ${[...Object.values(parsed.columns), ...parsed.ignored].join(', ') || 'nothing'}. A Brand Radar export has a Prompt (or Query) column.`;
      }
      const kept = await keepPrompts(ctx.orgId, args.project_id, parsed.prompts, { source: 'imported', by: byOf(ctx) });
      if (!kept) {
        return `Not imported: project #${args.project_id} is not a project here, or the SEO app needs its update (no seo_prompt type).`;
      }
      const added = kept.rows.filter(r => r.created).length;
      const seen = kept.rows.filter(r => r.visibility === 'mentioned' || r.visibility === 'cited').length;
      return [
        `Imported ${kept.rows.length} prompts into ${kept.project.title}'s register (${added} new, ${kept.rows.length - added} refreshed): /dashboard/p/seo-prompts?project=${kept.project.id}.`,
        `Read the columns ${Object.entries(parsed.columns).map(([k, h]) => `"${h}" as ${k}`).join(', ')}${parsed.ignored.length ? `; left out ${parsed.ignored.map(h => `"${h}"`).join(', ')}` : ''}${parsed.skipped ? `; skipped ${parsed.skipped} rows with no prompt` : ''}.`,
        parsed.columns.mentioned || parsed.columns.cited ? `The client is mentioned or cited on ${seen} of them, as the export checked.` : 'The export has no mention or citation columns, so visibility stays unchecked.',
      ].join('\n');
    },
    {
      name: 'seo_import_prompts',
      description: 'Import an Ahrefs Brand Radar CSV export (or any sheet of AI prompts) into a client\'s Prompts register: the file the person dropped in chat (artifact_id), or its text. Columns are found by their header (prompt, platform, mentioned, cited, competitors, date, group, intent); each column read and each left out is said. Rows of one prompt across platforms become one row.',
      schema: z.object({
        project_id: z.number().int().positive(),
        artifact_id: z.number().int().positive().optional().describe('The uploaded CSV.'),
        text: z.string().max(2_000_000).optional().describe('The CSV text, when there is no file.'),
      }),
    },
  );
}

/**
 * seo_export_prompts.
 * @param ctx - The turn.
 */
export function seoExportPromptsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [{ listProjectPrompts, toBrandRadarCsv }, { readSeoProject }, { saveArtifact }, { createArtifact, toPayload }, { authorOf }] = await Promise.all([
        import('@/services/seo/prompts'),
        import('@/services/seo/projects'),
        import('@/libs/tools/artifacts/store'),
        import('@/services/ArtifactService'),
        import('./renderArtifacts'),
      ]);
      const project = await readSeoProject(ctx.orgId, args.project_id);
      if (!project) {
        return `No project #${args.project_id} in this workspace.`;
      }
      const rows = (await listProjectPrompts(ctx.orgId, project.id)).filter(r => r.meta.status !== 'dropped');
      if (rows.length === 0) {
        return `No prompts tracked for ${project.title} yet: nothing to export.`;
      }
      const csv = toBrandRadarCsv(rows.map(r => r.meta));
      const saved = await saveArtifact({ orgId: ctx.orgId, data: csv, ext: 'csv', contentType: 'text/csv' });
      const filename = `${project.title.replace(/[^\w .-]+/g, ' ').trim()} - AI prompts.csv`;
      const { artifact } = await createArtifact({
        orgId: ctx.orgId,
        conversationId: ctx.conversationId ?? null,
        kind: 'file',
        title: filename,
        spec: { filename: saved.filename, originalName: filename, contentType: 'text/csv', bytes: saved.bytes, url: saved.url, text: csv },
        url: saved.url,
        record: { type: 'object', id: String(project.id), role: 'prompts-export' },
        author: authorOf(ctx),
        visibility: ctx.missionRunId ? 'system' : 'user',
        changeSummary: `${rows.length} prompts`,
      });
      ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
      return `Exported ${rows.length} prompts for ${project.title} as ${filename} (${saved.url}). The first column is the prompt, which Brand Radar's custom prompts take; the rest is the register as it stands.`;
    },
    {
      name: 'seo_export_prompts',
      description: 'Export a client\'s tracked AI prompts as a CSV for Ahrefs Brand Radar (the prompt first, then group, intent, platforms, mentioned, cited, competitors, last checked), filed as a file to download.',
      schema: z.object({ project_id: z.number().int().positive() }),
    },
  );
}

/**
 * The register's tools.
 * @param ctx - The turn.
 */
export function seoPromptTools(ctx: RuntimeContext) {
  return [seoSavePromptsTool(ctx), seoListPromptsTool(ctx), seoImportPromptsTool(ctx), seoExportPromptsTool(ctx)];
}
