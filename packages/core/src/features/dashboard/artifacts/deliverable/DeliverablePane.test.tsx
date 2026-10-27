import type { DeliverablePaneProps } from './DeliverablePane';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { planEdit } from './ops';
import { deliverablePages } from './pages';
import { freshSlideId, replaceElementText, withSectionId } from './textEdit';

/**
 * The deliverable pane, in a real browser: pages down the side, the page
 * large and live in its sandboxed frame, text edited in place inside it, and
 * every commit one engine operation through `artifacts.update`.
 */

const update = vi.fn();
const restore = vi.fn();
vi.mock('@/libs/Orpc', () => ({ client: { artifacts: { update: (...a: unknown[]) => update(...a), restore: (...a: unknown[]) => restore(...a), get: vi.fn() } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/artifacts/41',
}));

const { DeliverablePane } = await import('./DeliverablePane');
const en = (await import('@/locales/en.json')).default;

const slide = (id: string, body: string, notes = 'From the Kestrel Capital kickoff.') =>
  `<section id="${id}" style="padding:120px;font-family:Arial;color:#111">${body}${notes ? `<aside>${notes}</aside>` : ''}</section>`;

function deckSpec() {
  return {
    format: 'vocion-deck/1',
    title: 'Kestrel Capital — concept',
    order: ['cover', 'plan', 'team'],
    slides: {
      cover: slide('cover', '<h1 style="font-size:96px">One record</h1>'),
      plan: slide('plan', '<h2 style="font-size:64px">The plan</h2><p style="font-size:40px">Three phases.</p><p style="font-size:40px">Starts <b>Monday</b>.</p>'),
      team: slide('team', '<h2 style="font-size:64px">The team</h2>', ''),
    },
    verification: {
      at: '2026-10-20T10:00:00.000Z',
      ok: true,
      pdfPages: 3,
      issues: [],
      reports: [],
      slides: [
        { id: 'cover', n: 1, label: 'One record', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 2, unknownElements: [], unresolvedAssets: [], placeholders: [], hasNotes: true, image: '/api/artifacts/41/cover.png' },
        { id: 'plan', n: 2, label: 'The plan', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 4, unknownElements: [], unresolvedAssets: [], placeholders: ['[$__]'], hasNotes: true },
        { id: 'team', n: 3, label: 'The team', overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 2, unknownElements: [], unresolvedAssets: [], placeholders: [], hasNotes: false },
      ],
    },
  };
}

const SHEET = (body: string) => `<article class="sheet" style="width:816px;min-height:1056px;margin:0 auto;background:#fff;padding:48px"><div class="body">${body}</div></article>`;
function documentSpec() {
  return {
    title: 'Northwind — scope',
    html: `<!doctype html><html><head><title>Northwind — scope</title></head><body>${SHEET('<h1>Northwind starts here.</h1>')}\n\n${SHEET('<h2>Plan</h2><p>Three phases.</p>')}</body></html>`,
    sheets: 2,
  };
}

function renderPane(over: Partial<DeliverablePaneProps> = {}) {
  const props: DeliverablePaneProps = { artifactId: 41, kind: 'deck', title: 'Kestrel Capital — concept', spec: deckSpec(), version: 4, ...over };
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ width: 1100, height: 800, display: 'flex' }}>
        <DeliverablePane {...props} />
      </div>
    </NextIntlClientProvider>,
  );
}

function updated(spec: Record<string, unknown>, version = 5) {
  return { artifact: { id: 41, kind: 'deck', title: 'Kestrel Capital — concept', version, spec }, version: { version }, collapsed: false };
}

beforeEach(() => {
  update.mockReset();
  restore.mockReset();
  update.mockImplementation(async () => updated(deckSpec()));
});

