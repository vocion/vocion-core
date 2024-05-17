import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { BillingOptions } from '@/features/billing/BillingOptions';
import { CurrentPlanDetails } from '@/features/billing/CurrentPlanDetails';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { determineSubscriptionPlan } from '@/services/BillingService';
import { getStripeSubscription } from '@/services/OrganizationService';

const BillingPage = async (props: { params: { locale: string } }) => {
  const { orgId } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Billing',
  });
  const stripeDetails = await getStripeSubscription(orgId);
  const planDetails = determineSubscriptionPlan(stripeDetails);

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <DashboardSection
        title={t('current_section_title')}
        description={t('current_section_description')}
      >
        <CurrentPlanDetails planDetails={planDetails} />

        {stripeDetails?.stripeCustomerId && (
          <div className="mt-5">
            <Link
              className={buttonVariants({ size: 'lg' })}
              href="/dashboard/billing/portal"
            >
              {t('manage_subscription_button')}
            </Link>
          </div>
        )}
      </DashboardSection>

      {!planDetails.isPaid && (
        <div className="mt-8">
          <BillingOptions />
        </div>
      )}
    </>
  );
};

export default BillingPage;
