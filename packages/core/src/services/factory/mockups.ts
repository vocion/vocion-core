/**
 * THE MOCKUP, DRAWN — the half that knows the tables.
 *
 * `libs/factory/mockup.ts` says what a mockup is allowed to be; this finds
 * the product's look and any real screenshot, renders each state in Chromium
 * and files it as a PNG `file` artifact on the request at role `mockup` — the
 * shape of the #124-era mockups the feature page's carousel already shows
 * well. The record write that points the page at them is the tool's
 * (`agents/tools/drawMockup.ts`), because a write made in a person's turn has
 * to announce itself to their page (`version_written`).
 *
 * Two calls, one tool:
 *
 *   - SURVEY. The product's look (its product record's `look`, else the CSS
 *     of the last mockup drawn for the same product, else a neutral default),
 *     the canvas sizes, and — when a real capture of the surface exists — that
 *     screenshot with a vision-read map of it, as a reference.
 *   - DRAW. Each state rendered: the product's UI blocks on the canvas, or
 *     changes laid over the real screenshot. Saved as a PNG, filed on the
 *     request.
 */

import type { BasePick, MockupLook, MockupState, ShotCandidate } from '@/libs/factory/mockup';
import type { Author } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { blocksHtml, CAPTURE_ROLES, DEFAULT_LOOK, MOCKUP_ROLE, mockupHtml, mockupProblems, mockupTitle, pickBase } from '@/libs/factory/mockup';

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

/**
 * Why nothing was drawn. `cause` says WHERE it failed, typed at the place it
 * failed rather than read back from the words: `infrastructure` — the
 * installation could not draw at all (no renderer, the render or the store
 * threw), which only its operator can fix and a person is never shown the
 * detail of; `content` — the drawing itself was refused, which the drawer
 * fixes by drawing again.
 */
export type MockupFailure = { ok: false; reason: string; cause?: 'infrastructure' | 'content' };

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
  const { factoryTypes } = await import('@/libs/factory/types');
  const tasks = await listBusinessObjects(orgId, (await factoryTypes(orgId)).task).catch(() => []);
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

function bag(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const lookSchema = z.object({
  background: z.string().max(200).optional(),
  ink: z.string().max(200).optional(),
  accent: z.string().max(200).optional(),
  font: z.string().max(200).optional(),
  css: z.string().max(8_000).optional(),
});

/** Where the look came from, said plainly to the designer. */
export type LookSource = { look: MockupLook; from: string };

/**
 * THE PRODUCT'S LOOK: the product record's `look` (colours, font, and the
 * CSS its components are drawn with), else the look the last mockup for the
 * same product was drawn in — so a product's mockups agree with each other —
 * else a neutral default. Never throws.
 * @param orgId - The workspace.
 * @param requestMeta - The request's metadata, for its `product`.
 */
export async function productLook(orgId: string, requestMeta: Record<string, unknown>): Promise<LookSource> {
  const product = typeof requestMeta.product === 'string' ? requestMeta.product.trim().toLowerCase() : '';
  try {
    const { listBusinessObjects } = await import('@/services/BusinessObjectService');
    if (product) {
      const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
      const products = await listBusinessObjects(orgId, types.product).catch(() => []);
      const row = products.find(p => String(bag(p.metadata).slug ?? '').toLowerCase() === product || p.title.trim().toLowerCase() === product);
      const parsed = lookSchema.safeParse(bag(row?.metadata).look);
      if (row && parsed.success && Object.keys(parsed.data).length > 0) {
        return { look: { ...DEFAULT_LOOK, ...parsed.data }, from: `product "${row.title}"` };
      }
      const requests = await listBusinessObjects(orgId, types.request).catch(() => []);
      const siblings = requests.filter(r => String(bag(r.metadata).product ?? '').toLowerCase() === product).map(r => String(r.id));
      const { listArtifactsForRecords } = await import('@/services/ArtifactService');
      const drawn = (await listArtifactsForRecords({ orgId, recordType: 'object', recordIds: siblings }))
        .filter(a => a.recordRole === MOCKUP_ROLE && bag(bag(a.spec).source).look)
        .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())[0];
      const earlier = lookSchema.safeParse(bag(bag(drawn?.spec).source).look);
      if (drawn && earlier.success) {
        return { look: { ...DEFAULT_LOOK, ...earlier.data }, from: `the last mockup drawn for this product (#${drawn.id})` };
      }
    }
  } catch (err) {
    console.warn('mockup look: could not read the product', { orgId, message: (err as Error).message });
  }
  return { look: DEFAULT_LOOK, from: 'the neutral default (the product record carries no look yet)' };
}

/** What the designer draws against: the look, the canvas, and a real screen when there is one. */
export type MockupSurvey = {
  look: LookSource;
  screen: ScreenSurvey | null;
  /** Why there is no screen, when there is none. */
  noScreen?: string;
};

