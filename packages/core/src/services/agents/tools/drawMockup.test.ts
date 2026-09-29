/**
 * draw_mockup, end to end on a real database, a real artifact store and real
 * Chromium: the base is the request's newest real capture, the images land on
 * the request, the tool writes the ids itself as a new version the page is
 * told about, and the feature report then SHOWS the mockups instead of
 * "Preview pending". Request #224 (2026-09-29) had screenshots on its tasks
 * and a page that showed none of it. Fixtures are fictional.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// The survey's vision read: a scripted model, so the map is known.
const invoke = vi.fn();
vi.mock('@/libs/llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/llm')>();
  return { ...real, buildChatModelForOrg: async () => ({ invoke: (...a: unknown[]) => invoke(...a) }) };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { renderAvailable, closeRenderer } = await import('@/libs/documents/render');
const { saveArtifact } = await import('@/libs/tools/artifacts/store');
const { drawMockupTools } = await import('./drawMockup');
const { updateObjectTools } = await import('./updateObject');
const { loadFeatureReport } = await import('@/services/factory/featureReportData');
const { eq } = await import('drizzle-orm');

const ORG = 'org_draw_mockup';
const available = await renderAvailable();
let dir = '';
let requestId = 0;
let taskId = 0;

const VISUALS_SCHEMA = {
  type: 'object',
  properties: {
    surface: { type: 'string' },
    state: { type: 'string' },
    acceptance: { type: 'array' },
    visuals: {
      type: 'object',
      properties: {
        beforeArtifactIds: { type: 'array', items: { type: 'integer' } },
        mockupArtifactIds: { type: 'array', items: { type: 'integer' } },
        afterArtifactIds: { type: 'array', items: { type: 'integer' } },
        surfaceUrl: { type: 'string' },
        noVisualReason: { type: 'string' },
        drawnArtifactId: { type: 'integer' },
      },
    },
  },
};

function ctxFor(): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: ORG,
    userId: 'usr-northwind',
    agentSlug: 'designer',
    connectorSources: [],
    objectTypeSlugs: ['request', 'product'],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    pageContext: { record: { type: 'object', id: String(requestId), objectType: 'request' } },
    turnMessage: 'can you add mocks/images to this request?',
    emit: (e: AgentEvent) => events.push(e),
    events,
  } as unknown as RuntimeContext & { events: AgentEvent[] };
}

/** A plain grey 800×500 "screen" with a darker row, stored the way QA stores its captures. */
async function storeScreen(): Promise<string> {
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#f4f4f5' } })
    .composite([{ input: await sharp({ create: { width: 760, height: 56, channels: 3, background: '#e4e4e7' } }).png().toBuffer(), left: 20, top: 120 }])
    .png()
    .toBuffer();
  const saved = await saveArtifact({ orgId: ORG, data: png, ext: 'png', contentType: 'image/png' });
  return saved.url;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vocion-mockup-'));
  process.env.VOCION_ARTIFACTS_DIR = dir;
});

beforeEach(async () => {
  forgetCachedObjectTypes();
  invoke.mockReset();
  await db.delete(actionRunSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  const [reqType] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: VISUALS_SCHEMA } as never).returning({ id: businessObjectTypeSchema.id });
  const [taskType] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'engineering_task', label: 'Task', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
  const [req] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: reqType!.id, title: 'Northwind files: a copy-link button on each row', metadata: { surface: 'ui', state: 'in_scope', visuals: { surfaceUrl: 'https://app.example.test/files', noVisualReason: '' } } } as never).returning({ id: businessObjectSchema.id });
  requestId = req!.id;
  const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'nw-t1', metadata: { requestId } } as never).returning({ id: businessObjectSchema.id });
  taskId = task!.id;
});

afterAll(async () => {
  delete process.env.VOCION_ARTIFACTS_DIR;
  await rm(dir, { recursive: true, force: true });
  await closeRenderer();
});

