import type Stripe from 'stripe';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Env } from '@/libs/Env';
import { logger } from '@/libs/Logger';
import { stripe } from '@/libs/Stripe';
import { processWebhookEvent } from '@/services/BillingService';

export const POST = async (request: Request) => {
  const body = await request.text();
  const signature = (await headers()).get('Stripe-Signature');

  if (!signature) {
    logger.error('Stripe-Signature header not found');
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error: any) {
    logger.error(error);
    return NextResponse.json({ error: 'Webhook Error' }, { status: 400 });
  }

  await processWebhookEvent(event);

  return NextResponse.json({ received: true });
};
