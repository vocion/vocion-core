import { ArrowRightIcon } from '@radix-ui/react-icons';
import { useTranslations } from 'next-intl';

import { buttonVariants } from '@/components/ui/button';
import { CTABanner } from '@/features/landing/CTABanner';
import { Section } from '@/features/landing/Section';

const CTA = () => {
  const t = useTranslations('CTA');

  return (
    <Section>
      <CTABanner
        title={t('title')}
        description={t('description')}
        buttons={
          <a
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
            href="https://vocion.ai/pro-saas-starter-kit"
          >
            {t('button_text')}

            <ArrowRightIcon className="ml-1 size-5" />
          </a>
        }
      />
    </Section>
  );
};

export { CTA };
