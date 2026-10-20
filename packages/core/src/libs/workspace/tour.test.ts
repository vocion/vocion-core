import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { readWorkspaceTours, readWorkspaceToursFor } = await import('./tour');

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-tours-'));

/**
 * A workspace folder whose pages/ holds the given tours.
 * @param name - Folder name.
 * @param tours - File name → tour object.
 */
function workspace(name: string, tours: Record<string, unknown>): string {
  const dir = join(ROOT, name);
  mkdirSync(join(dir, 'pages', 'tours'), { recursive: true });
  for (const [file, tour] of Object.entries(tours)) {
    writeFileSync(join(dir, 'pages', 'tours', file), JSON.stringify(tour));
  }
  return dir;
}

const step = (title: string, extra: Record<string, unknown> = {}) => ({ route: '/dashboard', title, body: `${title} body`, ...extra });

const FINANCE = workspace('finance', {
  'close.yaml': { title: 'The close', order: 2, steps: [step('Close', { selector: 'tr', selectorText: 'CLOSE-515', dwellMs: 4000, eyebrow: 'Step 1', presentation: 'caption' })] },
  'report.yaml': { slug: 'monthly-report', title: 'The report', order: 1, mask: 'none', steps: [step('Report', { advance: 'appear', waitFor: '[data-message]', waitForText: 'gross margin' })] },
  'broken.yaml': { title: 'No steps', steps: [] },
});
const REVENUE = workspace('revenue', { 'pipeline.yaml': { title: 'Pipeline', steps: [step('Pipeline')] } });

const ORIGINAL_PATH = process.env.WORKSPACE_PATH;
const ORIGINAL_MAP = process.env.VOCION_WORKSPACE_MAP;

/**
 * Put one env var back the way the test process found it.
 * @param name - The variable.
 * @param original - Its value before the test.
 */
function restore(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

afterEach(() => {
  restore('WORKSPACE_PATH', ORIGINAL_PATH);
  restore('VOCION_WORKSPACE_MAP', ORIGINAL_MAP);
});

afterAll(async () => {
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  rmSync(ROOT, { recursive: true, force: true });
});

describe('workspace tours', () => {
  it('reads every valid tour in pages/tours, in launcher order, slug from the file name or its own', () => {
    const tours = readWorkspaceTours(join(FINANCE, 'pages'));

    expect(tours.map(t => t.slug)).toEqual(['monthly-report', 'close']);
    expect(tours[1]!.steps[0]).toMatchObject({ selectorText: 'CLOSE-515', dwellMs: 4000, eyebrow: 'Step 1' });
    expect(tours[0]!.steps[0]).toMatchObject({ advance: 'appear', waitForText: 'gross margin' });
  });

  it('reads the org\'s own folder on a multi-workspace box, not the shared WORKSPACE_PATH', async () => {
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);
    await db.insert(tenantAccountSchema).values({ id: 'acct-n', name: 'Northwind', slug: 'northwind' });
    await db.insert(projectSchema).values({ id: 'proj-finance', accountId: 'acct-n', slug: 'finance-team', name: 'Finance Team' });
    process.env.WORKSPACE_PATH = REVENUE;
    process.env.VOCION_WORKSPACE_MAP = `revenue:${REVENUE},finance-team:${FINANCE}`;

    const tours = await readWorkspaceToursFor('proj-finance');

    expect(tours.map(t => t.slug)).toEqual(['monthly-report', 'close']);
  });

  it('shows no tours for a project the map does not name', async () => {
    await db.delete(projectSchema);
    await db.delete(tenantAccountSchema);
    await db.insert(tenantAccountSchema).values({ id: 'acct-n', name: 'Northwind', slug: 'northwind' });
    await db.insert(projectSchema).values({ id: 'proj-ops', accountId: 'acct-n', slug: 'ops-team', name: 'Ops Team' });
    process.env.WORKSPACE_PATH = REVENUE;
    process.env.VOCION_WORKSPACE_MAP = `revenue:${REVENUE}`;

    await expect(readWorkspaceToursFor('proj-ops')).resolves.toEqual([]);
  });
});
