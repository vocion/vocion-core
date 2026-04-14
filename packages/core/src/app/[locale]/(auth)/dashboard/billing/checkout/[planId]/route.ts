import { redirect } from 'next/navigation';
import { createCheckoutSession, createOrRetrieveCustomer } from '@/services/BillingService';
import { ORG_ROLE } from '@/types/Auth';
import { PricingPlanList } from '@/utils/AppConfig';
import { requireOrganization } from '@/utils/Auth';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      planId: string;
      locale: string;
    }>;
  },
) {
  const { orgId, has } = await requireOrganization();
  const { locale, planId } = await context.params;

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
