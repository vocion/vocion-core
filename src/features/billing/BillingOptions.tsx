import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { PLAN_ID } from '@/utils/AppConfig';
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
            className="w-full"
            disabled
          >
            {t('current_plan')}
          </Button>
        ),
        [PLAN_ID.PREMIUM]: (
          <Link
            className={buttonVariants({
              size: 'sm',
              className: 'w-full',
            })}
            href={`/dashboard/billing/checkout/${PLAN_ID.PREMIUM}`}
            prefetch={false}
          >
            {t('upgrade_plan')}
          </Link>
        ),
        [PLAN_ID.ENTERPRISE]: (
          <Link
            className={buttonVariants({
              size: 'sm',
              className: 'w-full',
            })}
            href={`/dashboard/billing/checkout/${PLAN_ID.ENTERPRISE}`}
            prefetch={false}
          >
            {t('upgrade_plan')}
          </Link>
        ),
      }}
    />
  );
};
