import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ProviderLoginButton } from './ProviderLoginButton';
import '@/styles/global.css';

const START = '/api/connect/github/start?connector=github';

describe('a login button dressed as the provider it logs in with', () => {
  it.each([
    ['github', 'Log in with GitHub'],
    ['slack', 'Log in with Slack'],
    ['atlassian', 'Log in with Atlassian'],
  ])('%s: its brand and mark, and the label alone as its name', async (provider, label) => {
    const { container } = await render(<ProviderLoginButton provider={provider} href={START}>{label}</ProviderLoginButton>);

    const button = page.getByRole('link', { name: label, exact: true });

    await expect.element(button).toHaveAttribute('data-brand', provider);
    await expect.element(button).toHaveAttribute('href', START);
    expect(container.querySelector(`[data-brand="${provider}"] svg[aria-hidden="true"]`)).not.toBeNull();
  });

  it('a provider with no brand here keeps the product button, with no mark', async () => {
    const { container } = await render(<ProviderLoginButton provider="constructor" href={START}>Log in</ProviderLoginButton>);

    await expect.element(page.getByRole('link', { name: 'Log in' })).not.toHaveAttribute('data-brand');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('while waiting it is a disabled button with no link to follow, still in the brand', async () => {
    const { container } = await render(<ProviderLoginButton provider="slack" href={START} waitingTitle="Ready once the reply finishes">Connect Slack</ProviderLoginButton>);

    await expect.element(page.getByRole('button', { name: 'Connect Slack' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Connect Slack' })).toHaveAttribute('data-brand', 'slack');
    expect(container.querySelector('a')).toBeNull();
  });
});
