/**
 * THE MOCKUP, DRAWN ON THE REAL SCREEN — the half that knows the tables.
 *
 * `libs/factory/mockup.ts` says what a mockup is allowed to be; this finds
 * the screenshot, reads it, draws the states over it and files each one as an
 * artifact on the request. The record write that points the feature page at
 * them is the tool's (`agents/tools/drawMockup.ts`), because a write made in a
 * person's turn has to announce itself to their page (`version_written`).
 *
 * Two calls, one tool:
 *
 *   - SURVEY. The base screenshot, its size, and a map of what is on it with
 *     pixel boxes, read by a vision model — so the designer places a change
 *     where the screen actually has room, in the screen's own style, rather
 *     than guessing coordinates on a picture it cannot see.
 *   - DRAW. Each state rendered in real Chromium as the screenshot with the
 *     change laid over it, saved as a PNG, filed on the request.
 */

import type { BasePick, MockupState, ShotCandidate } from '@/libs/factory/mockup';
import type { Author } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { mockupHtml, mockupProblems, mockupRole, pickBase } from '@/libs/factory/mockup';

/** A visible thing on the base screenshot, in its pixels. */
export type ScreenElement = { what: string; x: number; y: number; width: number; height: number };

/** What the designer needs to place a change: the base and a map of it. */
export type ScreenSurvey = {
  base: { artifactId: number; title: string; url: string; viewport: string | null; width: number; height: number; capturedAt: Date };
  elements: ScreenElement[];
  /** The screen's look in one line — font, colours, radius — for the change to match. */
  style: string | null;
  /** Why there is no map, when there is none. */
  mapSkipped?: string;
};

export type DrawnState = { state: string; artifactId: number; url: string; title: string };

export type MockupFailure = { ok: false; reason: string };

/**
 * Every artifact on the request and on its engineering tasks, as the base
 * picker reads them. QA's captures hang off the task; a before-shot someone
 * filed hangs off the request.
 * @param orgId - The workspace.
 * @param requestId - The request.
 */
export async function shotsForRequest(orgId: string, requestId: number): Promise<ShotCandidate[]> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const { listArtifactsForRecords } = await import('@/services/ArtifactService');
  const tasks = await listBusinessObjects(orgId, 'engineering_task').catch(() => []);
  const taskIds = tasks
    .filter(t => Number(((t.metadata ?? {}) as Record<string, unknown>).requestId) === requestId)
    .map(t => String(t.id));
  const rows = await listArtifactsForRecords({ orgId, recordType: 'object', recordIds: [String(requestId), ...taskIds] });
  return rows.map(a => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    recordRole: a.recordRole ?? null,
    url: a.url ?? null,
    spec: (a.spec ?? {}) as Record<string, unknown>,
    createdAt: a.createdAt,
  }));
}

/**
 * The base screenshot's pixels, at their own size.
 * @param orgId - The workspace.
 * @param url - The capture's stored URL.
 */
async function openBase(orgId: string, url: string): Promise<{ dataUri: string; width: number; height: number; bytes: Buffer } | MockupFailure> {
  const { openImage } = await import('@/libs/tools/artifacts/ingest');
  try {
    // A large edge so a desktop capture keeps its own pixels: the regions the
    // designer sends are in those pixels.
    const img = await openImage(orgId, url, { maxEdge: 4096 });
    if (!img.width || !img.height) {
      return { ok: false, reason: 'the screenshot has no readable size' };
    }
    return { dataUri: img.dataUri, width: img.width, height: img.height, bytes: img.bytes };
  } catch (err) {
    return { ok: false, reason: `the screenshot could not be opened (${(err as Error).message})` };
  }
}

const SurveySchema = z.object({
  style: z.string().max(300).optional(),
  elements: z.array(z.object({
    what: z.string().min(1).max(120),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })).max(60),
});

/** The longest edge sent to the vision model; coordinates are scaled back. */
const SURVEY_EDGE = 1568;

