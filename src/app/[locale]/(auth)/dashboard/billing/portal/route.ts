import type Stripe from 'stripe';
import { createBillingPortal } from '@/services/BillingService';
import { getStripeCustomerId } from '@/services/OrganizationService';
import { ORG_ROLE } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      locale: Stripe.BillingPortal.SessionCreateParams.Locale;
    }>;
  },
) {
  const { orgId, has } = await auth();
  const { locale } = await context.params;

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

  const session = await createBillingPortal(customerId, locale);

  redirect(session.url);
}
