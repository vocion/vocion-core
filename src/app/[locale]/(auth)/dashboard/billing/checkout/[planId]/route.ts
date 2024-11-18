import type Stripe from 'stripe';
import { createCheckoutSession, createOrRetrieveCustomer } from '@/services/BillingService';
import { ORG_ROLE } from '@/types/Auth';
import { PricingPlanList } from '@/utils/AppConfig';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      planId: string;
      locale: Stripe.Checkout.SessionCreateParams.Locale;
    }>;
  },
) {
  const { orgId, has } = await auth();
  const { locale, planId } = await context.params;

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  if (!has({ role: ORG_ROLE.ADMIN })) {
    redirect('/dashboard/billing');
  }

  const plan = PricingPlanList[planId];

  if (!plan) {
    redirect('/dashboard/billing');
  }

  const customerId = await createOrRetrieveCustomer(orgId);
  const session = await createCheckoutSession(
    plan,
    customerId,
    locale,
  );

  if (!session.url) {
    redirect('/dashboard/billing');
  }

  redirect(session.url);
}
