import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { BrandApi } from './BrandSettings';
import { NextIntlClientProvider } from 'next-intl';
import { withFields } from '@/libs/branding/orgBrand';
import en from '@/locales/en.json';
import { BrandSettings } from './BrandSettings';
import { NORTHWIND_FIELDS } from './northwind.fixture';

/**
 * Brand settings (`/dashboard/brand`, Organization › Brand): the Org's name,
 * logo and mark (light and dark), accent, heading font and mail sender, with
 * the sidebar and sign-in previewed beside the form in either theme. The
 * accent is checked as it is typed — try `#FFFF00` (refused, with the
 * reason) or `#F18700` (adjusted on light pages, and said). Saving here goes
 * nowhere: the calls are the story's.
 */

const api: BrandApi = {
  save: async fields => ({ before: null, fields, notes: [] }),
  restore: async () => ({ before: withFields(null, NORTHWIND_FIELDS), fields: null }),
  uploadLogo: async () => ({ url: NORTHWIND_FIELDS.logos.mark! }),
};

function Page(props: { initial: typeof NORTHWIND_FIELDS | null; draft?: Partial<typeof NORTHWIND_FIELDS> | null }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <div className="w-[1180px] bg-background p-8">
        <BrandSettings initial={props.initial} draft={props.draft} orgName="Northwind" api={api} />
      </div>
    </NextIntlClientProvider>
  );
}

const meta: Meta<typeof Page> = {
  title: 'Branding/BrandSettings',
  component: Page,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof Page>;

/** An Org wearing its brand. */
export const Branded: Story = { args: { initial: NORTHWIND_FIELDS } };

/** A first brand: the Org's name and nothing else yet. */
export const Unbranded: Story = { args: { initial: null } };

/** "Adjust" from the brand card in chat: the draft, unsaved, with where it was read from. */
export const DraftFromChat: Story = { args: { initial: null, draft: { ...NORTHWIND_FIELDS, accent: '#F18700' } } };

/** An accent that cannot be worn: the reason, and Save held. */
export const AccentRefused: Story = { args: { initial: null, draft: { ...NORTHWIND_FIELDS, accent: '#FFFF00' } } };
