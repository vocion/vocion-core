import type { ObjectiveView } from '@/libs/objectives/objective';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * CONTEXT MID-OBJECTIVE (founder, 2026-10-09: "Does it give or should I have
 * context mid objective?"). One quiet line above the dock — what, which step
 * of how many, Stop — that lists the steps when tapped, pauses and resumes,
 * says once when it is done, and stays in view on a phone while the dock
 * below it scrolls. Fixtures are fictional.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

const { ObjectiveStrip } = await import('./ObjectiveStrip');
const { ChatComposer } = await import('../ChatComposer');

const view: ObjectiveView = {
  conversationId: 12,
  kind: 'setup',
  plugin: 'software-factory',
  name: 'Software Factory',
  state: 'running',
  steps: [
    { key: 'connector:github', label: 'Connect GitHub', done: true },
    { key: 'records:product', label: 'Create the first product record', done: false },
    { key: 'records:repo', label: 'Create the first repo record', done: false },
  ],
  done: 1,
  total: 3,
  current: 1,
  later: [],
};

describe('the objective\'s line', () => {
  it('says what, which step of how many, and Stop — in one line', async () => {
    await render(<ObjectiveStrip view={view} onStop={() => {}} onResume={() => {}} />);

    await expect.element(page.getByTestId('objective-line')).toHaveTextContent(/Setting up Software Factory · 2 of 3/);
    await expect.element(page.getByTestId('objective-stop')).toHaveTextContent('Stop');
    expect(page.getByTestId('objective-steps').elements()).toHaveLength(0);
  });

  it('lists the steps when tapped: what is done, where you are, what is next', async () => {
    await render(<ObjectiveStrip view={view} onStop={() => {}} onResume={() => {}} />);
    await page.getByTestId('objective-line').click();

    const steps = page.getByTestId('objective-step').elements();

    expect(steps.map(s => s.textContent)).toEqual(['Connect GitHub(done)', 'Create the first product record(you are here)', 'Create the first repo record(next)']);
    expect(steps[1]!.dataset.current).toBe('true');
    await expect.element(page.getByTestId('objective-line')).toHaveAttribute('aria-expanded', 'true');
  });

  it('stops, and a paused one says so and resumes', async () => {
    const onStop = vi.fn();
    const onResume = vi.fn();
    const screen = await render(<ObjectiveStrip view={view} onStop={onStop} onResume={onResume} />);
    await page.getByTestId('objective-stop').click();

    expect(onStop).toHaveBeenCalledOnce();

    await screen.rerender(<ObjectiveStrip view={{ ...view, state: 'stopped' }} onStop={onStop} onResume={onResume} />);

    await expect.element(page.getByTestId('objective-line')).toHaveTextContent(/Paused setting up Software Factory · 2 of 3/);

    await page.getByTestId('objective-resume').click();

    expect(onResume).toHaveBeenCalledOnce();
  });

  it('says once that it is set up, and can be put away', async () => {
    await render(<ObjectiveStrip view={{ ...view, state: 'done', done: 3, current: 3, steps: view.steps.map(s => ({ ...s, done: true })) }} onStop={() => {}} onResume={() => {}} />);

    await expect.element(page.getByTestId('objective-line')).toHaveTextContent('Software Factory is set up');
    expect(page.getByTestId('objective-stop').elements()).toHaveLength(0);

    await page.getByTestId('objective-dismiss').click();

    expect(page.getByTestId('objective-strip').elements()).toHaveLength(0);
  });

  it('stays in view on a phone above a dock that scrolls, at a thumb\'s 44px', async () => {
    await page.viewport(390, 844);
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <div style={{ height: 844 }} className="flex flex-col justify-end">
          <ChatComposer
            pinned={<ObjectiveStrip view={view} onStop={() => {}} onResume={() => {}} />}
            above={<div data-testid="tall-dock" style={{ height: 600 }}>A docked Decision</div>}
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
          />
        </div>
      </NextIntlClientProvider>,
    );

    const strip = await page.getByTestId('objective-strip').element() as HTMLElement;
    const slot = await page.getByTestId('composer-above').element() as HTMLElement;

    // Not inside the capped, scrolling slot: above it.
    expect(slot.contains(strip)).toBe(false);
    expect(strip.getBoundingClientRect().bottom).toBeLessThanOrEqual(slot.getBoundingClientRect().top + 1);

    slot.scrollTop = 300;

    expect(strip.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);

    for (const id of ['objective-line', 'objective-stop']) {
      expect((await page.getByTestId(id).element() as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  it('names optional extras as Later, under the steps — never as steps', async () => {
    await render(<ObjectiveStrip view={{ ...view, later: [{ key: 'plugin:wiki', label: 'Turn on Wiki' }, { key: 'plugin:red-team', label: 'Turn on Red team' }] }} onStop={() => {}} onResume={() => {}} />);
    await page.getByTestId('objective-line').click();

    expect(page.getByTestId('objective-step').elements()).toHaveLength(3);
    expect(page.getByTestId('objective-later-item').elements().map(e => e.textContent)).toEqual(['Turn on Wiki', 'Turn on Red team']);
    await expect.element(page.getByTestId('objective-progress')).toHaveTextContent('2 of 3');
  });
});
