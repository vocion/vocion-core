import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { LiveRefresh } from './LiveRefresh';

/**
 * A live page re-reads itself on its interval while the tab is visible, says
 * so, and stops when the tab is hidden — a wall of hidden tabs must not keep
 * a database busy. Coming back re-reads at once.
 *
 * The state is asserted on `data-live` rather than on the text, because the
 * text is the part that goes away on a phone: there the DOT carries the
 * state, and elapsed seconds that change every second and are never acted on
 * would be the least useful thing on the row.
 */

const refresh = vi.fn();

// There is no router outside the app shell, so the hook is stubbed; `refresh`
// is a spy because how often the page is told to reload is the whole test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

// The live stream, as a switch and a doorbell: `stream.live` is whether it is
// up, `stream.ring()` delivers a notice to whatever the page follows.
const stream = vi.hoisted(() => ({ live: false, topics: [] as readonly string[], ring: () => {} }));
vi.mock('@/hooks/useLive', () => ({
  useLive: (topics: readonly string[], onNotice: () => void) => {
    stream.topics = topics;
    stream.ring = onNotice;
    return { live: stream.live && topics.length > 0, state: stream.live ? 'open' : 'down' };
  },
}));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  refresh.mockReset();
  setVisibility('visible');
  stream.live = false;
  stream.topics = [];
});

describe('LiveRefresh', () => {
  it('says it is live and re-reads the page on its interval', async () => {
    const screen = await render(<LiveRefresh everyMs={60} />);

    const pill = screen.getByTestId('live-refresh');

    await expect.element(pill).toHaveAttribute('data-live', 'on');
    await expect.element(pill).toHaveAttribute('aria-label', expect.stringContaining('Live'));
    expect(refresh).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });

  it('stops while the tab is hidden and re-reads at once when it is seen again', async () => {
    const screen = await render(<LiveRefresh everyMs={60} />);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 2000 });

    setVisibility('hidden');

    await expect.element(screen.getByTestId('live-refresh')).toHaveAttribute('data-live', 'paused');

    const whileHidden = refresh.mock.calls.length;
    await new Promise(r => setTimeout(r, 250));

    expect(refresh.mock.calls.length).toBe(whileHidden);

    setVisibility('visible');

    await expect.element(screen.getByTestId('live-refresh')).toHaveAttribute('data-live', 'on');

    // Away longer than the interval: the first read does not wait for the next tick.
    await vi.waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(whileHidden), { timeout: 100 });
  });

  it('re-reads at once when a person taps it', async () => {
    const screen = await render(<LiveRefresh everyMs={60_000} />);

    // Long interval: nothing is due, so any read is the tap's doing.
    expect(refresh).not.toHaveBeenCalled();

    await screen.getByTestId('live-refresh').click();

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 1000 });
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

describe('LiveRefresh, following what the page is made of (backlog 050)', () => {
  it('re-reads when something it follows changes, and makes no polling request while the stream is up', async () => {
    stream.live = true;
    const screen = await render(<LiveRefresh everyMs={60} follow={['list:request', 'runs']} />);
    const pill = screen.getByTestId('live-refresh');

    await expect.element(pill).toHaveAttribute('data-pushed', 'yes');
    await expect.element(pill).toHaveAttribute('aria-label', expect.stringContaining('the moment something on this page changes'));
    expect(stream.topics).toEqual(['list:request', 'runs']);

    // Many intervals pass: nothing polls.
    await new Promise(r => setTimeout(r, 250));

    expect(refresh).not.toHaveBeenCalled();

    // A burst of changes is one re-read.
    stream.ring();
    stream.ring();
    stream.ring();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await new Promise(r => setTimeout(r, 100));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling on its interval while the stream is down', async () => {
    stream.live = false;
    const screen = await render(<LiveRefresh everyMs={60} follow={['runs']} />);

    await expect.element(screen.getByTestId('live-refresh')).toHaveAttribute('data-pushed', 'no');

    await vi.waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });

  it('does not poll a page that asked not to while the stream is down and nothing runs', async () => {
    stream.live = false;
    await render(<LiveRefresh everyMs={60} follow={['record:12']} poll={false} />);
    await new Promise(r => setTimeout(r, 250));

    expect(refresh).not.toHaveBeenCalled();
  });
});
