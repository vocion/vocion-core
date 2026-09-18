/**
 * render_document / read_document / edit_document / verify_document /
 * export_document_pdf — the document engine as the agent uses it.
 *
 * A document is a `document` artifact: paginated, print-ready HTML that opens
 * beside the conversation like any other artifact, with the same versions and
 * the same "edit the one that is open" rule. What is different is the loop:
 * every write comes back with a render-verify receipt (sheet count, footer
 * alignment, overflow by sheet, PDF page count, unresolved assets, and the
 * URL of each sheet's screenshot), so the agent fixes what the receipt names
 * before it says it is done. That receipt is the product — it is what made
 * the hand-run version good, and it is why these are separate tools rather
 * than `render_markdown` with HTML in it.
 *
 * Reading is by outline and by sheet, never the whole file: a proposal is
 * 100 KB of HTML and the model needs the one sheet it is changing.
 *
 * No side effect outside the conversation (files land in the artifact
 * store; nothing is sent), so these ship to every agent like the other
 * render tools. `harness.excludeTools` withholds them like any built-in.
 */

import type { RuntimeContext } from '../types';
import type { DocumentSpec } from '@/libs/cards/specs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DocumentEditError, documentOpSchema } from '@/libs/documents/edit';
import { inspectDocument, outlineText, parseSheets } from '@/libs/documents/sheets';
import { ArtifactError, getArtifact, listArtifactsForConversation, toPayload } from '@/services/ArtifactService';
import { createDocument, documentReceipt, exportDocumentPdf, reviseDocument, verifyDocumentArtifact } from '@/services/documents/DocumentEngine';
import { openArtifactId } from './editArtifacts';
import { authorOf } from './renderArtifacts';

/**
 * Models often stringify nested tool args — parse JSON strings back.
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

/**
 * Which document "this" is: the open artifact when it is a document, else the
 * newest document in the conversation.
 * @param ctx
 * @param id
 */
async function resolveDocument(ctx: RuntimeContext, id: number | undefined): Promise<{ id: number } | { error: string }> {
  const explicit = id ?? openArtifactId(ctx);
  if (explicit) {
    const row = await getArtifact({ orgId: ctx.orgId, id: explicit });
    if (row?.kind === 'document') {
      return { id: explicit };
    }
    if (id) {
      return { error: row ? `Artifact #${id} is a ${row.kind}, not a document.` : `No artifact #${id} in this workspace.` };
    }
  }
  if (ctx.conversationId) {
    const rows = await listArtifactsForConversation({ orgId: ctx.orgId, conversationId: ctx.conversationId });
    const last = rows.filter(r => r.kind === 'document').at(-1);
    if (last) {
      return { id: last.id };
    }
  }
  return { error: 'No document is open and none exists in this conversation. Create one with render_document first.' };
}

/**
 * The record this turn is about, when it is one a document can belong to.
 * @param ctx
 */
function recordScope(ctx: RuntimeContext): { type: string; id: string; role: string } | null {
  const rec = ctx.pageContext?.record;
  if (!rec || rec.type === 'artifact' || rec.type === 'page' || rec.type === 'conversation') {
    return null;
  }
  return { type: rec.type, id: rec.id, role: 'document' };
}

