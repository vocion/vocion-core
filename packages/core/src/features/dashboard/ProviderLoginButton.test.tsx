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
    ['google', 'Log in with Google'],
    ['hubspot', 'Log in with HubSpot'],
    ['notion', 'Log in with Notion'],
    ['zoom', 'Log in with Zoom'],
    ['posthog', 'Log in with PostHog'],
    ['apollo', 'Log in with Apollo'],
  ])('%s: its brand and mark, and the label alone as its name', async (provider, label) => {
    const { container } = await render(<ProviderLoginButton provider={provider} href={START}>{label}</ProviderLoginButton>);

    const button = page.getByRole('link', { name: label, exact: true });

    await expect.element(button).toHaveAttribute('data-brand', provider);
    await expect.element(button).toHaveAttribute('href', START);
    expect(container.querySelector(`[data-brand="${provider}"] :is(svg, img)[aria-hidden="true"]`)).not.toBeNull();
  });

  it('a provider with no brand here keeps the product button, with no mark', async () => {
    const { container } = await render(<ProviderLoginButton provider="constructor" href={START}>Log in</ProviderLoginButton>);

    await expect.element(page.getByRole('link', { name: 'Log in' })).not.toHaveAttribute('data-brand');
    expect(container.querySelector('svg, img')).toBeNull();
  });

  it('the marks drawn from files are served by the app, so a login button never shows a broken image', async () => {
    for (const provider of ['google', 'zoom', 'apollo']) {
      const { container, unmount } = await render(<ProviderLoginButton provider={provider} href={START}>Log in</ProviderLoginButton>);
      const image = container.querySelector('img') as HTMLImageElement;
      await image.decode();

      expect(image.naturalWidth, provider).toBeGreaterThan(0);

      await unmount();
    }
  });

  it('while waiting it is a disabled button with no link to follow, still in the brand', async () => {
    const { container } = await render(<ProviderLoginButton provider="slack" href={START} waitingTitle="Ready once the reply finishes">Connect Slack</ProviderLoginButton>);

    await expect.element(page.getByRole('button', { name: 'Connect Slack' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Connect Slack' })).toHaveAttribute('data-brand', 'slack');
    expect(container.querySelector('a')).toBeNull();
  });
});
