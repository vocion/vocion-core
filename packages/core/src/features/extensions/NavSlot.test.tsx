import type { NavSlotProps } from '@/libs/extensions';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * The sidebar slot above the workspace switcher: each client extension's
 * component, in order, with the sidebar's directory, landing page and
 * collapsed state.
 */

const received = vi.hoisted(() => [] as NavSlotProps[]);

vi.mock('@vocion/enterprise/client', () => {
  const First = (props: NavSlotProps) => {
    received.push(props);
    return <div>first slot</div>;
  };
  const Second = () => <div>second slot</div>;
  return { clientExtensions: [{ name: 'a', navSlots: { 'nav.aboveWorkspaceSwitcher': [First] } }, { name: 'b', navSlots: { 'nav.aboveWorkspaceSwitcher': [Second] } }, { name: 'c' }] };
});

const { NavSlot } = await import('./NavSlot');

describe('NavSlot', () => {
  it('renders each extension\'s component in order, with what the sidebar knows', async () => {
    const targetPath = () => '/dashboard';
    await render(<NavSlot name="nav.aboveWorkspaceSwitcher" directory={null} targetPath={targetPath} collapsed />);

    await expect.element(page.getByText('first slot')).toBeVisible();
    await expect.element(page.getByText('second slot')).toBeVisible();
    expect(received.at(-1)).toEqual({ directory: null, targetPath, collapsed: true });
  });
});