describe('the deliverable pane', () => {
  it('lists every page, from its screenshot when there is one and live when there is not', async () => {
    renderPane();

    await expect.element(page.getByRole('button', { name: 'Slide 1: One record' })).toBeVisible();

    const thumbs = document.querySelectorAll('[data-page-thumb]');

    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]!.querySelector('img')?.getAttribute('src')).toBe('/api/artifacts/41/cover.png');
    // No screenshot: a live render of the slide (its frame mounts once the box has a size).
    expect(thumbs[1]!.querySelector('[data-page-frame]')).not.toBeNull();
    expect(thumbs[1]!.querySelector('img')).toBeNull();
    // The first slide is selected, large and live.
    await expect.element(page.getByText('Slide 1 of 3 · One record')).toBeVisible();
    expect(document.querySelector('[data-deck-iframe]')).not.toBeNull();
  });

  it('selects with a click or the arrow keys, and shows that slide\'s notes and what the receipt found on it', async () => {
    renderPane();
    await page.getByRole('button', { name: 'Slide 2: The plan' }).click();

    await expect.element(page.getByText('Slide 2 of 3 · The plan')).toBeVisible();
    await expect.element(page.getByLabelText('Speaker notes')).toHaveValue('From the Kestrel Capital kickoff.');
    await expect.element(page.getByText('Placeholder still in: [$__]')).toBeVisible();

    await userEvent.keyboard('{ArrowDown}');

    await expect.element(page.getByText('Slide 3 of 3 · The team')).toBeVisible();
    await expect.element(page.getByText('No speaker notes yet.')).toBeVisible();
  });

  it('edits a line of text in place and writes it as one replace_slide, keeping the markup around it', async () => {
    renderPane();
    await page.getByRole('button', { name: 'Slide 2: The plan' }).click();
    const frame = page.frameLocator(page.getByTitle('Slide 2: The plan'));
    const line = frame.getByText('Three phases.');
    await line.click();
    await line.fill('Two phases, twelve weeks.');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const call = update.mock.calls[0]![0] as { id: number; ops: Array<{ op: string; id: string; html: string }>; changeSummary: string; ifVersion: number };

    expect(call).toMatchObject({ id: 41, changeSummary: 'Edited text on slide 2', ifVersion: 4 });
    expect(call.ops).toHaveLength(1);
    expect(call.ops[0]).toMatchObject({ op: 'replace_slide', id: 'plan' });
    expect(call.ops[0]!.html).toContain('<p style="font-size:40px">Two phases, twelve weeks.</p>');
    expect(call.ops[0]!.html).toContain('Starts <b>Monday</b>.');
    expect(call.ops[0]!.html).toContain('<aside>From the Kestrel Capital kickoff.</aside>');
  });

  it('writes the notes when the person leaves the box', async () => {
    renderPane();
    await page.getByRole('button', { name: 'Slide 2: The plan' }).click();
    await page.getByLabelText('Speaker notes').fill('Say the price last.');
    await page.getByRole('button', { name: 'Slide 1: One record' }).click();

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    expect(update.mock.calls[0]![0]).toMatchObject({ ops: [{ op: 'set_notes', id: 'plan', notes: 'Say the price last.' }], changeSummary: 'Edited the notes on slide 2' });
  });

  it('adds a slide as a copy of the selected one, and deletes one', async () => {
    renderPane();
    await page.getByRole('button', { name: 'Slide 2: The plan' }).click();
    await page.getByRole('button', { name: 'Add slide' }).click();

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const insert = update.mock.calls[0]![0] as { ops: Array<{ op: string; after: string; html: string }>; changeSummary: string };

    expect(insert.ops[0]).toMatchObject({ op: 'insert_slide', after: 'plan' });
    expect(insert.ops[0]!.html).toMatch(/^<section id="plan-copy"/);
    expect(insert.changeSummary).toBe('Added slide 3, a copy of slide 2');

    await page.getByRole('button', { name: 'Slide 1: One record' }).click();
    await page.getByRole('button', { name: 'Delete slide' }).click();

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));

    expect(update.mock.calls[1]![0]).toMatchObject({ ops: [{ op: 'remove_slide', id: 'cover' }], changeSummary: 'Removed slide 1' });
  });

  it('moves a slide with Alt and an arrow key — the keyboard way to drag', async () => {
    renderPane();
    await page.getByRole('button', { name: 'Slide 3: The team' }).click();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    expect(update.mock.calls[0]![0]).toMatchObject({ ops: [{ op: 'move_slide', id: 'team', to: 2 }], changeSummary: 'Moved slide 3 to position 2' });
  });

  it('shows an older version read-only: nothing to add, delete or type into', async () => {
    renderPane({ readOnly: true });

    await expect.element(page.getByText('Slide 1 of 3 · One record')).toBeVisible();

    expect(document.querySelector('[data-deliverable-add]')).toBeNull();
    expect(document.querySelector('[data-deliverable-remove]')).toBeNull();
    expect(document.querySelector('[data-page-key]')?.getAttribute('draggable')).toBe('false');
  });

  it('is the same pane for a document: sheets, and a text edit is one replace_sheet', async () => {
    update.mockImplementation(async () => ({ ...updated(documentSpec()), artifact: { id: 41, kind: 'document', title: 'Northwind — scope', version: 5, spec: documentSpec() } }));
    renderPane({ kind: 'document', title: 'Northwind — scope', spec: documentSpec() });
    await page.getByRole('button', { name: 'Sheet 2: Plan' }).click();
    const frame = page.frameLocator(page.getByTitle('Sheet 2: Plan'));
    const line = frame.getByText('Three phases.');
    await line.click();
    await line.fill('Two phases.');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    expect(update.mock.calls[0]![0]).toMatchObject({ ops: [{ op: 'replace_sheet', n: 2 }], changeSummary: 'Edited text on sheet 2' });
    expect((update.mock.calls[0]![0] as { ops: Array<{ html: string }> }).ops[0]!.html).toContain('<p>Two phases.</p>');
    expect(document.querySelector('[data-document-iframe]')).not.toBeNull();
    expect(document.querySelector('[data-deliverable-notes]')).toBeNull();
  });

  it('presents full screen: arrows move, the counter follows, Escape leaves', async () => {
    const closed = vi.fn();
    renderPane({ presenting: true, onPresentingChange: closed });

    await expect.element(page.getByRole('dialog', { name: 'Presenting Kestrel Capital — concept' })).toBeVisible();
    await expect.element(page.getByText('1 / 3')).toBeVisible();

    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');

    await expect.element(page.getByText('3 / 3')).toBeVisible();

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(false));
  });

  it('stays full screen while the slides move', async () => {
    const request = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined);
    const exit = vi.spyOn(document, 'exitFullscreen').mockResolvedValue(undefined);
    const fullscreen = vi.spyOn(document, 'fullscreenElement', 'get').mockImplementation(() => document.querySelector('[data-present-mode]'));
    try {
      renderPane({ presenting: true, onPresentingChange: vi.fn() });

      await expect.element(page.getByText('1 / 3')).toBeVisible();

      await userEvent.keyboard('{ArrowRight}');

      await expect.element(page.getByText('2 / 3')).toBeVisible();

      await page.getByRole('button', { name: 'Next slide' }).click();

      await expect.element(page.getByText('3 / 3')).toBeVisible();

      expect(request).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
      exit.mockRestore();
      fullscreen.mockRestore();
    }
  });
});

