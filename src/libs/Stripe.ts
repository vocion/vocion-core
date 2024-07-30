import Stripe from 'stripe';

import { Env } from './Env';

export const stripe = new Stripe(Env.STRIPE_SECRET_KEY, {
  // https://github.com/stripe/stripe-node#configuration
  apiVersion: '2024-06-20',
  typescript: true,
});
