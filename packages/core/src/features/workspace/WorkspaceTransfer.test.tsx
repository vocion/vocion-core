/**
 * Export and import on the Context page. What it has to get right: the
 * export is a download of the workspace, the import shows the diff before
 * anything is written — by name, retirements included — applies exactly the
 * reviewed sha, asks for a new review when the mode changes, and puts a
 * refusal's reason where the person is looking.
 */
import type { ImportPreview } from '@/services/workspace/WorkspaceImportService';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import { WorkspaceTransfer } from './WorkspaceTransfer';

const fetchMock = vi.fn<typeof fetch>();

function preview(over: Partial<ImportPreview> = {}): ImportPreview {
  const counts = Object.fromEntries(['agents', 'skills', 'objectTypes', 'workflows', 'missions', 'automations', 'notifications', 'playbooks', 'learningSteps', 'evalDatasets', 'sources', 'teams', 'wikiPages'].map(k => [k, { created: 0, updated: 0, unchanged: 0 }])) as ImportPreview['counts'];
  counts.agents = { created: 1, updated: 1, unchanged: 3, retired: 1 };
  return {
    sha: 'local-0123456789ab',
    replace: false,
    fileCount: 4,
    counts,
    changes: [
      { resource: 'agents', slug: 'changelog-keeper', outcome: 'created' },
      { resource: 'agents', slug: 'docs-writer', outcome: 'updated' },
      { resource: 'agents', slug: 'release-scribe', outcome: 'retired' },
    ],
    unchanged: 3,
    errors: [],
    warnings: [],
    blockedBy: null,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Pick a zip in the hidden file input, as the "Choose a zip" button would. */
async function pickZip(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept]')!;
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array([80, 75, 3, 4])], 'cobalt-workspace.zip', { type: 'application/zip' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkspaceTransfer />
    </NextIntlClientProvider>,
  );
}

async function sent(call: number): Promise<Record<string, string>> {
  const body = fetchMock.mock.calls[call]![1]!.body as FormData;
  return Object.fromEntries([...body.entries()].filter(([k]) => k !== 'file').map(([k, v]) => [k, String(v)]));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkspaceTransfer', () => {
  it('offers the export as a download of the workspace zip', async () => {
    mount();

    await expect.element(page.getByRole('link', { name: 'Export' })).toHaveAttribute('href', '/api/v1/workspace/export');
  });

  it('reviews before anything is written, naming what each kind gains, changes and loses, then applies the reviewed sha', async () => {
    fetchMock.mockResolvedValueOnce(json(preview()));
    fetchMock.mockResolvedValueOnce(json({ sha: 'local-0123456789ab', versionId: 9, counts: preview().counts, changes: preview().changes, errors: [], warnings: [] }));
    mount();

    await page.getByRole('button', { name: 'Import' }).click();
    await pickZip();
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect.element(page.getByText('1 new · 1 updated · 1 retired')).toBeVisible();
    await expect.element(page.getByText('changelog-keeper')).toBeVisible();
    await expect.element(page.getByText('release-scribe')).toBeVisible();
    expect(await sent(0)).toEqual({ replace: 'false' });

    await page.getByRole('button', { name: 'Apply 3 changes' }).click();

    await expect.element(page.getByText('Imported: 3 changes applied.')).toBeVisible();
    expect(await sent(1)).toEqual({ replace: 'false', apply: 'true', sha: 'local-0123456789ab' });
  });

  it('asks for a new review when replace is ticked after one', async () => {
    fetchMock.mockResolvedValueOnce(json(preview()));
    mount();

    await page.getByRole('button', { name: 'Import' }).click();
    await pickZip();
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect.element(page.getByRole('button', { name: 'Apply 3 changes' })).toBeVisible();

    await page.getByLabelText('Replace everything').click();

    await expect.element(page.getByRole('button', { name: 'Review changes' })).toBeVisible();
    await expect.element(page.getByText(/becomes the whole workspace/)).toBeVisible();
  });

  it('says why a workspace cannot take the import, and offers no apply', async () => {
    fetchMock.mockResolvedValueOnce(json(preview({ blockedBy: 'This workspace is applied from git (last by deploy-bot).' })));
    mount();

    await page.getByRole('button', { name: 'Import' }).click();
    await pickZip();
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect.element(page.getByText(/applied from git/)).toBeVisible();
    expect(page.getByRole('button', { name: /Apply/ }).elements()).toHaveLength(0);
  });

  it('puts the server\'s reason where the person is looking when the upload is refused', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'VALIDATION_FAILED', message: 'The upload has no workspace.yaml, so it is not a workspace.' } }, 400));
    mount();

    await page.getByRole('button', { name: 'Import' }).click();
    await pickZip();
    await page.getByRole('button', { name: 'Review changes' }).click();

    await expect.element(page.getByText(/has no workspace.yaml/)).toBeVisible();
  });
});