describe('text edits on the stored page', () => {
  const html = slide('plan', '<h2>The plan</h2><p>Three <i>phases</i>.</p><p>Starts Monday.</p>');

  it('replaces one element\'s text and nothing else', () => {
    // section > h2(0) p(1) i(2) p(3) aside(4)
    expect(replaceElementText(html, 3, 'Starts Monday.', 'Starts Tuesday & ends Friday.')).toBe(slide('plan', '<h2>The plan</h2><p>Three <i>phases</i>.</p><p>Starts Tuesday &amp; ends Friday.</p>'));
  });

  it('refuses an element that holds more than text, or no longer reads what the frame saw', () => {
    expect(replaceElementText(html, 1, 'Three phases.', 'x')).toBeNull();
    expect(replaceElementText(html, 3, 'Starts Sunday.', 'x')).toBeNull();
    expect(replaceElementText(html, 99, '', 'x')).toBeNull();
  });

  it('copies a slide under a fresh id', () => {
    expect(freshSlideId('plan', ['plan', 'plan-copy'])).toBe('plan-copy-2');
    expect(withSectionId(html, 'plan-copy')).toMatch(/^<section id="plan-copy" style="padding:120px/);
  });

  it('plans a document\'s duplicate as insert_sheet and selects the copy', () => {
    const pages = deliverablePages('document', documentSpec());
    const plan = planEdit('document', pages, { type: 'duplicate', key: '1' });

    expect(plan).toMatchObject({ ops: [{ op: 'insert_sheet', after: 1 }], select: '2', summary: 'Added sheet 2, a copy of sheet 1' });
    expect(planEdit('document', pages, { type: 'notes', key: '1', notes: 'x' })).toBeNull();
  });
});
