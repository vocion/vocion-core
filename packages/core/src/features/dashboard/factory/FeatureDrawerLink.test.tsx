import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import '@/styles/global.css';

const { PreviewOpen } = await import('./FeatureDrawerLink');

describe('a pane trigger with its pane open (Chris, 2026-09-29: black text on black)', () => {
  it('the primary stays the patterns\' button — its text never turns ink on its ink background', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?preview=worker_run:419`);
    const screen = await render(<PreviewOpen recordRef={{ type: 'worker_run', id: '419' }} look="primary" testId="t">View progress</PreviewOpen>);
    const el = screen.container.querySelector<HTMLElement>('[data-testid="t"]')!;

    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.className).not.toContain('text-foreground');

    const style = getComputedStyle(el);

    expect(style.color).not.toBe(style.backgroundColor);

    window.history.replaceState(null, '', window.location.pathname);
  });

  it('a quiet trigger still reads as open', async () => {
    window.history.replaceState(null, '', `${window.location.pathname}?preview=worker_run:419`);
    const screen = await render(<PreviewOpen recordRef={{ type: 'worker_run', id: '419' }} testId="q">View run</PreviewOpen>);

    expect(screen.container.querySelector('[data-testid="q"]')!.className).toContain('text-foreground');

    window.history.replaceState(null, '', window.location.pathname);
  });
});
