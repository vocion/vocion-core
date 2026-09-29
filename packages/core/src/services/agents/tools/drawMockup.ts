/**
 * draw_mockup — the change, drawn on the real screen, filed where the page reads it.
 *
 * Request #224, 2026-09-29: asked for mocks on the feature page, the designer
 * wrote two annotated HTML documents from memory and typed their ids into
 * `visuals.beforeArtifactIds` by hand — the AFTER among them — and the page
 * went on saying "Preview pending". Chris: *"It should have attached the image
 * to the feature request item, and refreshed the left pane… it should just be
 * the outcome design, it shouldn't invent UX, it should be based off the
 * existing app."*
 *
 * So the mockup is a typed call, and everything the model got wrong is the
 * tool's job:
 *
 *   - the BASE is chosen here, never typed: the newest real capture of the
 *     surface on the request's tasks (`libs/factory/mockup.pickBase`). No
 *     capture, no drawing — the tool says so.
 *   - called with no `mockups`, it SURVEYS: the base, its size and a map of
 *     what is on it with pixel boxes, so the change is placed on the screen
 *     that exists.
 *   - called with `mockups` (1..6 states), it DRAWS each as the screenshot
 *     with only the change laid over it — plain UI, checked for captions,
 *     labels and arrows — files each as an image artifact on the request
 *     (they open in the preview pane), and WRITES the record itself:
 *     `visuals.beforeArtifactIds` is the screenshot, `visuals.mockupArtifactIds`
 *     the drawn states, as a new version of the request announced to the page
 *     (`version_written`), so the feature page redraws while the person
 *     watches.
 */

import type { RuntimeContext } from '../types';
import type { MockupState } from '@/libs/factory/mockup';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { mockupVisuals } from '@/libs/factory/mockup';
import { notWritableMessage, recordWritable, writeRecordAsAgent } from './recordWrite';

const regionSchema = z.object({
  x: z.number().describe('Left edge, in the screenshot\'s own pixels (from the survey).'),
  y: z.number().describe('Top edge, in pixels.'),
  width: z.number().describe('Width, in pixels.'),
  height: z.number().describe('Height, in pixels.'),
});

