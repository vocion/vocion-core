import { ArrowRightIcon } from '@radix-ui/react-icons';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CTABanner } from '@/features/landing/CTABanner';
import { Section } from '@/features/landing/Section';
import { Link } from '@/libs/I18nNavigation';

export const CTA = () => {
  const t = useTranslations('CTA');

  return (
    <Section>
      <CTABanner
        title={t('title')}
        description={t('description')}
        buttons={(
          <Link
            className={buttonVariants({ variant: 'secondary', size: 'lg', className: 'whitespace-pre-line' })}
            href="/sign-up"
          >
            {t('button_text')}

            <ArrowRightIcon className="ml-1 size-5" />
          </Link>
        )}
      />
    </Section>
  );
};
