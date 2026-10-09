import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { NORTHWIND_VIEW } from './northwind.fixture';
import { LeadMark } from './OrgLogo';
import '@/styles/global.css';

/** The top bar's one brand: the Org's mark where the Org leads, Vocion's elsewhere — and never an Org without a logo. */
describe('LeadMark', () => {
  it('is the Org\'s mark where the Org leads', async () => {
    await render(<LeadMark brand={NORTHWIND_VIEW} lead="org" />);

    await expect.element(page.getByTestId('lead-mark')).toHaveAttribute('data-lead', 'org');
    expect((page.getByTestId('lead-mark').element().querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(NORTHWIND_VIEW.mark.light);
  });

  it('is Vocion\'s mark where Vocion leads, whatever the Org\'s brand', async () => {
    await render(<LeadMark brand={NORTHWIND_VIEW} lead="vocion" />);

    await expect.element(page.getByTestId('lead-mark')).toHaveAttribute('data-lead', 'vocion');
    expect((page.getByTestId('lead-mark').element().querySelector('img') as HTMLImageElement).getAttribute('src')).toBe(VOCION_PRIMARY_MARK);
  });

  it('an Org with only a wordmark gets its letter, never the wordmark squeezed into the square', async () => {
    await render(<LeadMark brand={{ name: 'Northwind', mark: {} }} lead="org" />);

    await expect.element(page.getByTestId('lead-mark')).toHaveAttribute('data-lead', 'org-letter');
    await expect.element(page.getByTestId('lead-mark')).toHaveTextContent('N');
    expect(page.getByTestId('lead-mark').element().querySelector('img')).toBeNull();
  });

  it('the slot is 20px square whatever the mark\'s shape', async () => {
    const wide = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 245 54"><rect width="245" height="54" fill="#f26522"/></svg>')}`;
    await render(<LeadMark brand={{ name: 'Northwind', mark: { light: wide } }} lead="org" />);
    const box = page.getByTestId('lead-mark').element().getBoundingClientRect();

    expect(box.width).toBe(20);
    expect(box.height).toBe(20);
  });
});
