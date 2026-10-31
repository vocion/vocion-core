import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import messages from '@/locales/en.json';
// The dotted underline is CSS: the real stylesheet, not the class names.
import '@/styles/global.css';

/**
 * A record named in an answer's prose (FU-504, ACT-97) opens in the preview
 * pane on a plain click, never in a new tab, and is still a real link to its
 * page for ⌘-click, middle click and Copy link (Chris, 2026-10-23: a click on
 * FU-504 opened a new browser tab). Ordinary web links stay web links.
 * Fixtures are fictional.
 */

const openPreview = vi.fn();
// Register this file's real implementation explicitly: a shared browser
// transform can still reference the mock registry after another file mocked it.
vi.mock('@/libs/I18nNavigation', async importOriginal => importOriginal());

vi.mock('@/features/preview/previewState', async importOriginal => ({ ...await importOriginal<object>(), openPreview: (...a: unknown[]) => openPreview(...a) }));

const { AgentMessage } = await import('./AgentMessage');

const TEXT = 'Two touches wait on you: [FU-504](/w/northwind/dashboard/objects/504) and [FE-214](/w/northwind/dashboard/p/feature/214). The brief is on [the Kestrel site](https://kestrel.example/brief).';

async function draw() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentMessage agentName="Revenue" message={{ role: 'assistant', content: TEXT, runs: [{ type: 'text', text: TEXT }] }} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => openPreview.mockReset());

describe('a record named in an answer', () => {
  it('is a real link to its page, read as a reference, and never opens a new tab', async () => {
    const view = await draw();
    const refs = [...view.container.querySelectorAll<HTMLAnchorElement>('[data-testid="inline-record-ref"]')];

    expect(refs.map(a => a.textContent)).toEqual(['FU-504', 'FE-214']);
    expect(refs[0]!.getAttribute('href')).toContain('/w/northwind/dashboard/objects/504');
    expect(refs.every(a => a.getAttribute('target') === null)).toBe(true);
    expect(getComputedStyle(refs[0]!).textDecorationStyle).toBe('dotted');
  });

  it('opens in the preview pane on a plain click', async () => {
    const view = await draw();
    const ref = view.container.querySelector<HTMLAnchorElement>('[data-testid="inline-record-ref"]')!;

    ref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(openPreview).toHaveBeenCalledWith({ type: 'object', id: '504' }, ref);
  });

  it('leaves a ⌘-click or Ctrl-click to the browser', async () => {
    const view = await draw();
    const ref = view.container.querySelector<HTMLAnchorElement>('[data-testid="inline-record-ref"]')!;
    // Keep the test page where it is: the browser's own handling is what is being left alone.
    ref.addEventListener('click', e => e.preventDefault());

    ref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    ref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));

    expect(openPreview).not.toHaveBeenCalled();
  });

  it('keeps an ordinary web link a web link, in a new tab', async () => {
    const view = await draw();
    const web = [...view.container.querySelectorAll<HTMLAnchorElement>('a')].find(a => a.textContent === 'the Kestrel site')!;

    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.dataset.testid).toBeUndefined();
  });
});
