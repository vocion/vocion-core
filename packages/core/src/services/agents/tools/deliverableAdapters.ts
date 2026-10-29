/**
 * export_pptx / import_pptx / export_docx / import_docx — the optional office
 * adapters (`docs/decks.md`, "Out and back"), as the agent uses them.
 *
 * Out: the file is filed beside the deck or document as a `file` artifact and
 * its link comes back. Back: the file a person attached in this conversation
 * (or any file artifact by id) becomes ONE new version through the engine,
 * re-rendered and re-audited, and the receipt lists the import report in
 * plain words. A stale `base_version` is refused with the diff, like
 * `deck_checkin`.
 *
 * Optional: nothing on the path from draft to PDF uses these, and their
 * descriptions only say what they do — no core prompt points an agent at them.
 */

import type { RuntimeContext } from '../types';
import type { DeckSpec } from '@/libs/cards/specs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { stepProgress } from '@/libs/chat/stepProgress';
import { ArtifactError, listArtifactsForConversation, toPayload } from '@/services/ArtifactService';
import { DeckEditError, deckReceipt } from '@/services/decks/DeckEngine';
import { AdapterFileError, exportDeckPptx, exportDocumentDocx, importDeckPptx, importDocumentDocx, readFileArtifact } from '@/services/deliverables/adapters';
import { documentReceipt } from '@/services/documents/DocumentEngine';
import { resolveDeliverable } from './decks';
import { authorOf } from './renderArtifacts';

/**
 * Notes for the running step line, repeats dropped.
 * @param ctx - The runtime context.
 * @param name - The tool the step runs under.
 */
function progressTo(ctx: RuntimeContext, name: string): (note: string) => void {
  return stepProgress(ctx.emit, name).note;
}

/**
 * The newest file the person attached in this conversation whose name ends in `.ext`, else the newest attachment.
 * @param ctx - The runtime context.
 * @param ext - `pptx` or `docx`.
 */
async function latestUpload(ctx: RuntimeContext, ext: string): Promise<number | null> {
  if (!ctx.conversationId) {
    return null;
  }
  const rows = await listArtifactsForConversation({ orgId: ctx.orgId, conversationId: ctx.conversationId });
  const uploads = rows.filter(r => r.kind === 'file' && (r.spec as Record<string, unknown> | null)?.uploaded === true);
  const named = (r: typeof uploads[number]) => {
    const name = (r.spec as { originalName?: unknown }).originalName;
    return (typeof name === 'string' ? name : r.title).toLowerCase().endsWith(`.${ext}`);
  };
  return (uploads.filter(named).at(-1) ?? uploads.at(-1))?.id ?? null;
}

