import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type Stripe from 'stripe';

import { createBillingPortal } from '@/services/BillingService';
import { getStripeCustomerId } from '@/services/OrganizationService';
import { ORG_ROLE } from '@/types/Auth';

export async function GET(
  _request: Request,
  context: {
    params: {
      locale: Stripe.BillingPortal.SessionCreateParams.Locale;
    };
  },
) {
  const { orgId, has } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  if (!has({ role: ORG_ROLE.ADMIN })) {
    redirect('/dashboard/billing');
  }

  const organization = await getStripeCustomerId(orgId);

  const customerId = organization?.stripeCustomerId;

  if (!customerId) {
    redirect('/dashboard/billing');
  }

  const session = await createBillingPortal(customerId, context.params.locale);

  redirect(session.url);
}
