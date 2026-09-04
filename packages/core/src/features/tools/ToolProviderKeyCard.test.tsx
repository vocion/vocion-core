/**
 * Pasting a tool's provider key from the tool's own page.
 *
 * The thing a reviewer would notice being wrong here is a save that quietly
 * stores nothing, or a card that offers to add a key when one is already on
 * file without saying the old one stops being used. Both are silent: the page
 * looks the same either way, so only a test catches them.
 */
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

const createPlatformKey = vi.fn();
const refresh = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    apiTokens: {
      createPlatformKey: (input: unknown) => createPlatformKey(input),
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const { ToolProviderKeyCard } = await import('./ToolProviderKeyCard');

beforeEach(() => {
  createPlatformKey.mockReset();
  refresh.mockReset();
});

const TAVILY_FIELDS = [
  { name: 'apiKey', label: 'Tavily key', shapeHint: 'starts with "tvly-"', secret: true },
];

/**
 * Render the card for Tavily, with or without a key already on file.
 * @param storedKeyHint - The masked hint of the key on file, or null for none.
 */
function renderCard(storedKeyHint: string | null = null) {
  // The card links to API credentials with the locale-aware Link, which reads
  // the intl context, so the provider has to be here even though nothing in
  // these tests is translated.
  return render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <ToolProviderKeyCard
        platformId="tavily"
        platformLabel="Tavily"
        helpText="Your Tavily API key, from app.tavily.com."
        fields={TAVILY_FIELDS}
        storedKeyHint={storedKeyHint}
      />
    </NextIntlClientProvider>,
  );
}

describe('a tool with no key on file', () => {
  it('offers the platform\'s own field and guidance', async () => {
    renderCard();

    await expect.element(page.getByText('Your Tavily API key, from app.tavily.com.')).toBeVisible();
    await expect.element(page.getByLabelText('Tavily key')).toBeVisible();
  });

  it('stores what was pasted against the right platform', async () => {
    createPlatformKey.mockResolvedValue({ id: 'tok_1', keyHint: '…abcd' });
    renderCard();

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-pasted-key');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    expect(createPlatformKey).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'tavily',
      values: { apiKey: 'tvly-pasted-key' },
    }));
  });

  it('reloads the page so the readiness badge reflects the new key', async () => {
    createPlatformKey.mockResolvedValue({ id: 'tok_1', keyHint: '…abcd' });
    renderCard();

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-pasted-key');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('will not save an empty field', async () => {
    renderCard();

    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    expect(createPlatformKey).not.toHaveBeenCalled();
  });

  it('says what went wrong when the save fails', async () => {
    createPlatformKey.mockRejectedValue(new Error('That key does not look right.'));
    renderCard();

    await userEvent.fill(page.getByLabelText('Tavily key'), 'nonsense');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    await expect.element(page.getByText('That key does not look right.')).toBeVisible();
  });
});

describe('a tool with a key already on file', () => {
  it('shows the masked hint of the key in use', async () => {
    renderCard('…wxyz');

    await expect.element(page.getByText('…wxyz')).toBeVisible();
  });

  it('says plainly that saving another one replaces it', async () => {
    renderCard('…wxyz');

    await expect.element(page.getByRole('button', { name: 'Replace key' })).toBeVisible();
    await expect.element(page.getByText(/replaces the key on file/i)).toBeVisible();
  });
});
