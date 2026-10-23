/**
 * render_deck / read_deck / edit_deck / verify_deck / export_deck_pdf /
 * deck_checkout / deck_checkin — the deck engine as the agent uses it.
 *
 * A deck is a `deck` artifact (`vocion-deck/1`, `docs/decks.md`): 16:9
 * slides that open beside the conversation like any artifact, with the same
 * versions and the same "edit the one that is open" rule. Like a document,
 * every write comes back with a render-verify receipt (overflow, small text,
 * content under the footer line, unknown elements, unresolved assets,
 * placeholders, missing notes, and each slide's screenshot URL), and the agent
 * fixes what the receipt names before it calls the deck done.
 *
 * `red_team_document` reads decks too (slide text AND notes), and
 * `export_deck_pdf` goes through the same export gate as a document. The
 * check-out/check-in pair works for both kinds: it is how any assistant that
 * can edit files — Claude, ChatGPT, any MCP client — takes a deliverable out
 * and brings it back as a new version.
 *
 * No side effect outside the workspace (files land in the artifact store;
 * nothing is sent), so these ship to every agent like the document tools.
 */

import type { RuntimeContext } from '../types';
import type { DeckSpec } from '@/libs/cards/specs';
import type { DeckOp } from '@/libs/decks/edit';
import type { AssetSource, DeckInput } from '@/services/decks/DeckEngine';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DECK_FORMAT } from '@/libs/cards/specs';
import { deckVerificationReceipt } from '@/libs/decks/audit';
import { blobAssetId, claudeSlidesToDeck, isClaudeSlides } from '@/libs/decks/claudeSlides';
import { deckOpSchema } from '@/libs/decks/edit';
import { filesToDeck } from '@/libs/decks/files';
import { slideText } from '@/libs/decks/slides';
import { ArtifactError, getArtifact, listArtifactsForConversation, toPayload } from '@/services/ArtifactService';
import { createDeck, DeckEditError, deckOutline, deckReceipt, exportDeckPdf, ingestDeckAssets, redTeamDeckArtifact, reviseDeck, verifyDeckArtifact } from '@/services/decks/DeckEngine';
import { checkinDeliverable, checkoutDeliverable } from '@/services/deliverables/checkout';
import { SLIDE_UNIT } from '@/services/deliverables/exportGate';
import { gateExport } from '@/services/deliverables/gate';
import { documentReceipt } from '@/services/documents/DocumentEngine';
import { openArtifactId } from './editArtifacts';
import { authorOf } from './renderArtifacts';

/**
 * Models often stringify nested tool args — parse JSON strings back.
 * @param v - The argument.
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
 * Notes for the running step line, repeats dropped (the document tools' channel).
 * @param ctx - The runtime context.
 * @param name - The tool the step runs under.
 */
function progressTo(ctx: RuntimeContext, name: string): (note: string) => void {
  let last: string | null = null;
  return (note: string) => {
    if (note !== last) {
      last = note;
      ctx.emit({ type: 'step_progress', tool: name, note });
    }
  };
}

/**
 * Which deliverable "this" is: the id given, else the open artifact when it is
 * one of `kinds`, else the newest of them in the conversation.
 * @param ctx - The runtime context.
 * @param id - An explicit artifact id.
 * @param kinds - What counts.
 */
export async function resolveDeliverable(ctx: RuntimeContext, id: number | undefined, kinds: ReadonlyArray<'deck' | 'document'>): Promise<{ id: number; kind: 'deck' | 'document' } | { error: string }> {
  const what = kinds.length === 1 ? `a ${kinds[0]}` : 'a deck or a document';
  const explicit = id ?? openArtifactId(ctx);
  if (explicit) {
    const row = await getArtifact({ orgId: ctx.orgId, id: explicit });
    if (row && (kinds as readonly string[]).includes(row.kind)) {
      return { id: explicit, kind: row.kind as 'deck' | 'document' };
    }
    if (id) {
      return { error: row ? `Artifact #${id} is a ${row.kind}, not ${what}.` : `No artifact #${id} in this workspace.` };
    }
  }
  if (ctx.conversationId) {
    const rows = await listArtifactsForConversation({ orgId: ctx.orgId, conversationId: ctx.conversationId });
    const last = rows.filter(r => (kinds as readonly string[]).includes(r.kind)).at(-1);
    if (last) {
      return { id: last.id, kind: last.kind as 'deck' | 'document' };
    }
  }
  return { error: `No ${kinds.join(' or ')} is open and none exists in this conversation.${kinds.includes('deck') ? ' Create one with render_deck first.' : ''}` };
}