const SURVEY_PROMPT = [
  'This is a screenshot of a real product screen. Map what is on it so a designer can add ONE small change in the right place.',
  'List the visible elements a change could sit beside or inside — the page header, each list row and its parts (title, meta line, link, badges, action buttons), toolbars, empty space — with pixel boxes in THIS image\'s coordinates (x, y from the top-left, width, height).',
  'Also give the screen\'s style in one line: font family feel, text and accent colours as hex, corner radius, icon style.',
  'Return STRICT JSON only: {"style":"…","elements":[{"what":"…","x":0,"y":0,"width":0,"height":0}]}. At most 40 elements, most useful first.',
].join(' ');

/**
 * Read the screenshot's layout with a vision model. Best-effort: no model or
 * an unreadable answer returns no map and says why — the base is still real.
 * @param opts - The workspace, the agent it is charged to, and the image.
 * @param opts.orgId - The workspace.
 * @param opts.agentSlug - Who is charged.
 * @param opts.image - The base.
 * @param opts.image.bytes - Its bytes.
 * @param opts.image.width - Its width.
 * @param opts.image.height - Its height.
 */
async function mapScreen(opts: { orgId: string; agentSlug?: string; image: { bytes: Buffer; width: number; height: number } }): Promise<{ elements: ScreenElement[]; style: string | null } | { skipped: string }> {
  try {
    const { default: sharp } = await import('sharp');
    const longest = Math.max(opts.image.width, opts.image.height);
    const scale = longest > SURVEY_EDGE ? SURVEY_EDGE / longest : 1;
    const png = scale < 1
      ? await sharp(opts.image.bytes).resize({ width: Math.round(opts.image.width * scale) }).png().toBuffer()
      : await sharp(opts.image.bytes).png().toBuffer();
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const { HumanMessage } = await import('@langchain/core/messages');
    const model = await buildChatModelForOrg('extractor', opts.orgId, { temperature: 0, streaming: false, maxTokens: 3000 });
    const res = await model.invoke([new HumanMessage({
      content: [
        { type: 'text', text: SURVEY_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
      ],
    })] as never);
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    await chargeModelCall({ orgId: opts.orgId, agentSlug: opts.agentSlug, feature: FEATURES.TOOL_MOCKUP, role: 'extractor', response: res }).catch(() => undefined);
    const text = typeof res.content === 'string'
      ? res.content
      : (res.content as Array<{ type?: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
    const parsed = SurveySchema.safeParse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
    if (!parsed.success) {
      return { skipped: 'the vision model returned something other than a map' };
    }
    const back = (n: number) => Math.round(n / scale);
    return {
      style: parsed.data.style?.trim() || null,
      elements: parsed.data.elements.map(e => ({ what: e.what, x: back(e.x), y: back(e.y), width: back(e.width), height: back(e.height) })),
    };
  } catch (err) {
    return { skipped: `the screen could not be read (${(err as Error).message.split('\n')[0]})` };
  }
}

/**
 * The base, chosen from the request's captures, or why there is none.
 * @param orgId - The workspace.
 * @param requestId - The request.
 * @param opts - The picker's choices (`pickBase`).
 * @param opts.viewport - desktop / mobile.
 * @param opts.baseId - A capture the caller named.
 */
export async function chooseBase(orgId: string, requestId: number, opts: { viewport?: string | null; baseId?: number | null } = {}): Promise<BasePick> {
  return pickBase(await shotsForRequest(orgId, requestId), opts);
}

/**
 * The survey: the base and a map of it.
 * @param opts - The request and who is asking.
 * @param opts.orgId - The workspace.
 * @param opts.requestId - The request.
 * @param opts.agentSlug - Who the map is charged to.
 * @param opts.viewport - desktop / mobile.
 * @param opts.baseId - A capture the caller named.
 */
export async function surveyScreen(opts: { orgId: string; requestId: number; agentSlug?: string; viewport?: string | null; baseId?: number | null }): Promise<ScreenSurvey | MockupFailure> {
  const pick = await chooseBase(opts.orgId, opts.requestId, opts);
  if (!pick.ok) {
    return pick;
  }
  const img = await openBase(opts.orgId, pick.url);
  if ('ok' in img) {
    return img;
  }
  const map = await mapScreen({ orgId: opts.orgId, agentSlug: opts.agentSlug, image: img });
  return {
    base: { artifactId: pick.shot.id, title: pick.shot.title, url: pick.url, viewport: pick.viewport, width: img.width, height: img.height, capturedAt: pick.shot.createdAt },
    elements: 'skipped' in map ? [] : map.elements,
    style: 'skipped' in map ? null : map.style,
    ...('skipped' in map ? { mapSkipped: map.skipped } : {}),
  };
}

/**
 * Draw every state over the base and file each as an artifact on the request.
 * Refuses the whole call when any state is not a plain UI change, so a
 * request never carries half a set.
 * @param opts - What to draw and where it is filed.
 * @param opts.orgId - The workspace.
 * @param opts.requestId - The request.
 * @param opts.requestTitle - For the artifact titles.
 * @param opts.states - The states, in the order they are read.
 * @param opts.viewport - desktop / mobile.
 * @param opts.baseId - A capture the caller named.
 * @param opts.author - Who the versions are recorded as.
 * @param opts.conversationId - The conversation they open beside.
 * @param opts.visibility - `system` inside a mission run.
 */
export async function drawMockups(opts: {
  orgId: string;
  requestId: number;
  requestTitle: string;
  states: MockupState[];
  viewport?: string | null;
  baseId?: number | null;
  author: Author;
  conversationId?: number | null;
  visibility?: 'user' | 'system';
}): Promise<{ ok: true; base: ScreenSurvey['base']; drawn: DrawnState[]; artifacts: unknown[] } | MockupFailure> {
  const pick = await chooseBase(opts.orgId, opts.requestId, opts);
  if (!pick.ok) {
    return pick;
  }
  const img = await openBase(opts.orgId, pick.url);
  if ('ok' in img) {
    return img;
  }
  const size = { width: img.width, height: img.height };
  const problems = mockupProblems(opts.states, size);
  if (problems.length > 0) {
    return { ok: false, reason: `Nothing was drawn:\n${problems.map(p => `- ${p}`).join('\n')}` };
  }
  const { renderAvailable, renderScreen } = await import('@/libs/documents/render');
  const ready = await renderAvailable();
  if (!ready.ok) {
    return { ok: false, reason: `the renderer is not available on this installation (${ready.reason}), so nothing was drawn` };
  }
  const { saveArtifact } = await import('@/libs/tools/artifacts/store');
  const { upsertRecordArtifact } = await import('@/services/ArtifactService');
  const drawn: DrawnState[] = [];
  const artifacts: unknown[] = [];
  for (const s of opts.states) {
    const shot = await renderScreen(mockupHtml(img.dataUri, size, s.changes));
    const file = await saveArtifact({ orgId: opts.orgId, data: Buffer.from(shot.png), ext: 'png', contentType: 'image/png' });
    const title = `${opts.requestTitle} · ${s.state.trim()}`;
    const { artifact } = await upsertRecordArtifact({
      orgId: opts.orgId,
      conversationId: opts.conversationId ?? null,
      kind: 'file',
      title,
      spec: { filename: file.filename, contentType: file.contentType, bytes: file.bytes, url: file.url, baseArtifactId: pick.shot.id, width: shot.width, height: shot.height },
      url: file.url,
      record: { type: 'object', id: String(opts.requestId), role: mockupRole(s.state) },
      author: opts.author,
      changeSummary: `Drawn on screenshot #${pick.shot.id}`,
      visibility: opts.visibility ?? 'user',
    });
    drawn.push({ state: s.state.trim(), artifactId: artifact.id, url: file.url, title });
    artifacts.push(artifact);
  }
  return {
    ok: true,
    base: { artifactId: pick.shot.id, title: pick.shot.title, url: pick.url, viewport: pick.viewport, width: img.width, height: img.height, capturedAt: pick.shot.createdAt },
    drawn,
    artifacts,
  };
}
