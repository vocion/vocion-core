import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ReactNode } from 'react';
import { Globe, Mail } from 'lucide-react';
import { listBrands } from '@/libs/brands/catalog';
import { IntegrationLogo } from './IntegrationLogo';

/**
 * `IntegrationLogo` — the tile for anything Vocion connects to. The brand
 * comes from the descriptor (`brand` on a platform or a connector), the mark
 * from `libs/brands/catalog.ts`. A brand whose colour clears 3:1 on the tile
 * keeps it; one that does not is drawn in ink. A brand with no permitted mark,
 * and a descriptor with no brand, draw the `LetterTile` they always did.
 */
const meta: Meta<typeof IntegrationLogo> = {
  title: 'Patterns/Integration logo',
  component: IntegrationLogo,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<typeof IntegrationLogo>;

/** One tile: a brand with a mark. */
export const Logo: Story = { args: { brand: 'github', name: 'GitHub' } };

/** No mark, no icon: the monogram, as before. */
export const FallsBackToMonogram: Story = { args: { brand: 'openai', name: 'OpenAI' } };

/** No mark, with the connector's icon: the icon, as before. */
export const FallsBackToIcon: Story = { args: { brand: 'slack', name: 'Slack', icon: Mail } };

/** Not one vendor (a web crawler): no brand at all. */
export const NoBrand: Story = { args: { name: 'Web', icon: Globe } };

/**
 * Every brand in the catalog at each tile size, on the light surface and the
 * dark one side by side — the legibility check for a new mark.
 * @param props - The panel.
 * @param props.dark - Render the panel in the dark theme.
 * @param props.children - The brand table.
 */
function Theme({ dark, children }: { dark: boolean; children: ReactNode }) {
  return (
    <div className={dark ? 'dark' : undefined}>
      <div className="rounded-2xl bg-background p-4 text-foreground">
        <p className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{dark ? 'Dark' : 'Light'}</p>
        {children}
      </div>
    </div>
  );
}

function BrandTable() {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {listBrands().map(brand => (
        <li key={brand.key} className="flex items-center gap-2" data-brand={brand.key}>
          <IntegrationLogo brand={brand.key} name={brand.title} size="sm" />
          <IntegrationLogo brand={brand.key} name={brand.title} />
          <IntegrationLogo brand={brand.key} name={brand.title} size="lg" />
          <span className="min-w-0 text-[13px]">
            <span className="block truncate font-medium">{brand.title}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{brand.mark ? brand.key : `${brand.key} · no logo`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const EveryBrand: Story = {
  render: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      <Theme dark={false}><BrandTable /></Theme>
      <Theme dark><BrandTable /></Theme>
    </div>
  ),
};