async function captureOnTask(over: Record<string, unknown> = {}): Promise<number> {
  const url = await storeScreen();
  const [row] = await db.insert(artifactSchema).values({
    orgId: ORG,
    kind: 'link',
    title: 'Northwind files: a copy-link button on each row · desktop · before',
    recordType: 'object',
    recordId: String(taskId),
    recordRole: 'qa-screenshot',
    url,
    spec: { href: url, description: 'at /files' },
    ...over,
  } as never).returning({ id: artifactSchema.id });
  return row!.id;
}

function tool() {
  const ctx = ctxFor();
  const [t] = drawMockupTools(ctx);
  return { t: t!, ctx };
}

describe('draw_mockup is on the designer\'s belt', () => {
  it('is present for an agent that works with requests and absent otherwise', () => {
    expect(drawMockupTools(ctxFor()).map(t => t.name)).toEqual(['draw_mockup']);
    expect(drawMockupTools({ ...ctxFor(), objectTypeSlugs: ['product'] } as RuntimeContext)).toEqual([]);
  });
});

describe('no screenshot, no drawing', () => {
  it('refuses to draw from memory and writes nothing', async () => {
    const { t } = tool();
    const out = await t.invoke({ mockups: [{ state: 'Default', changes: [{ region: { x: 10, y: 10, width: 80, height: 30 }, html: '<button>Copy link</button>' }] }] });

    expect(out).toMatch(/No screenshot of this surface exists yet/);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});

describe('the survey: the real screen, and a map of it', () => {
  it('returns the newest capture as the BEFORE, its size and the map in its own pixels', async () => {
    const shotId = await captureOnTask();
    invoke.mockResolvedValue({ content: '{"style":"system-ui, #18181b text, 6px radius","elements":[{"what":"first file row","x":20,"y":120,"width":760,"height":56}]}' });
    const { t } = tool();
    const out = await t.invoke({});

    expect(out).toContain(`artifact #${shotId}`);
    expect(out).toContain('800×500px, desktop');
    expect(out).toContain('- first file row: x 20, y 120, 760×56');
    expect(out).toContain('Its style: system-ui');
    // The survey writes nothing: the record changes only when something is drawn.
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});

describe.skipIf(!available.ok)('drawing (real Chromium)', () => {
  it('draws each state on the screenshot, files them on the request, and writes the ids itself', async () => {
    const shotId = await captureOnTask();
    const { t, ctx } = tool();
    const out = await t.invoke({
      mockups: [
        { state: 'Default', changes: [{ region: { x: 680, y: 132, width: 90, height: 32 }, html: '<button class="c">Copy link</button>', css: '.c{width:100%;height:100%;border:1px solid #d4d4d8;border-radius:6px;background:#fff;font:13px system-ui}' }] },
        { state: 'Link copied', changes: [{ region: { x: 660, y: 132, width: 110, height: 32 }, html: '<span class="t">✓ Link copied</span>', css: '.t{display:flex;height:100%;align-items:center;justify-content:center;background:#18181b;color:#fff;border-radius:6px;font:13px system-ui}' }] },
      ],
    });

    expect(out).toMatch(/^Drew 2 images on the real screen \(screenshot #\d+\): #\d+ Default, #\d+ Link copied\. request #\d+ now shows them/);

    // The record: before is the real screenshot, the mockups are the drawn states.
    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));
    const visuals = (row!.metadata as { visuals: Record<string, unknown> }).visuals;
    const drawn = await db.select().from(artifactSchema).where(eq(artifactSchema.recordId, String(requestId)));
    const mockups = drawn.filter(a => a.recordRole?.startsWith('mockup:')).sort((a, b) => a.id - b.id);

    expect(visuals.beforeArtifactIds).toEqual([shotId]);
    expect(visuals.mockupArtifactIds).toEqual(mockups.map(m => m.id));
    expect(visuals.surfaceUrl).toBe('https://app.example.test/files');
    expect('noVisualReason' in visuals).toBe(false);
    expect(mockups.map(m => m.title)).toEqual(['Northwind files: a copy-link button on each row · Default', 'Northwind files: a copy-link button on each row · Link copied']);

    // Each image is the screenshot's own size, with the change in it and the
    // screen untouched outside it.
    const { readStoredArtifact } = await import('@/libs/tools/artifacts/ingest');
    const bytes = await readStoredArtifact(ORG, mockups[1]!.url!, dir);
    const meta = await sharp(bytes!).metadata();

    expect([meta.width, meta.height]).toEqual([800, 500]);

    const pixel = async (x: number, y: number) => {
      const { data } = await sharp(bytes!).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return Buffer.from(data).subarray(0, 3).toString('hex');
    };

    expect(await pixel(662, 134)).toBe('18181b');
    expect(await pixel(5, 5)).toBe('f4f4f5');

    // The page is told: the images open beside the conversation, and the
    // record's new version is announced so the feature page refetches.
    expect(ctx.events.filter(e => e.type === 'artifact')).toHaveLength(2);
    expect(ctx.events.find(e => e.type === 'version_written')).toMatchObject({ ref: { type: 'object', id: String(requestId) }, fields: ['visuals'] });

    // And the feature page SHOWS them: the mockups under Preview, the
    // screenshot under How it works today — not "Preview pending".
    const report = await loadFeatureReport(ORG, requestId, new Date('2026-09-29T17:00:00Z'));
    const preview = report!.sections.find(s => s.key === 'visuals')!;
    const today = report!.sections.find(s => s.key === 'today')!;

    expect(preview.evidence.map(e => [e.id, e.role, e.imageUrl !== null])).toEqual(mockups.map(m => [m.id, 'proposed', true]));
    expect(preview.absence ?? null).toBeNull();
    expect(today.evidence.map(e => e.id)).toEqual([shotId]);
  });

  it('refuses an annotated image whole, and draws nothing', async () => {
    await captureOnTask();
    const { t } = tool();
    const out = await t.invoke({
      mockups: [
        { state: 'Default', changes: [{ region: { x: 680, y: 132, width: 90, height: 32 }, html: '<button>Copy link</button>' }] },
        { state: 'Explained', changes: [{ region: { x: 400, y: 200, width: 300, height: 80 }, html: '<div class="callout">AFTER: the control sits beside the link</div>' }] },
      ],
    });

    expect(out).toMatch(/^Nothing was drawn:/);
    expect(out).toMatch(/not part of the product/);
    expect((await db.select().from(artifactSchema)).filter(a => a.recordRole?.startsWith('mockup:'))).toHaveLength(0);
  });
});

describe('update_object cannot hand-write the ids', () => {
  it('refuses a screenshot or mockup list typed by the model, and keeps the ids when it writes the URL', async () => {
    await db.update(businessObjectSchema).set({ metadata: { surface: 'ui', visuals: { beforeArtifactIds: [5], mockupArtifactIds: [6, 7], surfaceUrl: 'https://app.example.test/files' } } } as never).where(eq(businessObjectSchema.id, requestId));
    const [update] = updateObjectTools(ctxFor());

    const typed = await update!.invoke({ object_type: 'request', id: requestId, set: { visuals: { beforeArtifactIds: [6, 7] } }, reason: 'attach', confidence: 0.9 });

    expect(typed).toMatch(/written by draw_mockup, never by hand/);

    const url = await update!.invoke({ object_type: 'request', id: requestId, set: { visuals: { surfaceUrl: 'https://app.example.test/files?view=grid' } }, reason: 'the live page', confidence: 0.9 });

    expect(url).toMatch(/updated — visuals written/);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));

    expect((row!.metadata as { visuals: unknown }).visuals).toMatchObject({ beforeArtifactIds: [5], mockupArtifactIds: [6, 7], surfaceUrl: 'https://app.example.test/files?view=grid' });
  });
});
