import { redirect } from 'next/navigation';
import { createBillingPortal } from '@/services/BillingService';
import { getStripeCustomerId } from '@/services/OrganizationService';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      locale: string;
    }>;
  },
) {
  const { orgId, has } = await requireOrganization();
  const { locale } = await context.params;

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