const stateSchema = z.object({
  state: z.string().min(1).max(40).describe('What this image shows, in two or three words: "Default", "Hover", "Link copied".'),
  changes: z.array(z.object({
    region: regionSchema.describe('Where the change lands on the screen. Cover only what changes; everything outside stays the real screenshot.'),
    html: z.string().min(1).describe('The new UI itself, as plain HTML — the button, the row, the toast — in the screen\'s own style. Never a label, caption, arrow or note about it.'),
    css: z.string().optional().describe('Styles for that HTML.'),
  })).min(1).max(4),
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

      // SURVEY: no states yet — hand back the real screen and where things are on it.
      if (args.mockups === undefined || args.mockups === null) {
        const survey = await service.surveyScreen({ ...opts, agentSlug: ctx.agentSlug });
        if ('ok' in survey) {
          return survey.reason;
        }
        const b = survey.base;
        const map = survey.elements.length > 0
          ? survey.elements.map(e => `- ${e.what}: x ${e.x}, y ${e.y}, ${e.width}×${e.height}`).join('\n')
          : `(no map: ${survey.mapSkipped ?? 'nothing was read'} — place the change from the screenshot's size and the request)`;
        return [
          `The screen today: artifact #${b.artifactId} "${b.title}", ${b.width}×${b.height}px${b.viewport ? `, ${b.viewport}` : ''}, captured ${b.capturedAt.toISOString().slice(0, 10)}. This is the BEFORE; it is used as it is.`,
          survey.style ? `Its style: ${survey.style}` : null,
          `What is on it, in its pixels:\n${map}`,
          'Now call draw_mockup again with `mockups`: one entry per state worth seeing (the change at rest, and a hover or confirmation state only when it helps), each with the region the change covers and the new UI as plain HTML in this style. Draw only what the request asks for; no labels, captions, arrows or notes on the image.',
        ].filter(Boolean).join('\n\n');
      }

      const parsed = z.array(stateSchema).min(1).max(6).safeParse(coerceStates(args.mockups));
      if (!parsed.success) {
        return `draw_mockup rejected: mockups did not validate — ${parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}.`;
      }
      const states = parsed.data as MockupState[];
      const out = await service.drawMockups({
        ...opts,
        requestTitle: row.title,
        states,
        author: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null },
        conversationId: ctx.conversationId ?? null,
        visibility: ctx.missionRunId ? 'system' : 'user',
      });
      if (!out.ok) {
        return out.reason;
      }
      const { toPayload } = await import('@/services/ArtifactService');
      for (const a of out.artifacts) {
        ctx.emit({ type: 'artifact', artifact: toPayload(a as Parameters<typeof toPayload>[0]) });
      }
      const mockupIds = out.drawn.map(d => d.artifactId);
      const visuals = mockupVisuals(((row.metadata ?? {}) as Record<string, unknown>).visuals, { beforeId: out.base.artifactId, mockupIds });
      const label = `${row.type.label.toLowerCase()} #${requestId}`;
      const drawnLine = out.drawn.map(d => `#${d.artifactId} ${d.state}`).join(', ');
      try {
        const res = await writeRecordAsAgent(ctx, {
          objectType: typeSlug,
          id: requestId,
          set: { visuals },
          reason: `Mockup on the real screen (screenshot #${out.base.artifactId}): ${drawnLine}.`,
          confidence: 0.9,
          label,
          ownsVisualIds: true,
        });
        if (res.status === 'pending') {
          return `Drew ${out.drawn.length} image${out.drawn.length === 1 ? '' : 's'} on screenshot #${out.base.artifactId}: ${drawnLine}. Putting them on ${label} is PENDING a person's decision (run #${res.runId}); do NOT say the page shows them yet.`;
        }
        if (res.status !== 'done') {
          return `Drew ${drawnLine}, but the write to ${label} did not land (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`;
        }
        return `Drew ${out.drawn.length} image${out.drawn.length === 1 ? '' : 's'} on the real screen (screenshot #${out.base.artifactId}): ${drawnLine}. ${label} now shows them — before: #${out.base.artifactId}, mockups: ${mockupIds.map(i => `#${i}`).join(', ')}${res.version ? ` (version ${res.version.to})` : ''}; the page refreshed. Say in one line what the change looks like on the screen; do not describe the images or repeat these ids. If drawing showed a criterion is wrong, change the request's acceptance with update_object rather than asking.`;
      } catch (err) {
        return `Drew ${drawnLine}, but the write to ${label} was refused: ${(err as Error).message}`;
      }
    },
    {
      name: 'draw_mockup',
      description: 'THE way to mock up a change to a screen for a request. It starts from the real app: the newest screenshot of the surface on the request\'s tasks is the base and the BEFORE, used as it is (no screenshot → it refuses and says so). Call it once with no `mockups` to get the screen, its size and a pixel map of what is on it; then call it with `mockups` — 1 to 6 states (e.g. Default, Hover, Link copied), each the change laid over the real screenshot as plain UI: no labels, captions, arrows, rules or cards on the image. It files each image on the request and writes visuals.beforeArtifactIds and visuals.mockupArtifactIds itself as a new version, so the feature page shows them at once. Never write those ids by hand, and never draw a mockup as a document.',
      schema: z.object({
        request_id: z.number().int().positive().optional().describe('The request. Omit on the request\'s own page.'),
        viewport: z.string().max(20).optional().describe('"desktop" (default) or "mobile" — which capture to draw on.'),
        base_artifact_id: z.number().int().positive().optional().describe('A different capture of the running product on this request or its tasks, when the newest is not the screen the change lands on. Omit to use the newest.'),
        mockups: z.union([z.array(stateSchema).min(1).max(6), z.string()]).optional().describe('The states to draw. Omit to survey the screen first.'),
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