function exportTool(ctx: RuntimeContext, name: 'export_pptx' | 'export_docx') {
  const kind = name === 'export_pptx' ? 'deck' : 'document';
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, [kind]);
      if ('error' in found) {
        return found.error;
      }
      try {
        const input = { orgId: ctx.orgId, id: found.id, author: authorOf(ctx), conversationId: ctx.conversationId ?? null, visibility: ctx.missionRunId ? 'system' as const : 'user' as const };
        ctx.emit({ type: 'step_progress', tool: name, note: kind === 'deck' ? 'laying the slides out' : 'writing the file' });
        const res = kind === 'deck' ? await exportDeckPptx(input) : await exportDocumentDocx(input);
        ctx.emit({ type: 'artifact', artifact: toPayload(res.file) });
        const back = kind === 'deck' ? 'import_pptx' : 'import_docx';
        return `${res.filename} ready (${Math.max(1, Math.round(res.bytes / 1024))} KB) at ${res.url}, filed beside the ${kind} as file #${res.file.id}. It was exported from v${res.version}; when it comes back edited, ${back} with base_version set to that brings the changes in as a new version.`;
      } catch (err) {
        return `Could not export the ${kind === 'deck' ? 'PPTX' : 'DOCX'}: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name,
      description: kind === 'deck'
        ? 'Export a deck as a PPTX file artifact (native text boxes, images and shapes; anything with no native form is a picture), named from its title. Omit `id` for the open deck.'
        : 'Export a document as a DOCX file artifact (sheets as sections, headings, lists, tables and inline images), named from its title. Omit `id` for the open document.',
      schema: z.object({
        id: z.number().int().positive().optional().describe(`The ${kind}. Omit for the one open.`),
      }),
    },
  );
}

function importTool(ctx: RuntimeContext, name: 'import_pptx' | 'import_docx') {
  const kind = name === 'import_pptx' ? 'deck' : 'document';
  const ext = kind === 'deck' ? 'pptx' : 'docx';
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, [kind]);
      if ('error' in found) {
        return found.error;
      }
      const fileId = args.file_id ?? await latestUpload(ctx, ext);
      if (!fileId) {
        return `No .${ext} is attached in this conversation. Ask the person to attach it, or pass file_id.`;
      }
      try {
        const file = await readFileArtifact(ctx.orgId, fileId);
        const opts = { author: authorOf(ctx), runId: ctx.traceId ?? null, onProgress: progressTo(ctx, name), ...(args.base_version === undefined ? {} : { baseVersion: args.base_version }) };
        const res = kind === 'deck'
          ? await importDeckPptx(ctx.orgId, found.id, file.data, { ...opts, ...((args as { tool?: string }).tool ? { tool: (args as { tool?: string }).tool } : {}) })
          : await importDocumentDocx(ctx.orgId, found.id, file.data, opts);
        if (res.status === 'stale') {
          return `NOT imported: #${found.id} changed in Vocion since v${args.base_version} (it is at v${res.currentVersion}). Export it again and redo the change on top. What changed:\n${res.diff}`;
        }
        if (res.status === 'unchanged') {
          return [`Nothing to bring back from ${file.name}: it matches v${res.version}.`, ...res.reportLines].join('\n');
        }
        ctx.emit({ type: 'artifact', artifact: toPayload(res.artifact) });
        const verify = res.outcome
          ? (kind === 'deck' ? deckReceipt(res.artifact.spec as DeckSpec, res.outcome as Parameters<typeof deckReceipt>[1]) : documentReceipt(res.outcome as Parameters<typeof documentReceipt>[0]))
          : '';
        return [`Brought ${file.name} back into "${res.artifact.title}" as v${res.version}. What came back:`, ...res.reportLines.map(l => `- ${l}`), '', verify].join('\n');
      } catch (err) {
        if (err instanceof AdapterFileError || err instanceof ArtifactError || err instanceof DeckEditError) {
          return `${name} rejected: ${err.message}`;
        }
        return `Could not bring the ${ext.toUpperCase()} back: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name,
      description: kind === 'deck'
        ? 'Bring an edited PPTX back into a deck as ONE new version, re-rendered and re-audited. Text edits on slides that still carry their Vocion names are applied to the original slides; new or restructured slides are converted; removed and reordered slides follow the file. Returns the per-slide report. A stale base_version is refused with what changed.'
        : 'Bring an edited DOCX back into a document as ONE new version, re-rendered and re-audited. Changed paragraph text is applied to the original sheets; paragraphs that match nothing are listed and left out. A stale base_version is refused with what changed.',
      schema: z.object({
        id: z.number().int().positive().optional().describe(`The ${kind}. Omit for the one open.`),
        file_id: z.number().int().positive().optional().describe(`The .${ext} file artifact (an attachment's "file #12"). Omit for the latest one attached in this conversation.`),
        base_version: z.number().int().positive().optional().describe('The version the file was exported at, when known.'),
        ...(kind === 'deck' ? { tool: z.string().max(80).optional().describe('What it was edited in, as the person said (recorded as where the version came from).') } : {}),
      }),
    },
  );
}

export function deliverableAdapterTools(ctx: RuntimeContext) {
  return [exportTool(ctx, 'export_pptx'), importTool(ctx, 'import_pptx'), exportTool(ctx, 'export_docx'), importTool(ctx, 'import_docx')];
}
