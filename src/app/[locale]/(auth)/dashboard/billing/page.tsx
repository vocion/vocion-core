import { buttonVariants } from '@/components/ui/buttonVariants';
import { ProtectFallback } from '@/features/auth/ProtectFallback';
import { BillingOptions } from '@/features/billing/BillingOptions';
import { CurrentPlanDetails } from '@/features/billing/CurrentPlanDetails';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { determineSubscriptionPlan } from '@/services/BillingService';
import { getStripeSubscription } from '@/services/OrganizationService';
import { ORG_ROLE } from '@/types/Auth';
import { Protect } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

export default async function BillingPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { orgId, has } = await auth();
  const { locale } = await props.params;

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const t = await getTranslations({
    locale,
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
            <Protect
              role={ORG_ROLE.ADMIN}
              fallback={(
                <ProtectFallback
                  trigger={(
                    <div
                      className={buttonVariants({
                        size: 'lg',
                        variant: 'secondary',
                      })}
                    >
                      {t('manage_subscription_button')}
                    </div>
                  )}
                />
              )}
            >
              {/* Not using Next.js Link when redirecting to Stripe */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                className={buttonVariants({ size: 'lg' })}
                href="/dashboard/billing/portal"
              >
                {t('manage_subscription_button')}
              </a>
            </Protect>
          </div>
        )}
      </DashboardSection>

      {has({ role: ORG_ROLE.ADMIN }) && !planDetails.isPaid && (
        <div className="mt-5 @container">
          <BillingOptions />
        </div>
      )}
    </>
  );
};
