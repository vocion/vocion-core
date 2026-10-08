import type { RecommendedAction } from '../types';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * "Make it yours": a drafted brand on a sidebar and a sign-in page, and three
 * typed choices decided from the keyboard — 1 / 2 / 3, Enter for the
 * preselected one, Esc to skip. Using it runs as the person's action with
 * Undo; skipping is remembered on the card.
 */

const actAsPerson = vi.fn(async (): Promise<Record<string, unknown>> => ({ runId: 91, status: 'done' }));
const decideAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
const undoAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
const actionStatus = vi.fn(async (): Promise<Record<string, unknown>> => ({ status: 'pending' }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { actAsPerson, decideAction, undoAction, actionStatus } },
}));
// "Adjust" is a link; a click on it is recorded instead of navigating the test page away.
const followed = vi.fn();
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        followed(href);
        onClick?.(e);
      }}
    >
      {children}
    </a>
  ),
}));

const { BrandPreviewCard } = await import('./BrandPreviewCard');
const { SETUP_CHANGED_EVENT } = await import('./SetupCard');
const { CardDecisionProvider } = await import('./CardDecisions');
const { readableFill } = await import('@/libs/branding/contrast');

const MARK = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E8C7F"/></svg>')}`;

const rec: RecommendedAction = {
  id: 'card_brand1',
  kind: 'brand',
  actionId: 'org.brand_apply',
  input: { name: 'Northwind', accent: '#0e8c7f', headingFont: 'Space Grotesk', senderName: 'Northwind', logos: { mark: MARK }, website: 'https://northwind.example' },
  label: 'Make it yours: Northwind',
  body: 'Read from northwind.example.',
  href: '/dashboard/brand?draft=abc',
  hrefLabel: 'Adjust',
  agentSlug: 'workspace-lead',
  fields: [{ label: 'Note', value: 'Their favicon is an .ico, which the app can\'t keep.' }],
  state: 'proposed',
};

async function draw(card: RecommendedAction = rec, recorded = vi.fn()) {
  await render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CardDecisionProvider value={recorded}>
        <BrandPreviewCard rec={card} previewTheme="light" />
      </CardDecisionProvider>
    </NextIntlClientProvider>,
  );
  return recorded;
}

beforeEach(() => {
  actAsPerson.mockClear();
  undoAction.mockClear();
  followed.mockClear();
  actionStatus.mockReset();
  actionStatus.mockResolvedValue({ status: 'pending' });
});

describe('the brand preview card', () => {
  it('shows the draft on a sidebar and a sign-in page, with three choices and the first preselected and focused', async () => {
    await draw();

    await expect.element(page.getByTestId('brand-preview-sidebar')).toBeVisible();
    await expect.element(page.getByTestId('brand-preview-sign-in')).toHaveTextContent('Sign in to Northwind');

    // The draft's teal fills the sign-in button a shade deeper, so its text
    // is white at AA (the teal itself carries neither white nor near-black).
    const { fill } = readableFill('#0e8c7f');
    const hex = (i: number) => Number.parseInt(fill.slice(i, i + 2), 16);

    await expect.element(page.getByTestId('brand-preview-button')).toHaveStyle({ backgroundColor: `rgb(${hex(1)}, ${hex(3)}, ${hex(5)})`, color: 'rgb(255, 255, 255)' });
    await expect.element(page.getByTestId('brand-card-notes')).toHaveTextContent('.ico');
    await expect.element(page.getByTestId('brand-card-use')).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByTestId('brand-card-use')).toHaveFocus();
  });

  it('Enter takes "Use this brand": the person\'s action, then Applied with Undo, and the shell is told', async () => {
    const changed = vi.fn();
    window.addEventListener(SETUP_CHANGED_EVENT, changed);
    const recorded = await draw();
    actionStatus.mockResolvedValue({ status: 'done', undoable: true });
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('brand-card-applied')).toBeVisible();

    expect(actAsPerson).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'org.brand_apply', input: rec.input, agentSlug: 'workspace-lead' }));
    expect(recorded).toHaveBeenCalledWith({ cardId: 'card_brand1', label: rec.label, action: 'approve', runId: 91, turn: false });
    expect(changed).toHaveBeenCalled();

    actionStatus.mockResolvedValue({ status: 'undone' });
    await page.getByTestId('brand-card-undo').click();

    expect(undoAction).toHaveBeenCalledWith({ id: 91 });
    await expect.element(page.getByTestId('brand-card')).toHaveAttribute('data-state', 'undone');
  });

  it('2 opens Brand settings with the draft', async () => {
    await draw();
    await userEvent.keyboard('2');

    expect(followed).toHaveBeenCalledWith('/dashboard/brand?draft=abc');
    expect(actAsPerson).not.toHaveBeenCalled();
  });

  it('Esc skips, and the card remembers it without a run', async () => {
    const recorded = await draw();
    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByTestId('brand-card')).toHaveAttribute('data-state', 'skipped');

    expect(recorded).toHaveBeenCalledWith({ cardId: 'card_brand1', label: rec.label, action: 'reject', turn: false });
    expect(actAsPerson).not.toHaveBeenCalled();
  });

  it('arrows move the choice; 3 skips too', async () => {
    await draw();
    await userEvent.keyboard('{ArrowDown}');

    await expect.element(page.getByTestId('brand-card-adjust')).toHaveAttribute('aria-checked', 'true');
    await expect.element(page.getByTestId('brand-card-adjust')).toHaveFocus();

    await userEvent.keyboard('3');

    await expect.element(page.getByTestId('brand-card')).toHaveAttribute('data-state', 'skipped');
  });

  it('a card reloaded after a skip draws the outcome, not the choices', async () => {
    await draw({ ...rec, decision: { action: 'reject', at: '2026-10-08T12:00:00.000Z' } });

    await expect.element(page.getByTestId('brand-card')).toHaveAttribute('data-state', 'skipped');
    await expect.element(page.getByTestId('brand-card-use')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('brand-card-settings')).toHaveAttribute('href', '/dashboard/brand?draft=abc');
  });
});