/**
 * The record this turn is about, when a deck can belong to it.
 * @param ctx - The runtime context.
 */
function recordScope(ctx: RuntimeContext): { type: string; id: string; role: string } | null {
  const rec = ctx.pageContext?.record;
  if (!rec || rec.type === 'artifact' || rec.type === 'page' || rec.type === 'conversation') {
    return null;
  }
  return { type: rec.type, id: rec.id, role: 'deck' };
}

const assetSourceSchema = z.object({
  url: z.string().max(4000).optional().describe('An https URL to fetch, a data: URI, or a Vocion file URL'),
  base64: z.string().max(22_000_000).optional().describe('The image bytes, base64'),
  name: z.string().max(200).optional(),
});
const assetsArg = z.union([z.record(z.string(), assetSourceSchema), z.string()]).optional();

function parseAssets(raw: unknown): Record<string, AssetSource> | { error: string } {
  const value = coerceJson(raw);
  if (value === undefined || value === null) {
    return {};
  }
  const parsed = z.record(z.string(), assetSourceSchema).safeParse(value);
  return parsed.success ? parsed.data : { error: `assets did not validate — ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
}

const deckArgSchema = z.object({
  title: z.string().min(1).max(200),
  order: z.array(z.string()).min(1).max(120),
  slides: z.record(z.string(), z.string()),
  sections: z.record(z.string(), z.object({ description: z.string(), start: z.string() })).optional(),
  faces: z.record(z.string(), z.object({ family: z.string(), href: z.string() })).optional(),
});

export function renderDeckTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const assetsIn = parseAssets(args.assets);
      if ('error' in assetsIn) {
        return `render_deck rejected: ${assetsIn.error}.`;
      }
      let deck: Omit<DeckInput, 'assets'>;
      const sources: Record<string, AssetSource> = { ...assetsIn };
      const warnings: string[] = [];
      const files = coerceJson(args.files) as Record<string, string> | undefined;
      if (files && typeof files === 'object') {
        try {
          if (isClaudeSlides(files)) {
            const imported = claudeSlidesToDeck(files, args.title ?? 'Deck');
            warnings.push(...imported.warnings);
            deck = { ...imported.spec, origin: { kind: 'import', tool: 'Claude Slides' } };
            for (const hex of imported.blobs) {
              const given = assetsIn[hex] ?? assetsIn[blobAssetId(hex)];
              const inline = Object.entries(files).find(([p]) => p.endsWith(`_blob/${hex}`))?.[1];
              if (given || inline) {
                sources[blobAssetId(hex)] = given ?? { base64: inline };
              }
              delete sources[hex];
            }
          } else {
            const read = filesToDeck(files);
            warnings.push(...read.warnings);
            deck = { title: read.title, order: read.order, slides: read.slides, ...(read.sections ? { sections: read.sections } : {}), ...(read.faces ? { faces: read.faces } : {}) };
          }
        } catch (err) {
          return `render_deck rejected: the files could not be read — ${(err as Error).message}.`;
        }
      } else {
        const parsed = deckArgSchema.safeParse(coerceJson(args.deck));
        if (!parsed.success) {
          return `render_deck rejected: pass \`deck\` ({ title, order, slides, sections?, faces? }) or \`files\` — ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}.`;
        }
        deck = parsed.data;
      }
      if (args.title?.trim()) {
        deck = { ...deck, title: args.title.trim() };
      }
      const ingested = Object.keys(sources).length ? await ingestDeckAssets(ctx.orgId, sources) : { assets: {}, errors: [] };
      warnings.push(...ingested.errors);
      try {
        if (ctx.conversationId) {
          const now = new Date().toISOString();
          ctx.emit({ type: 'artifact', pending: true, artifact: { id: -1, conversationId: ctx.conversationId, messageId: null, kind: 'deck', title: deck.title, spec: {}, folder: null, version: 0, authorKind: 'agent', authorId: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null, createdAt: now, updatedAt: now } });
        }
        const { artifact, outcome } = await createDeck({
          orgId: ctx.orgId,
          conversationId: ctx.conversationId ?? null,
          author: authorOf(ctx),
          visibility: ctx.missionRunId ? 'system' : 'user',
          folder: args.folder ?? null,
          record: args.room_id ? { type: 'object', id: String(args.room_id), role: 'deck' } : recordScope(ctx),
          deck: { ...deck, ...(Object.keys(ingested.assets).length ? { assets: ingested.assets } : {}), ...(args.playbook ? { playbook: args.playbook } : {}) },
          verify: { look: args.look ?? false, onProgress: progressTo(ctx, 'render_deck') },
        });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        const where = ctx.conversationId ? `open beside the conversation as artifact #${artifact.id}` : `saved as artifact #${artifact.id}`;
        return [
          `Rendered deck "${artifact.title}" — ${where}, v1.`,
          ...(warnings.length ? ['', ...warnings.map(w => `! ${w}`)] : []),
          '',
          deckReceipt(artifact.spec as DeckSpec, outcome),
          '',
          `The artifact carries the content — do NOT repeat it as text. Change it with edit_deck(${artifact.id}, ops) — never render a second one.`,
        ].join('\n');
      } catch (err) {
        if (err instanceof ArtifactError) {
          return `render_deck rejected: ${err.message}\nFix the slides and call again.`;
        }
        return `Could not render the deck: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'render_deck',
      description: `Create a 16:9 PRESENTATION DECK artifact (${DECK_FORMAT}): each slide one <section id="…"> on a fixed 1920×1080 canvas, styled inline, speaker notes in a trailing <aside>, images as src="asset:<id>", icons as <x-icon name="Lock">, shapes as <x-shape kind="arrow-right">, lines as <x-connector x1 y1 x2 y2>. It renders in real Chrome, audits every slide (overflow, text under 24px, content under y 920, unknown elements, unresolved assets, placeholders, missing notes) and returns the receipt with a screenshot URL per slide. Also accepts a Claude Slides project as \`files\` (project/deck.json + project/slides/*.html). Fix what the receipt lists with edit_deck before you say the deck is done. Read the proposal-deck skill before the first slide.`,
      schema: z.object({
        room_id: z.number().int().positive().optional().describe('The data room this deck belongs to. Pass it whenever you are writing from a room — the deck then shows on the room and on the Proposals board.'),
        title: z.string().max(200).optional().describe('Deck title — also the PDF filename. Overrides the one in `deck`/`files`.'),
        deck: z.union([deckArgSchema, z.string()]).optional().describe('{ title, order: [slide ids], slides: { id: "<section id=…>…</section>" }, sections?, faces? }'),
        files: z.union([z.record(z.string(), z.string()), z.string()]).optional().describe('Instead of `deck`: a Vocion deck as files (deck.json + slides/<id>.html) or a Claude Slides v4 project.'),
        assets: assetsArg.describe('Images by asset id: { "<id>": { url | base64, name? } }. Referenced in slides as src="asset:<id>". For a Claude Slides project, key by the blob hex.'),
        playbook: z.string().max(60).optional().describe('The playbook that shaped it: proposal, concept, case-study… (client-facing ones are read as the buyer before export).'),
        folder: z.string().max(120).optional(),
        look: z.boolean().optional().describe('Also run the vision pass over the rendered slides (a model call). Default false.'),
      }),
    },
  );
}

