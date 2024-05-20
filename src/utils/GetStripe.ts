import type { Stripe } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js';

import { Env } from '@/libs/Env';

let stripePromise: Promise<Stripe | null>;

export default function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(Env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }

  return stripePromise;
}
