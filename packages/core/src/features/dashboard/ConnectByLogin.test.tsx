import type { CredentialDraft } from './ConnectByLogin';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ConnectCredential } from './ConnectByLogin';
import '@/styles/global.css';

const draft: CredentialDraft = { keepStored: false, values: {}, snapshot: null, shown: false, revealing: false, revealNote: null };

/**
 * CLICK TO AUTH, ALWAYS (Chris, 2026-10-25). A vendor with a login leads with
 * it, set up or not; a key is the advanced way in.
 */
describe('ConnectCredential', () => {
  it('leads with the login and keeps the key behind Advanced', async () => {
    await render(<ConnectCredential connector="github" info={{ providerLabel: 'GitHub', loggedInAs: null, stored: null, lastAttempt: null }} draft={draft} setDraft={() => {}} focusFirst={false} />);

    await expect.element(page.getByRole('link', { name: 'Log in with GitHub' })).toBeInTheDocument();
    await expect.element(page.getByTestId('connect-use-key')).toHaveTextContent('Advanced: use an API key instead');
  });

  it('a login this server has no app for still shows its button, disabled, with what an admin sets up, and no key form until asked', async () => {
    const note = 'Signing in with LinkedIn isn\'t set up here yet. An admin saves LinkedIn\'s login app on the Developers page, then this button signs you in.';
    await render(<ConnectCredential connector="linkedin-ads" info={{ providerLabel: null, loggedInAs: null, stored: null, lastAttempt: null, loginSetup: { label: 'LinkedIn', note } }} draft={draft} setDraft={() => {}} focusFirst={false} />);

    await expect.element(page.getByRole('button', { name: 'Log in with LinkedIn' })).toBeDisabled();
    await expect.element(page.getByTestId('connect-login-setup')).toHaveTextContent('isn\'t set up here yet');
    expect(page.getByRole('textbox').elements()).toHaveLength(0);

    await userEvent.click(page.getByTestId('connect-use-key'));

    expect(page.getByRole('textbox').elements().length).toBeGreaterThan(0);
  });
});
