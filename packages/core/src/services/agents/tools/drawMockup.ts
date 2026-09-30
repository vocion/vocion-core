/**
 * draw_mockup — the outcome, drawn as the product's own UI, filed where the page reads it.
 *
 * Request #224, 2026-09-29: asked for mocks on the feature page, the designer
 * wrote two annotated HTML documents and typed their ids into
 * `visuals.beforeArtifactIds` by hand; the page went on saying "Preview
 * pending". Chris: *"It should have attached the image to the feature request
 * item, and refreshed the left pane"*, and after #903: *"I just want the mocks
 * to be actual UI blocks/mocks, and not a bunch of document text… we actually
 * had GREAT ones in other Features… with maybe a little of UX overlay or
 * hints. Not a written doc, rastered."*
 *
 * So the mockup is a typed call, and everything the model got wrong is the
 * tool's job:
 *
 *   - called with no `mockups`, it SURVEYS: the product's look, the canvas,
 *     and the real screen with a pixel map when a capture exists — a reference,
 *     never a requirement.
 *   - called with `mockups` (1..6 states), it DRAWS each as a PNG: the
 *     product's UI blocks on a quiet canvas (`html`), or the change laid over
 *     the real screenshot (`changes`). UI only, checked; the one overlay is the
 *     platform's own — `data-hint="1"` rings an element and numbers it, and
 *     `data-note="…"` adds one short line beside it (at most three).
 *   - it files each image on the request as a `file` artifact at role
 *     `mockup` (they open in the preview pane) and WRITES the record itself:
 *     `visuals.mockupArtifactIds`, and `visuals.beforeArtifactIds` only when a
 *     real screenshot was drawn on — a new version of the request announced to
 *     the page (`version_written`), so the feature page redraws while the
 *     person watches.
 */

import type { RuntimeContext } from '../types';
import type { MockupState } from '@/libs/factory/mockup';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CANVAS, MOCKUP_KIT_CLASSES, mockupVisuals } from '@/libs/factory/mockup';
import { notWritableMessage, recordWritable, writeRecordAsAgent } from './recordWrite';

const regionSchema = z.object({
  x: z.number().describe('Left edge, in the screenshot\'s own pixels (from the survey).'),
  y: z.number().describe('Top edge, in pixels.'),
  width: z.number().describe('Width, in pixels.'),
  height: z.number().describe('Height, in pixels.'),
});

const stateSchema = z.object({
  state: z.string().min(1).max(40).describe('What this image shows, in two or three words: "Default", "Hover", "Link copied".'),
  caption: z.string().max(140).optional().describe('The one line a person reads under the image on the feature page: what it shows, in the product\'s terms — "Remind a person who has not opened it". Defaults to the state name.'),
  html: z.string().optional().describe('The state drawn as the product\'s own UI blocks — the card, the row, the dialog, the toast, at real size — as plain HTML, centred on the canvas in the product\'s look. Frame it in the product chrome: a vc-window (vc-bar across its top, vc-body under it) and, for the same change on a phone or a second state, a vc-phone (its screen a vc-display) or a vc-panel beside it. Real UI text only (labels, row titles, a toast\'s words). Put data-new on the element that changes (a dashed outline and a NEW pill); data-hint="1" rings and numbers a second spot; data-note="one short line" only where the picture needs it (at most 3 notes, 15 words each).'),
  css: z.string().optional().describe('Styles for that HTML.'),
  changes: z.array(z.object({
    region: regionSchema.describe('Where the change lands on the real screenshot. Cover only what changes.'),
    html: z.string().min(1).describe('The new UI itself, as plain HTML — the button, the row, the toast — in the screen\'s own style.'),
    css: z.string().optional().describe('Styles for that HTML.'),
  })).min(1).max(4).optional().describe('Instead of html: the change laid over the real screenshot from the survey. Only when one exists.'),
});

/**
 * Models often send a nested array as JSON text — read it back as the array.
 * @param v - The raw `mockups`.
 */
