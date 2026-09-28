/**
 * The zoom pass decodes the photo once and re-counts at most
 * `ZOOM_CONCURRENCY` regions at a time (vocion-core#280).
 *
 * It used to decode the full 4K photo again for every crop and make each
 * vision call only after the last one returned. The vision client is a fake
 * that answers from the region label in the prompt, so no model is called;
 * crop storage is mocked; the photo is a real image made with sharp.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { RuntimeContext } from '../types';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/aws/s3', async (importOriginal: () => Promise<typeof import('@/libs/aws/s3')>) => ({ ...(await importOriginal()), putObject: vi.fn() }));

const { zoomAndCount } = await import('./kitVision');

type TestFinding = Parameters<typeof zoomAndCount>[0]['findings'][number];

let inFlight = 0;
let mostInFlight = 0;

/**
 * Stand-in for `messages.create`: counts 3 in a region labelled "short" and
 * 4 everywhere else, after a short wait so overlapping calls overlap.
 * @param request - The zoom request.
 * @param request.messages - Its messages; the first text block names the region.
 */
async function fakeVisionCount(request: { messages: Array<{ content: Array<{ type: string; text?: string }> }> }) {
  inFlight += 1;
  mostInFlight = Math.max(mostInFlight, inFlight);
  await new Promise(resolve => setTimeout(resolve, 10));
  inFlight -= 1;
  const prompt = request.messages[0]!.content.find(block => block.type === 'text')?.text ?? '';
  const count = prompt.includes('short') ? 3 : 4;
  return { content: [{ type: 'text', text: JSON.stringify({ count, confidence: 0.9 }) }] };
}

const createMock = vi.fn(fakeVisionCount);
const client = { messages: { create: createMock } } as unknown as Anthropic;

function ctx(): RuntimeContext {
  return { orgId: 'org_zoom', userId: 'u', agentSlug: 'kit-inspector', connectorSources: [], objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

/**
 * An uncounted fastener box at a distinct place on the sheet.
 * @param label - The region label as printed.
 * @param n - Its position, so each box sits somewhere else.
 */
function box(label: string, n: number): TestFinding {
  return { region: label, issue: 'unreadable', severity: 'minor', confidence: 0.4, box: [0.05 + (n % 4) * 0.22, 0.1 + Math.floor(n / 4) * 0.4, 0.15, 0.3] };
}

async function photo(): Promise<Uint8Array> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } }).jpeg().toBuffer();
}

beforeEach(() => {
  inFlight = 0;
  mostInFlight = 0;
  createMock.mockClear();
});

describe('zoomAndCount', () => {
  it('re-counts every selected box, never more than four at once', async () => {
    const findings = Array.from({ length: 8 }, (_, n) => box(`box ${n} QTY=4`, n));

    const zoom = await zoomAndCount({ ctx: ctx(), client, bucket: 'b', key: 'kits/k1.jpg', bytes: await photo(), findings });

    expect(createMock).toHaveBeenCalledTimes(8);
    expect(mostInFlight).toBeGreaterThan(1);
    expect(mostInFlight).toBeLessThanOrEqual(4);
    expect(zoom.corrected).toBe(8);
  });

  it('puts each count back on the box it was made for', async () => {
    const findings = [box('box 0 QTY=4', 0), box('box 1 short QTY=4', 1), box('box 2 QTY=4', 2), box('box 3 QTY=4', 3), box('box 4 short QTY=4', 4)];

    const zoom = await zoomAndCount({ ctx: ctx(), client, bucket: 'b', key: 'kits/k1.jpg', bytes: await photo(), findings });

    expect(zoom.findings.map(f => f.issue)).toEqual(['ok', 'count', 'ok', 'ok', 'count']);
    expect(zoom.findings[1]!.observed).toContain('3 counted');
    expect(zoom.corrected).toBe(3);
  });
});