export function renderDocumentTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const outline = inspectDocument(args.html);
      if (outline.sheetCount === 0) {
        return 'render_document rejected: no <article class="sheet"> elements found. A document is US-Letter sheets in the house framework (see the proposal-document skill); for prose use render_markdown.';
      }
      const title = args.title?.trim() || outline.title || 'Document';
      try {
        if (ctx.conversationId) {
          ctx.emit({
            type: 'artifact',
            pending: true,
            artifact: {
              id: -1,
              conversationId: ctx.conversationId,
              messageId: null,
              kind: 'document',
              title,
              spec: {},
              folder: null,
              version: 0,
              authorKind: 'agent',
              authorId: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
        }
        const { artifact, outcome } = await createDocument({
          orgId: ctx.orgId,
          conversationId: ctx.conversationId ?? null,
          author: authorOf(ctx),
          visibility: ctx.missionRunId ? 'system' : 'user',
          folder: args.folder ?? null,
          // The room the agent names wins; else the record the person is on.
          record: args.room_id ? { type: 'object', id: String(args.room_id), role: 'document' } : recordScope(ctx),
          title,
          html: args.html,
          playbook: args.playbook,
          verify: { look: args.look ?? false },
        });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        const where = ctx.conversationId ? `open beside the conversation as artifact #${artifact.id}` : `saved as artifact #${artifact.id}`;
        return `Rendered document "${artifact.title}" — ${where}, v1.\n\n${documentReceipt(outcome)}\n\nThe artifact carries the content — do NOT repeat it as text; refer to it by title. Change it with edit_document(${artifact.id}, ops) — never render a second one.`;
      } catch (err) {
        if (err instanceof ArtifactError) {
          return `render_document rejected: ${err.message}. Fix the payload and call again.`;
        }
        return `Could not render the document: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'render_document',
      description: 'Create a PAGINATED, PRINT-READY document artifact — a proposal, scope doc, partnership update — from self-contained HTML in the house sheet framework (US-Letter `.sheet`s, pinned `.foot`, inline <style>, logos as data URIs). It renders in real Chrome, audits every sheet (footer alignment, overflow, clipping, PDF page count, unresolved assets) and returns the receipt with a screenshot URL per sheet. Fix anything the receipt lists with edit_document before you say the document is done. For prose that is not a paginated document use render_markdown.',
      schema: z.object({
        room_id: z.number().int().positive().optional().describe('The data room this document belongs to. Pass it whenever you are writing from a room — the document then shows on the room and on the Proposals board. Defaults to the room the person has open.'),
        title: z.string().max(200).optional().describe('Artifact title. Defaults to the <title>, which is also the PDF filename — use "<Subject> - <What it is> (<Firm>) v<N.N>".'),
        html: z.string().min(200).describe('The complete HTML document: <!doctype html> … </html>, with <article class="sheet"> per page.'),
        look: z.boolean().optional().describe('Also run the vision pass over the rendered sheets (a model call). Default false; use it on the final pass.'),
        playbook: z.string().max(60).optional().describe('The playbook that shaped it: proposal, scope, partnership-update, email-copy, work-sample.'),
        folder: z.string().max(120).optional().describe('Optional path-like grouping for the artifacts log, e.g. "clients/acme".'),
      }),
    },
  );
}

export function readDocumentTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDocument(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      const row = await getArtifact({ orgId: ctx.orgId, id: found.id });
      if (!row) {
        return `No document #${found.id}.`;
      }
      const spec = row.spec as Partial<DocumentSpec>;
      const html = spec.html ?? '';
      const parsed = parseSheets(html);
      const part = args.part ?? (args.sheets?.length ? 'sheets' : 'outline');
      const head = `Document #${row.id} "${row.title}" v${row.currentVersion}`;
      if (part === 'outline') {
        const v = spec.verification;
        const verdict = v ? `\nLast render-verify: ${v.ok ? 'no issues' : `${v.issues.length} issue(s)`}${v.issues.length ? `\n${v.issues.map(i => `- ${i}`).join('\n')}` : ''}` : '\nNot render-verified yet.';
        return `${head}\n${outlineText(inspectDocument(html))}${verdict}\n\nRead a sheet's HTML with read_document({ sheets: [n] }) before editing it; read_document({ part: "style" }) for the CSS.`;
      }
      if (part === 'style') {
        const m = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(parsed.before);
        return m ? `${head} · <style> (${m[1]!.length} chars):\n${m[1]!}` : `${head}: no <style> block before the first sheet.`;
      }
      if (part === 'head') {
        return `${head} · everything before the first sheet (${parsed.before.length} chars):\n${parsed.before}`;
      }
      const want = args.sheets?.length ? new Set(args.sheets) : null;
      const chosen = parsed.sheets.filter(s => !want || want.has(s.n));
      if (chosen.length === 0) {
        return `${head}: no such sheet (the document has ${parsed.sheets.length}).`;
      }
      return `${head}\n${chosen.map(s => `=== sheet ${s.n} of ${parsed.sheets.length}${s.label ? ` — ${s.label}` : ''} (${s.html.length} chars) ===\n${s.html}`).join('\n\n')}`;
    },
    {
      name: 'read_document',
      description: 'Read a document artifact by OUTLINE (default: title, one line per sheet, last verification), by SHEET (the exact HTML of the sheets you name — read a sheet before you replace it), or its STYLE/HEAD. Omit `id` for the document the person has open. Never ask for every sheet at once unless you are restructuring the whole document.',
      schema: z.object({
        id: z.number().int().positive().optional().describe('Artifact id. Omit for the one currently open beside the conversation.'),
        sheets: z.array(z.number().int().positive()).max(6).optional().describe('1-based sheet numbers whose HTML you want.'),
        part: z.enum(['outline', 'sheets', 'style', 'head']).optional(),
      }),
    },
  );
}

