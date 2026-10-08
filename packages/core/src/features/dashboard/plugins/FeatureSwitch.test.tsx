import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/libs/Orpc', () => ({ client: { plugins: { set: vi.fn() } } }));

const { client } = await import('@/libs/Orpc');
const { FeatureSwitch } = await import('./FeatureSwitch');

beforeEach(() => {
  refresh.mockReset();
  vi.mocked(client.plugins.set).mockReset().mockResolvedValue({ applied: { sha: 'abc', errors: 0 }, mode: 'workspace' } as never);
});

describe('FeatureSwitch', () => {
  it('is a plain On/Off switch named for the feature, and a flip switches it and reloads', async () => {
    await render(<FeatureSwitch slug="data-rooms" name="Data rooms" on={false} canToggle />);
    const sw = page.getByRole('switch', { name: 'Data rooms: off' });

    await expect.element(sw).toHaveAttribute('aria-checked', 'false');
    await expect.element(page.getByText('Off', { exact: true })).toBeVisible();

    await userEvent.click(sw);

    expect(client.plugins.set).toHaveBeenCalledWith({ slug: 'data-rooms', enabled: true });
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a member the state in words, with no switch', async () => {
    await render(<FeatureSwitch slug="wiki" name="Wiki" on canToggle={false} />);

    await expect.element(page.getByText('On', { exact: true })).toBeVisible();
    expect(page.getByRole('switch').elements()).toHaveLength(0);
  });

  it('keeps a failure beside the switch, in words', async () => {
    vi.mocked(client.plugins.set).mockRejectedValue(new Error('The workspace could not be applied.'));
    await render(<FeatureSwitch slug="wiki" name="Wiki" on canToggle />);

    await userEvent.click(page.getByRole('switch', { name: 'Wiki: on' }));

    await expect.element(page.getByRole('alert')).toHaveTextContent('The workspace could not be applied.');
  });
});