export function readDeckTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck']);
      if ('error' in found) {
        return found.error;
      }
      const row = await getArtifact({ orgId: ctx.orgId, id: found.id });
      const spec = row?.spec as DeckSpec | undefined;
      if (!row || !spec) {
        return `No deck #${found.id}.`;
      }
      const head = `Deck #${row.id} v${row.currentVersion}`;
      const want = (args.slides ?? []).map(String);
      if (want.length === 0) {
        const v = spec.verification;
        return [
          head,
          deckOutline(spec),
          '',
          v ? `Last render-verify (${v.at.slice(0, 16).replace('T', ' ')}): ${deckVerificationReceipt(v, { images: args.images ?? false })}` : 'Not render-verified yet.',
          spec.redTeam ? `Read as the buyer at v${spec.redTeam.version}: ${spec.redTeam.blocks} blocking · ${spec.redTeam.fixes} to fix.` : 'Not read as the buyer on this version.',
          '',
          'Read a slide\'s HTML with read_deck({ slides: ["<id>"] }) before you replace it.',
        ].join('\n');
      }
      const ids = want.map(w => (spec.slides[w] !== undefined ? w : /^\d+$/.test(w) ? spec.order[Number(w) - 1] : undefined));
      const missing = want.filter((_, i) => !ids[i]);
      if (missing.length) {
        return `${head}: no slide ${missing.join(', ')} (the deck has ${spec.order.join(', ')}).`;
      }
      return `${head}\n${ids.map((id) => {
        const n = spec.order.indexOf(id!) + 1;
        return `=== slide ${n} of ${spec.order.length} [${id}] — ${slideText(spec.slides[id!]!).label} ===\n${spec.slides[id!]}`;
      }).join('\n\n')}`;
    },
    {
      name: 'read_deck',
      description: 'Read a deck artifact: by default its index (title, one line per slide with id, label and whether it has notes, assets), its last render-verify receipt and its red-team state; with `slides`, the exact HTML (notes included) of the slides you name, by id or 1-based number. Read a slide before you replace it. Omit `id` for the deck the person has open.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        slides: z.array(z.union([z.string(), z.number().int().positive()])).max(8).optional().describe('Slide ids (or 1-based numbers) whose HTML you want.'),
        images: z.boolean().optional().describe('List each slide\'s screenshot URL in the receipt.'),
      }),
    },
  );
}