/**
 * The survey: the product's look, and the real screen with a map of it when
 * a capture exists. A missing screenshot is not a failure — the mockup is
 * then drawn as UI blocks.
 * @param opts - The request and who is asking.
 * @param opts.orgId - The workspace.
 * @param opts.requestId - The request.
 * @param opts.requestMeta - Its metadata, for the product.
 * @param opts.agentSlug - Who the map is charged to.
 * @param opts.viewport - desktop / mobile.
 * @param opts.baseId - A capture the caller named.
 */
export async function surveyScreen(opts: { orgId: string; requestId: number; requestMeta: Record<string, unknown>; agentSlug?: string; viewport?: string | null; baseId?: number | null }): Promise<MockupSurvey> {
  const look = await productLook(opts.orgId, opts.requestMeta);
  const pick = await chooseBase(opts.orgId, opts.requestId, opts);
  if (!pick.ok) {
    return { look, screen: null, noScreen: pick.reason };
  }
  const img = await openBase(opts.orgId, pick.url);
  if ('ok' in img) {
    return { look, screen: null, noScreen: img.reason };
  }
  const map = await mapScreen({ orgId: opts.orgId, agentSlug: opts.agentSlug, image: img });
  return {
    look,
    screen: {
      base: { artifactId: pick.shot.id, title: pick.shot.title, url: pick.url, viewport: pick.viewport, width: img.width, height: img.height, capturedAt: pick.shot.createdAt },
      elements: 'skipped' in map ? [] : map.elements,
      style: 'skipped' in map ? null : map.style,
      ...('skipped' in map ? { mapSkipped: map.skipped } : {}),
    },
  };
}

/**
 * File one drawn state on the request at role `mockup`: a redraw of the same
 * title is a new version of the same artifact, anything else a new one. The
 * picture lives on `spec.url`, which a version carries — the row's own `url`
 * column is left empty so a redraw can never leave it pointing at the old PNG.
 * @param opts - The artifact to file.
 * @param opts.orgId - The workspace.
 * @param opts.requestId - The request.
 * @param opts.title - Its title.
 * @param opts.spec - The file spec.
 * @param opts.author - Who drew it.
 * @param opts.conversationId - The conversation it opens beside.
 * @param opts.visibility - `system` inside a mission run.
 * @param opts.summary - The version's line.
 */
async function fileMockup(opts: { orgId: string; requestId: number; title: string; spec: Record<string, unknown>; author: Author; conversationId: number | null; visibility: 'user' | 'system'; summary: string }) {
  const { createArtifact, listArtifactsForRecords, updateArtifact } = await import('@/services/ArtifactService');
  const existing = (await listArtifactsForRecords({ orgId: opts.orgId, recordType: 'object', recordIds: [String(opts.requestId)] }))
    .find(a => a.recordRole === MOCKUP_ROLE && a.title === opts.title && a.kind === 'file');
  if (existing) {
    return (await updateArtifact({ orgId: opts.orgId, id: existing.id, spec: opts.spec, author: opts.author, changeSummary: opts.summary, noCollapse: true })).artifact;
  }
  return (await createArtifact({
    orgId: opts.orgId,
    conversationId: opts.conversationId,
    kind: 'file',
    title: opts.title,
    spec: opts.spec,
    url: null,
    record: { type: 'object', id: String(opts.requestId), role: MOCKUP_ROLE },
    author: opts.author,
    changeSummary: opts.summary,
    visibility: opts.visibility,
  })).artifact;
}

/**
 * Draw every state and file each as a PNG on the request. Refuses the whole
 * call when any state is not plain UI, so a request never carries half a set.
 * A screenshot is opened only when a state draws `changes` over it.
 * @param opts - What to draw and where it is filed.
 * @param opts.orgId - The workspace.
 * @param opts.requestId - The request.
 * @param opts.requestTitle - For the artifact titles.
 * @param opts.requestMeta - Its metadata, for the product's look.
 * @param opts.states - The states, in the order they are read.
 * @param opts.viewport - desktop / mobile.
 * @param opts.baseId - A capture the caller named.
 * @param opts.author - Who the versions are recorded as.
 * @param opts.conversationId - The conversation they open beside.
 * @param opts.visibility - `system` inside a mission run.
 * @param opts.provenance - The run or conversation it was drawn in.
 * @param opts.provenance.agentSlug - The agent that drew it.
 * @param opts.provenance.missionRunId - The run it was drawn in.
 * @param opts.provenance.conversationId - The conversation it was drawn in.
 */
