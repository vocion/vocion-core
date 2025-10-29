import type { StripeLocale } from './Subscription';

export type AppLocale = {
  id: string;
  name: string;
  stripeLocale: StripeLocale; // Optional: omit to fall back to 'auto'
};
