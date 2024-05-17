import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type Stripe from 'stripe';

import { createBillingPortal } from '@/services/BillingService';
import { getStripeCustomerId } from '@/services/OrganizationService';

export async function GET(
  _request: Request,
  context: {
    params: {
      locale: Stripe.BillingPortal.SessionCreateParams.Locale;
    };
  },
) {
  const { orgId } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const organization = await getStripeCustomerId(orgId);

  const customerId = organization?.stripeCustomerId;

  if (!customerId) {
    redirect('/dashboard/billing');
  }

  const session = await createBillingPortal(customerId, context.params.locale);

  redirect(session.url);
}
