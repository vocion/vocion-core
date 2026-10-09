import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { NORTHWIND_VIEW } from './northwind.fixture';
import { LeadMark } from './OrgLogo';

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

  it('an Org with no logo falls back to Vocion\'s mark', async () => {
    await render(<LeadMark brand={{ name: 'Northwind', logo: {}, mark: {} }} lead="org" />);

    await expect.element(page.getByTestId('lead-mark')).toHaveAttribute('data-lead', 'vocion');
  });
});
