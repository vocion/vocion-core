import type { PlanDetails } from '@/types/Subscription';
import { useTranslations } from 'next-intl';

export const CurrentPlanDetails = (props: { planDetails: PlanDetails }) => {
  const t = useTranslations('PricingPlan');

  return (
    <>
      <div className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-2xl font-bold text-transparent">
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
