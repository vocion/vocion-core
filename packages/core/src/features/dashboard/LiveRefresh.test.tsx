import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { LiveRefresh } from './LiveRefresh';

/**
 * A live page re-reads itself on its interval while the tab is visible, says
 * so, and stops when the tab is hidden — a wall of hidden tabs must not keep
 * a database busy. Coming back re-reads at once.
 */

const refresh = vi.fn();

// There is no router outside the app shell, so the hook is stubbed; `refresh`
// is a spy because how often the page is told to reload is the whole test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  refresh.mockReset();
  setVisibility('visible');
});

describe('LiveRefresh', () => {
  it('says it is live and re-reads the page on its interval', async () => {
    const screen = await render(<LiveRefresh everyMs={60} />);

    await expect.element(screen.getByRole('status')).toHaveTextContent(/^live · \d+s ago$/);
    expect(refresh).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });

  it('stops while the tab is hidden and re-reads at once when it is seen again', async () => {
    const screen = await render(<LiveRefresh everyMs={60} />);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 2000 });

    setVisibility('hidden');

    await expect.element(screen.getByRole('status')).toHaveTextContent('paused');

    const whileHidden = refresh.mock.calls.length;
    await new Promise(r => setTimeout(r, 250));

    expect(refresh.mock.calls.length).toBe(whileHidden);

    setVisibility('visible');

    await expect.element(screen.getByRole('status')).toHaveTextContent(/^live/);

    // Away longer than the interval: the first read does not wait for the next tick.
    await vi.waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(whileHidden), { timeout: 100 });
  });

  it('clears its timers on unmount', async () => {
    const screen = await render(<LiveRefresh everyMs={60} />);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 2000 });
    screen.unmount();
    const after = refresh.mock.calls.length;
    await new Promise(r => setTimeout(r, 250));

    expect(refresh.mock.calls.length).toBe(after);
  });
});
