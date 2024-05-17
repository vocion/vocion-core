import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button, buttonVariants } from '@/components/ui/button';
import { Section } from '@/features/landing/Section';
import { PLAN_ID } from '@/utils/AppConfig';

import { PricingInformation } from './PricingInformation';

const BillingOptions = () => {
  const t = useTranslations('BillingOptions');

  return (
    <div className="rounded-md bg-card p-5">
      <Section>
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
              <Link
                className={buttonVariants({
                  size: 'sm',
                  className: 'mt-5 w-full',
                })}
                href="/dashboard/billing/checkout/premium"
              >
                {t('upgrade_plan')}
              </Link>
            ),
            [PLAN_ID.ENTERPRISE]: (
              <Link
                className={buttonVariants({
                  size: 'sm',
                  className: 'mt-5 w-full',
                })}
                href="/dashboard/billing/checkout/enterprise"
              >
                {t('upgrade_plan')}
              </Link>
            ),
          }}
        />
      </Section>
    </div>
  );
};

export { BillingOptions };