export function editDocumentTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDocument(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      const raw = coerceJson(args.ops);
      const parsedOps = z.array(documentOpSchema).min(1).max(20).safeParse(raw);
      if (!parsedOps.success) {
        return `edit_document rejected: ops did not validate — ${parsedOps.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}.`;
      }
      try {
        const { artifact, version, outcome, applied } = await reviseDocument({
          orgId: ctx.orgId,
          id: found.id,
          author: authorOf(ctx),
          runId: ctx.traceId ?? null,
          changeSummary: args.change_summary,
          ops: parsedOps.data,
          title: args.title ?? null,
          verify: { look: args.look ?? false },
        });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        return `Updated "${artifact.title}" to v${version.version} (${applied.join('; ')}). The person sees it live in the pane — do NOT repeat the content as text.\n\n${documentReceipt(outcome)}`;
      } catch (err) {
        if (err instanceof DocumentEditError) {
          return `edit_document rejected: ${err.message}`;
        }
        if (err instanceof ArtifactError) {
          return `edit_document rejected: ${err.message}. Read the document, fix the payload, and call again.`;
        }
        return `Could not edit the document: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'edit_document',
      description: 'Change a document artifact IN PLACE by sheet, creating a new version and re-running the render-verify loop. This is how you answer "cut page 9" (remove_sheet), "make it three agents" (replace_sheet with the rewritten sheet, insert_sheet for a new one), "price it per opening" (replace_sheet or replace_text), "move the quote to the cover" (move_sheet / replace_sheet). Footers are renumbered for you. Read the sheet first (read_document) so the replacement is the real sheet, changed, not a remembered one. Omit `id` to edit the document the person has open.',
      schema: z.object({
        id: z.number().int().positive().optional().describe('Artifact id. Omit for the one currently open beside the conversation.'),
        ops: z.union([z.array(documentOpSchema).min(1).max(20), z.string()]).describe('Ordered operations (array; a JSON string is tolerated): replace_sheet{n,html} · remove_sheet{n} · insert_sheet{after,html} · move_sheet{n,to} · replace_style{css} · set_title{title} · replace_text{find,replace,all?,sheet?}.'),
        title: z.string().max(200).optional().describe('New artifact title. Omit to keep it.'),
        change_summary: z.string().min(1).max(160).describe('One line for the version menu, past tense: "cut the measurement page; priced per open role".'),
        look: z.boolean().optional().describe('Also run the vision pass on the result (a model call). Default false.'),
      }),
    },
  );
}

export function verifyDocumentTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDocument(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      try {
        const { artifact, outcome } = await verifyDocumentArtifact({ orgId: ctx.orgId, id: found.id, agentSlug: ctx.agentSlug ?? null, verify: { look: args.look ?? true } });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        return `Verified "${artifact.title}" v${artifact.currentVersion}.\n\n${documentReceipt(outcome)}`;
      } catch (err) {
        return `Could not verify the document: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'verify_document',
      description: 'Re-run the render-verify loop on a document as it stands — real Chrome render, footer audit, overflow scan, PDF page count — and, by default, the vision LOOK at every sheet for what a client would notice (clipped rows, collisions, invisible text, a bar on the wrong week). Use it as the final pass before you say a document is ready. Omit `id` for the open document.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        look: z.boolean().optional().describe('Run the vision pass (default true).'),
      }),
    },
  );
}

export function exportDocumentPdfTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDocument(ctx, args.id);
      if ('error' in found) {
        return found.error;
      }
      try {
        const res = await exportDocumentPdf({ orgId: ctx.orgId, id: found.id, author: authorOf(ctx), conversationId: ctx.conversationId ?? null, visibility: ctx.missionRunId ? 'system' : 'user' });
        ctx.emit({ type: 'artifact', artifact: toPayload(res.file) });
        return `PDF ready: ${res.filename} (${res.pages ?? '?'} pages, ${Math.max(1, Math.round(res.bytes / 1024))} KB) at ${res.url} — background colours forced on, so the brand rule prints on the client's machine too. It is filed beside the document as a file artifact.`;
      } catch (err) {
        return `Could not export the PDF: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'export_document_pdf',
      description: 'Print a document artifact to a PDF file artifact, named from its <title>, with print colours forced on. Use when the person asks for the PDF or the document is ready to send. Omit `id` for the open document.',
      schema: z.object({
        id: z.number().int().positive().optional(),
      }),
    },
  );
}

export function documentTools(ctx: RuntimeContext) {
  return [renderDocumentTool(ctx), readDocumentTool(ctx), editDocumentTool(ctx), verifyDocumentTool(ctx), exportDocumentPdfTool(ctx)];
}