export async function drawMockups(opts: {
  orgId: string;
  requestId: number;
  requestTitle: string;
  requestMeta: Record<string, unknown>;
  states: MockupState[];
  viewport?: string | null;
  baseId?: number | null;
  author: Author;
  conversationId?: number | null;
  visibility?: 'user' | 'system';
  /** Where it was drawn — the run or conversation — so the carousel can say so and link to it. */
  provenance?: { agentSlug?: string | null; missionRunId?: number | null; conversationId?: number | null };
}): Promise<{ ok: true; base: ScreenSurvey['base'] | null; drawn: DrawnState[]; artifacts: unknown[]; captureIds: Set<number>; lookFrom: string } | MockupFailure> {
  const viewport: 'desktop' | 'mobile' = opts.viewport?.trim().toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
  const shots = await shotsForRequest(opts.orgId, opts.requestId);
  const captureIds = new Set(shots.filter(a => a.recordRole !== null && CAPTURE_ROLES.has(a.recordRole)).map(a => a.id));
  const overScreen = opts.states.some(s => (s.changes?.length ?? 0) > 0);
  let base: { pick: Extract<BasePick, { ok: true }>; img: { dataUri: string; width: number; height: number } } | null = null;
  if (overScreen) {
    const pick = pickBase(shots, opts);
    if (!pick.ok) {
      return { ok: false, cause: 'content', reason: `Nothing was drawn: ${pick.reason} Draw each state as the product's UI blocks in \`html\` instead of \`changes\`.` };
    }
    const img = await openBase(opts.orgId, pick.url);
    if ('ok' in img) {
      return { ok: false, cause: 'content', reason: `Nothing was drawn: ${img.reason}. Draw each state as UI blocks in \`html\` instead.` };
    }
    base = { pick, img };
  }
  const problems = mockupProblems(opts.states, base ? { width: base.img.width, height: base.img.height } : null);
  if (problems.length > 0) {
    return { ok: false, cause: 'content', reason: `Nothing was drawn:\n${problems.map(p => `- ${p}`).join('\n')}` };
  }
  const { renderAvailable, renderScreen } = await import('@/libs/documents/render');
  const ready = await renderAvailable();
  if (!ready.ok) {
    return { ok: false, cause: 'infrastructure', reason: `the renderer is not available on this installation (${ready.reason}), so nothing was drawn` };
  }
  const { look, from } = await productLook(opts.orgId, opts.requestMeta);
  const { saveArtifact } = await import('@/libs/tools/artifacts/store');
  const drawn: DrawnState[] = [];
  const artifacts: unknown[] = [];
  for (const s of opts.states) {
    const html = s.changes && s.changes.length > 0 && base
      ? mockupHtml(base.img.dataUri, { width: base.img.width, height: base.img.height }, s.changes, look)
      : blocksHtml({ html: s.html ?? '', css: s.css }, look, viewport);
    // The render and the store are the installation's: a throw there is an
    // infrastructure failure, said as one, never a crashed turn.
    let shot: Awaited<ReturnType<typeof renderScreen>>;
    let file: Awaited<ReturnType<typeof saveArtifact>>;
    try {
      shot = await renderScreen(html);
      file = await saveArtifact({ orgId: opts.orgId, data: Buffer.from(shot.png), ext: 'png', contentType: 'image/png' });
    } catch (err) {
      return { ok: false, cause: 'infrastructure', reason: `the installation could not render or store the image (${(err as Error).message.split('\n')[0]}), so nothing was drawn` };
    }
    const title = mockupTitle(opts.requestTitle, s.state, opts.states.length);
    const artifact = await fileMockup({
      orgId: opts.orgId,
      requestId: opts.requestId,
      title,
      spec: {
        filename: file.filename,
        contentType: file.contentType,
        bytes: file.bytes,
        url: file.url,
        width: shot.width,
        height: shot.height,
        // THE LINE UNDER THE IMAGE, written now by whoever drew it: its own
        // caption, else the state's name. The carousel reads it; nothing
        // writes one later from the agent's words.
        caption: (s.caption?.trim() || s.state.trim()).slice(0, 140),
        // WHO DREW IT, WHERE, FROM WHAT — the carousel's source line.
        provenance: {
          by: opts.author.id ?? null,
          drawnFrom: base && s.changes?.length ? 'screen' : 'request',
          ...(base && s.changes?.length ? { baseArtifactId: base.pick.shot.id } : {}),
          missionRunId: opts.provenance?.missionRunId ?? null,
          conversationId: opts.provenance?.conversationId ?? opts.conversationId ?? null,
        },
        // What it was drawn from, so a redraw starts here and the next
        // mockup for this product is drawn in the same look.
        source: { state: s.state.trim(), look, ...(s.html ? { html: s.html, css: s.css ?? '' } : { changes: s.changes, baseArtifactId: base?.pick.shot.id ?? null }) },
      },
      author: opts.author,
      conversationId: opts.conversationId ?? null,
      visibility: opts.visibility ?? 'user',
      summary: base && s.changes?.length ? `Drawn on screenshot #${base.pick.shot.id}` : `Drawn as ${viewport} UI blocks`,
    });
    drawn.push({ state: s.state.trim(), artifactId: artifact.id, url: file.url, title });
    artifacts.push(artifact);
  }
  return {
    ok: true,
    base: base ? { artifactId: base.pick.shot.id, title: base.pick.shot.title, url: base.pick.url, viewport: base.pick.viewport, width: base.img.width, height: base.img.height, capturedAt: base.pick.shot.createdAt } : null,
    drawn,
    artifacts,
    captureIds,
    lookFrom: from,
  };
}
