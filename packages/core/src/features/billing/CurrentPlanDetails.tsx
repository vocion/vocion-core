import type { PlanDetails } from '@/types/Subscription';
import { useTranslations } from 'next-intl';

export const CurrentPlanDetails = (props: { planDetails: PlanDetails }) => {
  const t = useTranslations('PricingPlan');

  return (
    <>
      <div className="font-display text-2xl font-semibold text-[var(--brand-amber-deep)]">
        {`${t(`${props.planDetails.plan.id}_plan_name`)} ($${props.planDetails.plan.price} / ${t(`plan_interval_${props.planDetails.plan.interval}`)})`}
      </div>

      {props.planDetails.isPaid && props.planDetails.stripeDetails.stripeSubscriptionCurrentPeriodEnd && (
        <div className="mt-1 text-xs font-medium text-muted-foreground">
          {t('next_renew_date', {
            date: new Date(
              props.planDetails.stripeDetails.stripeSubscriptionCurrentPeriodEnd,
            ).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          })}
        </div>
      )}
    </>
  );
};
