import Stripe from 'stripe';

import { Env } from './Env';

export const stripe = Env.STRIPE_SECRET_KEY
  ? new Stripe(Env.STRIPE_SECRET_KEY, { typescript: true })
  : null;
