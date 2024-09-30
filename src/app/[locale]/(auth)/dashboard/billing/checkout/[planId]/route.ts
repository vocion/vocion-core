import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type Stripe from 'stripe';

import {
  createCheckoutSession,
  createOrRetrieveCustomer,
} from '@/services/BillingService';
import { ORG_ROLE } from '@/types/Auth';
import { PricingPlanList } from '@/utils/AppConfig';

export async function GET(
  _request: Request,
  context: {
    params: {
      planId: string;
      locale: Stripe.Checkout.SessionCreateParams.Locale;
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

  const plan = PricingPlanList.find(
    elt => elt.id.toLocaleLowerCase() === context.params.planId,
  );

  if (!plan) {
    redirect('/dashboard/billing');
  }

  const customerId = await createOrRetrieveCustomer(orgId);
  const session = await createCheckoutSession(
    plan,
    customerId,
    context.params.locale,
  );

  if (!session.url) {
    redirect('/dashboard/billing');
  }

  redirect(session.url);
}
