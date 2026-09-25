import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ConversationPageActions } from './ConversationPageActions';
import '@/styles/global.css';

/**
 * The full-page conversation's shell-bar controls, at a phone width and at a
 * desktop one (backlog 008).
 *
 * On a phone there is no rail to collapse the conversation back into — the
 * page IS the chat — so the control is not drawn there. From `md` up it is.
 * The rule is CSS, so it is asserted in a real browser at real widths.
 */

describe('the conversation page actions', () => {
  it('at 390px shows no collapse control — there is nothing to collapse to', async () => {
    await page.viewport(390, 844);
    render(<ConversationPageActions artifactCount={2} artifactsOpen={false} onOpenArtifacts={() => {}} onBack={() => {}} />);

    await expect.element(page.getByTestId('conversation-page-actions')).toBeVisible();
    // The artifacts control still reaches the person; the way back does not.
    await expect.element(page.getByTestId('conversation-artifacts')).toBeVisible();
    await expect.element(page.getByTestId('conversation-collapse')).not.toBeVisible();
  });

  it('from md up shows the collapse control, and it goes back', async () => {
    await page.viewport(1440, 900);
    const onBack = vi.fn();
    render(<ConversationPageActions artifactCount={0} artifactsOpen={false} onOpenArtifacts={() => {}} onBack={onBack} />);

    const collapse = page.getByTestId('conversation-collapse');

    await expect.element(collapse).toBeVisible();

    await collapse.click();

    expect(onBack).toHaveBeenCalledTimes(1);
    // No artifacts: no artifacts control.
    expect(page.getByTestId('conversation-artifacts').query()).toBeNull();
  });
});
