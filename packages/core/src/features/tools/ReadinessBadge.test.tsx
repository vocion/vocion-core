/**
 * The badge has to tell three states apart, and the third is the one worth a
 * test: a workspace whose stored key cannot be read must not be told it needs
 * a key. An admin who reads "Needs key" stores a second one, which lands
 * beside the unreadable one and changes nothing, because the call path still
 * refuses rather than falling back.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ReadinessBadge } from './ReadinessBadge';

describe('readiness badge', () => {
  it('says ready when the capability can run', async () => {
    render(<ReadinessBadge ready keyStateUnknown={false} />);

    await expect.element(page.getByText('Ready')).toBeVisible();
  });

  it('asks for a key when nobody has one', async () => {
    render(<ReadinessBadge ready={false} keyStateUnknown={false} />);

    await expect.element(page.getByText('Needs key')).toBeVisible();
  });

  it('will not ask for a key it could not check for', async () => {
    render(<ReadinessBadge ready={false} keyStateUnknown />);

    await expect.element(page.getByText('Can\'t check')).toBeVisible();
    expect(page.getByText('Needs key').elements()).toHaveLength(0);
  });

  it('does not claim ready either, when it could not check', async () => {
    // `ready` is meaningless in this state, and a caller passing true — a
    // status built before the lookup failed, say — must not produce a green
    // badge over a key that will refuse on the next call.
    render(<ReadinessBadge ready keyStateUnknown />);

    await expect.element(page.getByText('Can\'t check')).toBeVisible();
    expect(page.getByText('Ready').elements()).toHaveLength(0);
  });
});
