import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { PLAN_ID } from '@/utils/AppConfig';
import { useTranslations } from 'next-intl';
import { PricingInformation } from './PricingInformation';

export const BillingOptions = () => {
  const t = useTranslations('BillingOptions');

  return (
    <PricingInformation
      buttonList={{
        [PLAN_ID.FREE]: (
          <Button
            size="sm"
            variant="secondary"
            className="mt-5 w-full"
            disabled
          >
            {t('current_plan')}
          </Button>
        ),
        [PLAN_ID.PREMIUM]: (
          <a
            className={buttonVariants({
              size: 'sm',
              className: 'mt-5 w-full',
            })}
            href={`/dashboard/billing/checkout/${PLAN_ID.PREMIUM}`}
          >
            {t('upgrade_plan')}
          </a>
        ),
        [PLAN_ID.ENTERPRISE]: (
          <a
            className={buttonVariants({
              size: 'sm',
              className: 'mt-5 w-full',
            })}
            href={`/dashboard/billing/checkout/${PLAN_ID.ENTERPRISE}`}
          >
            {t('upgrade_plan')}
          </a>
        ),
      }}
    />
  );
};
