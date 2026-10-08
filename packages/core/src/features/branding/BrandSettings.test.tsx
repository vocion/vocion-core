import type { BrandApi } from './BrandSettings';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * Brand settings: the accent checked as it is typed (refused with the reason,
 * adjusted with a note), the preview following every edit, Save with Undo,
 * and Reset to Vocion's own look.
 */

const refresh = vi.fn();
vi.mock('@/libs/I18nNavigation', () => ({ useRouter: () => ({ refresh }) }));

const { BrandSettings } = await import('./BrandSettings');
const { NORTHWIND_FIELDS } = await import('./northwind.fixture');

const api = {
  save: vi.fn<BrandApi['save']>(async fields => ({ before: null, fields, notes: [] })),
  restore: vi.fn<BrandApi['restore']>(async () => ({ before: null, fields: null })),
  uploadLogo: vi.fn<BrandApi['uploadLogo']>(async () => ({ url: '/api/media/brand/acct-nw/mark-0123456789abcdef.png' })),
};

async function draw(initial: typeof NORTHWIND_FIELDS | null = NORTHWIND_FIELDS) {
  await render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BrandSettings initial={initial} orgName="Northwind" api={api} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  api.save.mockClear();
  api.restore.mockClear();
  refresh.mockClear();
});

describe('Brand settings', () => {
  it('refuses an accent that cannot be worn, says why, and holds Save', async () => {
    await draw();
    await page.getByLabelText('Accent (hex)').fill('#FFFF00');

    await expect.element(page.getByTestId('brand-accent-check')).toHaveTextContent('Pick a deeper shade of it.');
    await expect.element(page.getByTestId('brand-save')).toBeDisabled();
  });

  it('says what an adjusted accent becomes, and the preview follows the edit', async () => {
    await draw();
    await page.getByLabelText('Accent (hex)').fill('#F18700');

    await expect.element(page.getByTestId('brand-accent-check')).toHaveTextContent(/On light pages, links and focus use #[0-9A-F]{6}/);
    await expect.element(page.getByTestId('brand-preview-button')).toHaveStyle({ backgroundColor: 'rgb(241, 135, 0)' });

    await page.getByLabelText('Company name').fill('Northwind Freight');

    await expect.element(page.getByTestId('brand-preview-sign-in')).toHaveTextContent('Sign in to Northwind Freight');
  });

  it('saves, re-reads the shell, and offers Undo with what it was before', async () => {
    api.save.mockResolvedValueOnce({ before: null, fields: { ...NORTHWIND_FIELDS, accent: '#7c3cff' }, notes: [] });
    await draw();
    await page.getByLabelText('Accent (hex)').fill('#7C3CFF');
    await page.getByTestId('brand-save').click();

    await expect.element(page.getByTestId('brand-status')).toHaveTextContent('Brand saved.');

    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Northwind', accent: '#7c3cff' }));
    expect(refresh).toHaveBeenCalled();

    await page.getByTestId('brand-undo').click();

    expect(api.restore).toHaveBeenCalledWith(null);
  });

  it('resets to Vocion\'s own look after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await draw();
    await page.getByTestId('brand-reset').click();

    await expect.element(page.getByTestId('brand-status')).toHaveTextContent('Back to Vocion\'s look.');

    expect(api.restore).toHaveBeenCalledWith(null);
  });
});
