import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import '@/styles/global.css';

/**
 * A tooltip opens on a real hover with a fine pointer or on keyboard focus,
 * never on focus a script moved there (a drawer opening) and never on touch
 * (founder, 2026-10-08: one covered the switcher when the phone drawer opened).
 */

function One() {
  return (
    <>
      <button type="button">before</button>
      <Tooltip>
        <TooltipTrigger asChild><button type="button">Apps</button></TooltipTrigger>
        <TooltipContent>Software Factory</TooltipContent>
      </Tooltip>
    </>
  );
}

const shown = () => document.querySelectorAll('[data-slot="tooltip-content"]').length;

describe('Tooltip', () => {
  it('stays shut on focus a script moved there after a tap or click (a drawer opening)', async () => {
    await render(<One />);
    await page.getByRole('button', { name: 'before' }).click();
    (page.getByRole('button', { name: 'Apps' }).element() as HTMLElement).focus();
    await new Promise(r => setTimeout(r, 50));

    expect(shown()).toBe(0);
  });

  it('stays shut on a touch', async () => {
    await render(<One />);
    const el = page.getByRole('button', { name: 'Apps' }).element() as HTMLElement;
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
    await new Promise(r => setTimeout(r, 50));

    expect(shown()).toBe(0);
  });

  it('opens on keyboard focus and on a mouse hover', async () => {
    await render(<One />);
    await page.getByRole('button', { name: 'before' }).click();
    await userEvent.keyboard('{Tab}');

    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Software Factory');

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await page.getByRole('button', { name: 'Apps' }).hover();

    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Software Factory');
  });
});
