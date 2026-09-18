/**
 * read_artifact / update_artifact — changing what is already open.
 *
 * The whole point of a single live artifact is that "make the third column
 * currency", "add a section on risks" and "sort by owner" move the thing the
 * person is looking at. Without these the model's only move is to render a
 * second table, and the pane fills with near-duplicates nobody asked for.
 *
 * `read_artifact` returns the CURRENT spec so an edit is a modification of
 * real content rather than a guess; `update_artifact` writes a new version
 * through `ArtifactService`, which is the same door the person's own Save
 * goes through — one history, one audit trail.
 *
 * Which artifact is "this"? The page context carries the open one as a
 * `RecordRef` of type `artifact` ({@link openArtifactId}), so an unqualified
 * "sort it by owner" resolves without the person naming an id.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ArtifactError, getArtifact, listArtifactsForConversation, toPayload, updateArtifact } from '@/services/ArtifactService';
import { authorOf } from './renderArtifacts';

/**
 * The artifact the person currently has open, from the page context the
 * client sends with the turn. Undefined when nothing is open.
 * @param ctx - The runtime context for this turn.
 */
export function openArtifactId(ctx: RuntimeContext): number | undefined {
  const refs = [ctx.pageContext?.record, ...(ctx.pageContext?.refs ?? [])];
  for (const ref of refs) {
    if (ref?.type === 'artifact') {
      const id = Number(ref.id);
      if (Number.isInteger(id) && id > 0) {
        return id;
      }
    }
  }
  return undefined;
}

/**
 * Models often stringify nested tool args — parse JSON strings back to objects.
 * @param v
 */
function coerceJson(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

async function resolve(ctx: RuntimeContext, id: number | undefined): Promise<{ id: number } | { error: string }> {
  const target = id ?? openArtifactId(ctx);
  if (target) {
    return { id: target };
  }
  if (ctx.conversationId) {
    const rows = await listArtifactsForConversation({ orgId: ctx.orgId, conversationId: ctx.conversationId });
    const last = rows.at(-1);
    if (last) {
      return { id: last.id };
    }
  }
  return { error: 'No artifact is open and none exists in this conversation. Create one with render_table / render_markdown / render_chart / render_record first.' };
}

export function readArtifactTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolve(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      const row = await getArtifact({ orgId: ctx.orgId, id: found.id });
      if (!row) {
        return `No artifact #${found.id} in this workspace.`;
      }
      if (row.kind === 'document') {
        // Never the HTML: a document is read by outline and by sheet through
        // read_document, and changed with edit_document.
        const { html: _html, ...rest } = row.spec as Record<string, unknown>;
        return JSON.stringify({ id: row.id, kind: row.kind, title: row.title, version: row.currentVersion, folder: row.folder, spec: rest, note: 'This is a paginated document. Use read_document to read its outline or a sheet, and edit_document to change it.' });
      }
      return JSON.stringify({
        id: row.id,
        kind: row.kind,
        title: row.title,
        version: row.currentVersion,
        folder: row.folder,
        spec: row.spec,
      });
    },
    {
      name: 'read_artifact',
      description: 'Read the CURRENT content of an artifact — its kind, title, version and full typed spec — as JSON. Call this before update_artifact so your edit modifies what is really there instead of a remembered version. Omit `id` to read the artifact the person has open.',
      schema: z.object({
        id: z.number().int().positive().optional().describe('Artifact id. Omit for the one currently open beside the conversation.'),
      }),
    },
  );
}

export function updateArtifactTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolve(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      try {
        const spec = args.spec === undefined ? undefined : coerceJson(args.spec);
        if (spec !== undefined || args.content_markdown !== undefined) {
          const row = await getArtifact({ orgId: ctx.orgId, id: found.id });
          if (row?.kind === 'document') {
            return `update_artifact cannot rewrite a document's content — use edit_document(${found.id}, ops) so the change is by sheet and render-verified. Title and folder changes are fine here.`;
          }
        }
        if (spec === undefined && args.content_markdown === undefined && args.title === undefined && args.folder === undefined) {
          return 'update_artifact needs at least one of `spec`, `content_markdown`, `title` or `folder`.';
        }
        const { artifact, version } = await updateArtifact({
          orgId: ctx.orgId,
          id: found.id,
          title: args.title ?? null,
          spec,
          contentMarkdown: args.content_markdown ?? null,
          ...(args.folder === undefined ? {} : { folder: args.folder }),
          author: authorOf(ctx),
          changeSummary: args.change_summary,
          runId: ctx.traceId ?? null,
        });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        return `Updated "${artifact.title}" to v${version.version} (${args.change_summary}). The person sees it live in the pane — do NOT repeat the content as text.`;
      } catch (err) {
        if (err instanceof ArtifactError) {
          return `update_artifact rejected: ${err.message}. Read the artifact, fix the payload, and call again.`;
        }
        return `Could not update the artifact: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'update_artifact',
      description: 'Change an artifact IN PLACE, creating a new version. This is how you answer "make the third column currency", "add a section on risks", "sort by owner", "drop the last row" — never by rendering a second artifact. Omit `id` to edit the one the person has open. Pass `spec` for a whole new typed payload (read_artifact first, then send it back modified), or `content_markdown` to replace just the body of a markdown artifact.',
      schema: z.object({
        id: z.number().int().positive().optional().describe('Artifact id. Omit for the one currently open beside the conversation.'),
        title: z.string().max(200).optional().describe('New title. Omit to keep the current one.'),
        spec: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe('Complete replacement spec for this artifact kind, same shape read_artifact returned (object; a JSON string is tolerated).'),
        content_markdown: z.string().optional().describe('Markdown artifacts only: the new body. Simpler than `spec` when only the prose changes.'),
        folder: z.string().max(120).optional().describe('Move it in the artifacts log, e.g. "revenue/weekly".'),
        change_summary: z.string().min(1).max(160).describe('One line for the version menu, in the past tense: "made Amount a currency column".'),
      }),
    },
  );
}

export function editArtifactTools(ctx: RuntimeContext) {
  return [readArtifactTool(ctx), updateArtifactTool(ctx)];
}
