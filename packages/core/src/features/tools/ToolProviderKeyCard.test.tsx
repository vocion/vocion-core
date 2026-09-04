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
  // Saving over a live key asks first; every test that is not about the
  // asking answers yes. `spyOn` hands back the same spy once one is in place,
  // so its calls have to be cleared or they accumulate across tests.
  vi.spyOn(window, 'confirm').mockClear().mockReturnValue(true);
});

const TAVILY_FIELDS = [
  { name: 'apiKey', label: 'Tavily key', shapeHint: 'starts with "tvly-"', secret: true },
];

/**
 * Render the card for Tavily, with or without a key already on file.
 * @param storedKeyHint - The masked hint of the key on file, or null for none.
 * @param serverHasKey
 * @param sharedWithModelCalls
 */
function renderCard(storedKeyHint: string | null = null, serverHasKey = true, sharedWithModelCalls = false) {
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
        serverHasKey={serverHasKey}
        sharedWithModelCalls={sharedWithModelCalls}
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

describe('what the card says about whose key is in use', () => {
  it('says the server key is carrying the tool when only the server has one', async () => {
    renderCard(null, true);

    await expect.element(page.getByText(/calls run on the Vocion server key/i)).toBeVisible();
  });

  it('does not claim a server key exists when nobody has one', async () => {
    // The readiness badge says "Needs key" in this state, so copy promising
    // that calls run on the server key contradicts the page it sits on.
    renderCard(null, false);

    await expect.element(page.getByText(/nobody has a key for this yet/i)).toBeVisible();
    expect(page.getByText(/calls run on the Vocion server key/i).elements()).toHaveLength(0);
  });
});

describe('a save that fails without an Error to explain it', () => {
  it('still says something rather than going quiet', async () => {
    // oRPC can reject with a plain object, and a card that renders nothing in
    // that case looks like a save that worked.
    createPlatformKey.mockRejectedValue({ code: 'BAD_GATEWAY' });
    renderCard();

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-pasted-key');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    await expect.element(page.getByText('Could not save the key.')).toBeVisible();
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

describe('saving over a key that is already in use', () => {
  it('asks before replacing it, the way the credentials page does', async () => {
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    createPlatformKey.mockResolvedValue({ id: 'tok_2', keyHint: '…newk' });
    renderCard('…wxyz');

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-replacement-key');
    await userEvent.click(page.getByRole('button', { name: 'Replace key' }));

    expect(confirmed).toHaveBeenCalled();
    expect(confirmed.mock.calls[0]?.[0]).toMatch(/replaces/i);
  });

  it('stores nothing when the answer is no', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard('…wxyz');

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-replacement-key');
    await userEvent.click(page.getByRole('button', { name: 'Replace key' }));

    expect(createPlatformKey).not.toHaveBeenCalled();
  });

  it('does not ask when there is no key to replace', async () => {
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true);
    createPlatformKey.mockResolvedValue({ id: 'tok_1', keyHint: '…abcd' });
    renderCard(null);

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-first-key');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    expect(confirmed).not.toHaveBeenCalled();
  });
});

describe('after a save that worked', () => {
  it('says so, rather than leaving the page to explain itself', async () => {
    createPlatformKey.mockResolvedValue({ id: 'tok_1', keyHint: '…abcd' });
    renderCard();

    await userEvent.fill(page.getByLabelText('Tavily key'), 'tvly-pasted-key');
    await userEvent.click(page.getByRole('button', { name: 'Save key' }));

    await expect.element(page.getByText(/key saved/i)).toBeVisible();
  });
});

describe('a platform whose key is shared with model calls', () => {
  it('warns that saving here changes what chat and embeddings spend', async () => {
    // The image tool resolves through the org's single OpenAI credential, so a
    // key pasted on that page replaces the one every model call uses.
    renderCard(null, true, true);

    await expect.element(page.getByText(/model calls/i)).toBeVisible();
  });

  it('says nothing of the sort for a platform only one tool uses', async () => {
    renderCard(null, true, false);

    expect(page.getByText(/model calls/i).elements()).toHaveLength(0);
  });
});
