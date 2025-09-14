import type { StripeLocale } from './Subscription';
import type { routing } from '@/libs/I18nRouting';
import type messages from '@/locales/en.json';

export type AppLocale = {
  id: string;
  name: string;
  stripeLocale: StripeLocale; // Optional: omit to fall back to 'auto'
};

declare module 'next-intl' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