export function editDeckTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck']);
      if ('error' in found) {
        return found.error;
      }
      const parsedOps = z.array(deckOpSchema).max(30).safeParse(coerceJson(args.ops) ?? []);
      if (!parsedOps.success) {
        return `edit_deck rejected: ops did not validate — ${parsedOps.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}.`;
      }
      const assetsIn = parseAssets(args.assets);
      if ('error' in assetsIn) {
        return `edit_deck rejected: ${assetsIn.error}.`;
      }
      const ingested = Object.keys(assetsIn).length ? await ingestDeckAssets(ctx.orgId, assetsIn) : { assets: {}, errors: [] };
      if (ingested.errors.length > 0) {
        return `edit_deck rejected, nothing changed: ${ingested.errors.join('; ')}.`;
      }
      const ops: DeckOp[] = [
        ...Object.entries(ingested.assets).map(([asset, value]) => ({ op: 'set_asset' as const, asset, value })),
        ...parsedOps.data,
      ];
      if (ops.length === 0) {
        return 'edit_deck rejected: no ops and no assets given.';
      }
      try {
        const { artifact, version, outcome, applied } = await reviseDeck({
          orgId: ctx.orgId,
          id: found.id,
          author: authorOf(ctx),
          runId: ctx.traceId ?? null,
          changeSummary: args.change_summary,
          ops,
          verify: { look: args.look ?? false, onProgress: progressTo(ctx, 'edit_deck') },
        });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        return `Updated "${artifact.title}" to v${version.version} (${applied.join('; ')}). The person sees it live in the pane — do NOT repeat the content as text.\n\n${deckReceipt(artifact.spec as DeckSpec, outcome)}`;
      } catch (err) {
        if (err instanceof DeckEditError) {
          return `edit_deck rejected: ${err.message}`;
        }
        if (err instanceof ArtifactError) {
          return `edit_deck rejected: ${err.message}. Read the deck, fix the ops, and call again.`;
        }
        return `Could not edit the deck: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'edit_deck',
      description: 'Change a deck IN PLACE, all ops or none, as one new version, and re-run the render-verify loop. Ops: replace_slide{id,html} · insert_slide{html,after?} (after omitted = append, "^" = first) · remove_slide{id} · move_slide{id,to} · replace_text{find,replace,slide?,all?} (literal; must match exactly once in the named slide, or once across the deck, unless all) · set_notes{id,notes} · set_title{title} · set_asset{asset,value|null}. New images go in `assets` and are stored before the ops run. Read the slide first (read_deck) so a replacement is the real slide, changed. Omit `id` for the open deck.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        ops: z.union([z.array(deckOpSchema).max(30), z.string()]).optional().describe('Ordered operations (a JSON string is tolerated).'),
        assets: assetsArg.describe('New images by asset id: { "<id>": { url | base64, name? } }.'),
        change_summary: z.string().min(1).max(160).describe('One line for the version menu, past tense: "cut the pricing slide; added the case study".'),
        look: z.boolean().optional(),
      }),
    },
  );
}

export function verifyDeckTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck']);
      if ('error' in found) {
        return found.error;
      }
      try {
        const { artifact, outcome } = await verifyDeckArtifact({ orgId: ctx.orgId, id: found.id, agentSlug: ctx.agentSlug ?? null, verify: { look: args.look ?? true, onProgress: progressTo(ctx, 'verify_deck') } });
        ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
        return `Verified "${artifact.title}" v${artifact.currentVersion}.\n\n${deckReceipt(artifact.spec as DeckSpec, outcome)}`;
      } catch (err) {
        return `Could not verify the deck: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'verify_deck',
      description: 'Re-render and re-audit a deck as it stands — and, by default, the vision LOOK at every slide for what an audience would notice. Use it as the final pass before you say a deck is ready. Omit `id` for the open deck.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        look: z.boolean().optional().describe('Run the vision pass (default true).'),
      }),
    },
  );
}