function coerceStates(v: unknown): unknown {
  if (typeof v !== 'string') {
    return v;
  }
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

/**
 * The request this call is about: the one named, else the page's.
 * @param ctx - The turn.
 * @param id - What the model passed.
 */
function requestIdOf(ctx: RuntimeContext, id: number | undefined): number | null {
  if (id) {
    return id;
  }
  const rec = ctx.pageContext?.record;
  return rec && (rec.type === 'object' || rec.type === 'request') && /^\d+$/.test(rec.id) ? Number(rec.id) : null;
}

export function drawMockupTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { request_id?: number; viewport?: string; base_artifact_id?: number; mockups?: unknown };
      const requestId = requestIdOf(ctx, args.request_id);
      if (!requestId) {
        return 'Say which request: pass request_id, or open the request\'s page.';
      }
      const { getBusinessObject } = await import('@/services/BusinessObjectService');
      const row = await getBusinessObject(requestId, ctx.orgId);
      if (!row?.type) {
        return `No request #${requestId} in this workspace.`;
      }
      const typeSlug = row.type.slug;
      const props = ((row.type.schema ?? {}) as { properties?: Record<string, { properties?: Record<string, unknown> }> }).properties ?? {};
      if (!props.visuals?.properties?.mockupArtifactIds) {
        return `${row.type.label} #${requestId} carries no visuals.mockupArtifactIds field, so there is nowhere on it for a mockup to land.`;
      }
      if (!recordWritable(ctx, typeSlug, requestId)) {
        return notWritableMessage(ctx, typeSlug, requestId);
      }
      const opts = { orgId: ctx.orgId, requestId, viewport: args.viewport ?? null, baseId: args.base_artifact_id ?? null };
      const service = await import('@/services/factory/mockups');

      const meta = (row.metadata ?? {}) as Record<string, unknown>;

      // SURVEY: no states yet — the product's look, the canvas, and the real
      // screen as a reference when there is one.
      if (args.mockups === undefined || args.mockups === null) {
        const survey = await service.surveyScreen({ ...opts, requestMeta: meta, agentSlug: ctx.agentSlug });
        const l = survey.look.look;
        const lines: Array<string | null> = [
          `Draw on a ${CANVAS.desktop.width}×${CANVAS.desktop.height} canvas (mobile: ${CANVAS.mobile.width}×${CANVAS.mobile.height}), in the product's look — from ${survey.look.from}: background ${l.background}, text ${l.ink}, accent ${l.accent}, font ${l.font}.`,
          `The product chrome is drawn for you — classes ${MOCKUP_KIT_CLASSES.join(', ')}. The standard picture is the product's own window (vc-window with a vc-bar: its mark, nav and primary button) on the desk, the change inside it marked data-new (a dashed outline and a NEW pill), and a second state beside it — a vc-phone (screen: vc-display) or a vc-panel — when one is worth seeing.`,
          l.css ? `Its component CSS (reuse these classes):\n${l.css.slice(0, 3000)}` : null,
        ];
        if (survey.screen) {
          const b = survey.screen.base;
          const map = survey.screen.elements.length > 0
            ? survey.screen.elements.map(e => `- ${e.what}: x ${e.x}, y ${e.y}, ${e.width}×${e.height}`).join('\n')
            : `(no map: ${survey.screen.mapSkipped ?? 'nothing was read'})`;
          lines.push(
            `The real screen, as a reference: artifact #${b.artifactId} "${b.title}", ${b.width}×${b.height}px${b.viewport ? `, ${b.viewport}` : ''}, captured ${b.capturedAt.toISOString().slice(0, 10)}.${survey.screen.style ? ` Its style: ${survey.screen.style}` : ''}`,
            `What is on it, in its pixels:\n${map}`,
          );
        } else {
          lines.push(`No real screen to draw on (${survey.noScreen ?? 'none found'}) — draw the outcome as UI blocks.`);
        }
        lines.push(`Now call draw_mockup again with \`mockups\`: one entry per state worth seeing (the change at rest; hover or a confirmation only when it helps), each with a \`caption\` — the one line a person reads under it. Each is \`html\` — the product's own UI blocks at real size${survey.screen ? ', or `changes` laid over the real screen' : ''}. UI only: mark the change with data-new; data-hint="1" for a second spot; add data-note="…" (one short line) only where the picture cannot say it. No paragraphs, tables, headings about the design or rule boxes.`);
        return lines.filter(Boolean).join('\n\n');
      }

      const parsed = z.array(stateSchema).min(1).max(6).safeParse(coerceStates(args.mockups));
      if (!parsed.success) {
        return `draw_mockup rejected: mockups did not validate — ${parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}.`;
      }
      const states = parsed.data as MockupState[];
      const out = await service.drawMockups({
        ...opts,
        requestTitle: row.title,
        requestMeta: meta,
        states,
        author: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null },
        conversationId: ctx.conversationId ?? null,
        visibility: ctx.missionRunId ? 'system' : 'user',
        provenance: { agentSlug: ctx.agentSlug ?? null, missionRunId: ctx.missionRunId ?? null, conversationId: ctx.conversationId ?? null },
      });
      if (!out.ok) {
        // THE INSTALLATION COULD NOT DRAW: the record carries it typed and
        // the operator is told once (`mockupInfrastructureFailed`) — the
        // reason is theirs, not the request's, and not the agent's to relay.
        if (out.cause === 'infrastructure') {
          const { mockupInfrastructureFailed } = await import('@/services/factory/mockupDefault');
          await mockupInfrastructureFailed(ctx.orgId, requestId, out.reason).catch(err => console.warn('[draw_mockup] could not record an infrastructure failure', { requestId, message: (err as Error).message }));
          return `Nothing was drawn: this installation cannot draw images right now. That is recorded on ${row.type.label.toLowerCase()} #${requestId}, and the installation's operator has been told once, with the detail. It is not the request's problem and not yours: do not write it onto the request (no noVisualReason), do not file an ask about it, and do not call draw_mockup again in this run. Say in one line that the mockup is waiting on the installation, and stop.`;
        }
        return out.reason;
      }
      const { toPayload } = await import('@/services/ArtifactService');
      for (const a of out.artifacts) {
        ctx.emit({ type: 'artifact', artifact: toPayload(a as Parameters<typeof toPayload>[0]) });
      }
      const mockupIds = out.drawn.map(d => d.artifactId);
      const visuals = mockupVisuals(meta.visuals, { beforeId: out.base?.artifactId ?? null, mockupIds, captureIds: out.captureIds });
      const label = `${row.type.label.toLowerCase()} #${requestId}`;
      const drawnLine = out.drawn.map(d => `#${d.artifactId} ${d.state}`).join(', ');
      const how = out.base ? `on the real screen (screenshot #${out.base.artifactId})` : `as the product's UI blocks (look: ${out.lookFrom})`;
      const count = `${out.drawn.length} image${out.drawn.length === 1 ? '' : 's'}`;
      try {
        const res = await writeRecordAsAgent(ctx, {
          objectType: typeSlug,
          id: requestId,
          set: { visuals },
          reason: `Mockup drawn ${how}: ${drawnLine}.`,
          confidence: 0.9,
          label,
          ownsVisualIds: true,
        });
        if (res.status === 'pending') {
          return `Drew ${count} ${how}: ${drawnLine}. Putting them on ${label} is PENDING a person's decision (run #${res.runId}); do NOT say the page shows them yet.`;
        }
        if (res.status !== 'done') {
          return `Drew ${drawnLine}, but the write to ${label} did not land (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`;
        }
        return `Drew ${count} ${how}: ${drawnLine}. ${label} now shows them${res.version ? ` (version ${res.version.to})` : ''}; the page refreshed. Say in one line what the change looks like; do not describe the images or repeat these ids. If drawing showed a criterion is wrong, change the request's acceptance with update_object rather than asking.`;
      } catch (err) {
        return `Drew ${drawnLine}, but the write to ${label} was refused: ${(err as Error).message}`;
      }
    },
    {
      name: 'draw_mockup',
      description: 'THE way to mock up a request: the outcome drawn as the product\'s own UI blocks — the component and its states, in the product\'s window and phone chrome — rendered to an image and filed on the request. Call it once with no `mockups` for the product\'s look, the canvas and, when one exists, the real screen as a reference (with a pixel map); then with `mockups` — 1 to 6 states (e.g. Default, Hover, Link copied), each with a one-line `caption` and either `html` UI blocks or `changes` over the real screenshot. UI only: data-new draws the dashed NEW outline round the change, data-hint="1" rings and numbers a second spot, data-note="…" adds at most three one-line notes; paragraphs, tables, headings about the design and rule boxes are refused. It writes visuals.mockupArtifactIds (and visuals.beforeArtifactIds when a screenshot was drawn on) itself as a new version, so the feature page shows them at once. Never write those ids by hand, and never draw a mockup as a document.',
      schema: z.object({
        request_id: z.number().int().positive().optional().describe('The request. Omit on the request\'s own page.'),
        viewport: z.string().max(20).optional().describe('"desktop" (default, a 1440×900 canvas) or "mobile" (430×932) — and which capture to draw on.'),
        base_artifact_id: z.number().int().positive().optional().describe('A different capture of the running product on this request or its tasks, when the newest is not the screen the change lands on. Omit to use the newest.'),
        mockups: z.union([z.array(stateSchema).min(1).max(6), z.string()]).optional().describe('The states to draw. Omit to survey first.'),
      }),
    },
  );
}

/**
 * The mockup tool, for an agent that works with requests.
 * @param ctx - The turn.
 */
export function drawMockupTools(ctx: RuntimeContext) {
  return ctx.objectTypeSlugs.includes('request') ? [drawMockupTool(ctx)] : [];
}
