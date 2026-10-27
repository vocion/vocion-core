import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/artifacts/41/window',
}));

const { DeckWindow } = await import('./DeckWindow');

/**
 * A deck in its own window, in a real browser: present mode's slide view with
 * no app chrome, arrows and clicks moving it, the slide kept in the URL, and
 * full screen only when the person asks for it.
 */

const en = (await import('@/locales/en.json')).default;

const slide = (id: string, body: string) => `<section id="${id}" style="padding:120px;font-family:Arial;color:#111">${body}</section>`;
const spec = {
  format: 'vocion-deck/1',
  title: 'Larkfield Systems — rollout',
  order: ['cover', 'plan', 'team'],
  slides: {
    cover: slide('cover', '<h1 style="font-size:96px">One record</h1>'),
    plan: slide('plan', '<h2 style="font-size:64px">The plan</h2>'),
    team: slide('team', '<h2 style="font-size:64px">The team</h2>'),
  },
};

const original = window.location.href;

function renderWindow(start = 0) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DeckWindow artifactId={41} title="Larkfield Systems — rollout" spec={spec} start={start} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  window.history.replaceState(window.history.state, '', original);
  vi.restoreAllMocks();
});

describe('the deck in its own window', () => {
  it('fills the window without going full screen, and opens on the slide the URL named', async () => {
    const request = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined);
    renderWindow(1);

    const root = page.getByRole('main', { name: 'Presenting Larkfield Systems — rollout' });

    await expect.element(root).toBeVisible();
    await expect.element(page.getByText('2 / 3')).toBeVisible();

    expect(request).not.toHaveBeenCalled();
    // A window has no Exit: closing the window is the way out.
    expect(document.querySelector('[data-present-exit]')).toBeNull();
  });

  it('moves with the arrows and keeps the slide in the URL', async () => {
    renderWindow();

    await expect.element(page.getByText('1 / 3')).toBeVisible();

    await userEvent.keyboard('{ArrowRight}');

    await expect.element(page.getByText('2 / 3')).toBeVisible();

    await vi.waitFor(() => expect(new URL(window.location.href).searchParams.get('slide')).toBe('2'));

    await userEvent.keyboard('{End}');

    await vi.waitFor(() => expect(new URL(window.location.href).searchParams.get('slide')).toBe('3'));

    await userEvent.keyboard('{Home}');

    // The first slide is the plain URL.
    await vi.waitFor(() => expect(new URL(window.location.href).searchParams.has('slide')).toBe(false));
  });

  it('moves on a click on the slide, and back on a click on its left third', async () => {
    renderWindow();

    await expect.element(page.getByText('1 / 3')).toBeVisible();

    const layer = document.querySelector<HTMLElement>('[data-present-advance]')!;
    const box = layer.getBoundingClientRect();
    const clickAt = (share: number) => layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + box.width * share, clientY: box.top + box.height / 2 }));
    clickAt(0.8);

    await expect.element(page.getByText('2 / 3')).toBeVisible();

    clickAt(0.1);

    await expect.element(page.getByText('1 / 3')).toBeVisible();
  });

  it('goes full screen on the button, and Escape does not close anything', async () => {
    const request = vi.spyOn(HTMLElement.prototype, 'requestFullscreen').mockResolvedValue(undefined);
    renderWindow();

    await page.getByRole('button', { name: 'Full screen' }).click();

    expect(request).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('main', { name: 'Presenting Larkfield Systems — rollout' })).toBeVisible();
  });
});