export function exportDeckPdfTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck']);
      if ('error' in found) {
        return found.error;
      }
      try {
        const row = await getArtifact({ orgId: ctx.orgId, id: found.id });
        const spec = (row?.spec ?? {}) as Partial<DeckSpec>;
        const gate = await gateExport({
          orgId: ctx.orgId,
          playbook: spec.playbook ?? null,
          redTeam: spec.redTeam ?? null,
          unit: SLIDE_UNIT,
          onPersonsWord: args.asked_by_person === true,
          readNow: () => redTeamDeckArtifact({ orgId: ctx.orgId, id: found.id, agentSlug: ctx.agentSlug ?? null }),
        });
        if (gate.action === 'refuse') {
          return gate.line;
        }
        const res = await exportDeckPdf({ orgId: ctx.orgId, id: found.id, author: authorOf(ctx), conversationId: ctx.conversationId ?? null, visibility: ctx.missionRunId ? 'system' : 'user', onProgress: progressTo(ctx, 'export_deck_pdf') });
        ctx.emit({ type: 'artifact', artifact: toPayload(res.file) });
        const head = `PDF ready: ${res.filename} (${res.pages ?? '?'} pages at 1920×1080, ${Math.max(1, Math.round(res.bytes / 1024))} KB) at ${res.url}. It is filed beside the deck as a file artifact.`;
        return gate.line ? `${head}\n\n${gate.line}` : head;
      } catch (err) {
        return `Could not export the PDF: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'export_deck_pdf',
      description: 'Print a deck to a PDF file artifact — one 1920×1080 page per slide, backgrounds on — named from its title. A CLIENT-FACING deck (proposal, concept, case study…) is read as the sceptical buyer on the way out: if this version has not been red-teamed, the export runs it first, and a BLOCKING finding holds YOUR export until it is answered. When the person asked for the PDF in their own words, pass asked_by_person: the PDF goes out and a block comes back as one line of advice. Omit `id` for the open deck.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        asked_by_person: z.boolean().optional().describe('True when the person asked for this PDF themselves in this turn.'),
      }),
    },
  );
}

export function deckCheckoutTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck', 'document']);
      if ('error' in found) {
        return found.error;
      }
      try {
        const out = await checkoutDeliverable({ orgId: ctx.orgId, id: found.id, format: args.format ?? 'vocion' });
        return JSON.stringify({
          ...out,
          checkin: `Edit the files, then deck_checkin({ id: ${out.id}, baseVersion: ${out.baseVersion}, files }) with every file (changed or not). New images: add them to \`assets\` by id (url or base64) and reference them as src="asset:<id>"${out.format === 'claude-slides/4' ? ' — or as /_blob/<hex> with the bytes in assets keyed by the hex' : ''}. Download links expire in an hour.`,
        }, null, 2);
      } catch (err) {
        return `deck_checkout failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'deck_checkout',
      description: 'Check a deck or a document out as files, to edit anywhere: a deck as deck.json + slides/<id>.html (or, with format "claude-slides", a Claude Slides v4 project), a document as document.html; plus short-lived download links for its images and the baseVersion to check it back in against. Writes nothing.',
      schema: z.object({
        id: z.number().int().positive().optional().describe('The deck or document. Omit for the one open.'),
        format: z.enum(['vocion', 'claude-slides']).optional().describe('For a deck: the file layout (default vocion).'),
      }),
    },
  );
}

export function deckCheckinTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const found = await resolveDeliverable(ctx, args.id, ['deck', 'document']);
      if ('error' in found) {
        return found.error;
      }
      const files = coerceJson(args.files);
      const parsedFiles = z.record(z.string(), z.string()).safeParse(files);
      if (!parsedFiles.success) {
        return 'deck_checkin rejected: `files` must be { "<path>": "<text>" }.';
      }
      const assetsIn = parseAssets(args.assets);
      if ('error' in assetsIn) {
        return `deck_checkin rejected: ${assetsIn.error}.`;
      }
      try {
        const res = await checkinDeliverable({
          orgId: ctx.orgId,
          id: found.id,
          baseVersion: args.baseVersion,
          files: parsedFiles.data,
          assets: assetsIn,
          author: authorOf(ctx),
          runId: ctx.traceId ?? null,
          ...(args.tool ? { tool: args.tool } : {}),
          ...(args.change_summary ? { changeSummary: args.change_summary } : {}),
          onProgress: progressTo(ctx, 'deck_checkin'),
        });
        if (res.status === 'stale') {
          return `NOT checked in: #${found.id} changed in Vocion since v${args.baseVersion} (it is at v${res.currentVersion}). Check it out again and redo your change on top. What changed:\n${res.diff}`;
        }
        if (res.status === 'unchanged') {
          return `Nothing to check in: the files match v${res.version}.`;
        }
        ctx.emit({ type: 'artifact', artifact: toPayload(res.artifact) });
        const receipt = res.kind === 'deck' ? deckReceipt(res.spec, res.outcome) : documentReceipt(res.outcome);
        return [`Checked in "${res.artifact.title}" as v${res.version}.`, ...res.warnings.map(w => `! ${w}`), '', receipt].join('\n');
      } catch (err) {
        if (err instanceof ArtifactError || err instanceof DeckEditError) {
          return `deck_checkin rejected: ${err.message}`;
        }
        return `Could not check in: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'deck_checkin',
      description: 'Check an edited deck or document back in as a new version, re-rendered and re-audited. Pass the baseVersion deck_checkout gave you and every file. A stale baseVersion (the deliverable changed in Vocion since) is refused with a slide-by-slide or sheet-by-sheet diff of what changed, so the change can be redone on top. Claude Slides v4 projects are accepted and converted. New images arrive in `assets` as a URL or base64.',
      schema: z.object({
        id: z.number().int().positive().optional(),
        baseVersion: z.number().int().nonnegative().describe('The version the files were checked out at.'),
        files: z.union([z.record(z.string(), z.string()), z.string()]).describe('Path → text: deck.json + slides/<id>.html, project/deck.json + project/slides/<id>.html, or document.html.'),
        assets: assetsArg.describe('New images: { "<asset id or blob hex>": { url | base64, name? } }.'),
        tool: z.string().max(80).optional().describe('What it was edited in, as the person said (recorded as where the version came from).'),
        change_summary: z.string().max(160).optional(),
      }),
    },
  );
}

export function deckTools(ctx: RuntimeContext) {
  return [renderDeckTool(ctx), readDeckTool(ctx), editDeckTool(ctx), verifyDeckTool(ctx), exportDeckPdfTool(ctx), deckCheckoutTool(ctx), deckCheckinTool(ctx)];
}
