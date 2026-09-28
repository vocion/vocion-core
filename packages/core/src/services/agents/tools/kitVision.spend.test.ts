/**
 * Every kit-vision call is charged to the workspace's spend ledger.
 *
 * `vision_compare_reference` calls the Anthropic SDK directly, so nothing
 * charged it: up to ten vision calls per photo were invisible to budgets and
 * to the spend report. This drives the zoom pass, the part that makes most
 * of those calls, with a fake vision client that reports usage like the real
 * SDK; the DB is the PGlite test mock and crop storage is mocked.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { RuntimeContext } from '../types';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/aws/s3', async (importOriginal: () => Promise<typeof import('@/libs/aws/s3')>) => ({ ...(await importOriginal()), putObject: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentBudgetSchema } = await import('@/models/Schema');
const { featureScopeSlug, getBudget, orgUsageTotals } = await import('@/services/BudgetService');
const { zoomAndCount } = await import('./kitVision');

const ORG = 'org_vision_spend';
const AGENT = 'kit-inspector';

/**
 * Stand-in for `messages.create`: a count of 4, at usage that prices to a round number.
 * 1M uncached input + 1M cache-read input + 1M output on claude-sonnet-4-6 is
 * 300 + 30 + 1500 = 1830 cents.
 */
async function fakeVisionCall() {
  return {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0, output_tokens: 1_000_000 },
    content: [{ type: 'text', text: JSON.stringify({ count: 4, confidence: 0.9 }) }],
  };
}

const client = { messages: { create: vi.fn(fakeVisionCall) } } as unknown as Anthropic;

function ctx(): RuntimeContext {
  return { orgId: ORG, userId: 'u', agentSlug: AGENT, connectorSources: [], objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

async function photo(): Promise<Uint8Array> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } }).jpeg().toBuffer();
}

beforeEach(async () => {
  await db.delete(agentBudgetSchema);
});

afterEach(async () => {
  await db.delete(agentBudgetSchema);
});

describe('charging kit-vision calls', () => {
  it('charges each zoomed re-count to the agent, the tool.vision surface and the workspace, cached input included', async () => {
    const findings = [
      { region: 'box A QTY=4', issue: 'unreadable' as const, severity: 'minor' as const, box: [0.1, 0.1, 0.2, 0.2] },
      { region: 'box B QTY=4', issue: 'unreadable' as const, severity: 'minor' as const, box: [0.5, 0.5, 0.2, 0.2] },
    ];

    await zoomAndCount({ ctx: ctx(), client, bucket: 'b', key: 'kits/k1.jpg', bytes: await photo(), findings });

    const agent = await getBudget({ orgId: ORG, agentSlug: AGENT });
    const surface = await getBudget({ orgId: ORG, agentSlug: featureScopeSlug('tool.vision') });
    const totals = await orgUsageTotals({ orgId: ORG });

    // Two calls at 1830 cents each.
    expect(agent?.currentCents).toBe(3660);
    expect(surface?.currentCents).toBe(3660);
    expect(totals.spentCents).toBe(3660);
  });
});
