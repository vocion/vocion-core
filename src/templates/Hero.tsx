import { ArrowRightIcon, TwitterLogoIcon } from '@radix-ui/react-icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { buttonVariants } from '@/components/ui/buttonVariants';
import { CenteredHero } from '@/features/landing/CenteredHero';
import { Section } from '@/features/landing/Section';

const Hero = () => {
  const t = useTranslations('Hero');

  return (
    <Section className="py-36">
      <CenteredHero
        banner={{
          href: 'https://twitter.com/ixartz',
          text: (
            <>
              <TwitterLogoIcon className="mr-1 size-5" />
              {' '}
              {t('follow_twitter')}
            </>
          ),
        }}
        title={t.rich('title', {
          important: chunks => (
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              {chunks}
            </span>
          ),
        })}
        description={t('description')}
        buttons={(
          <>
            <Link className={buttonVariants({ size: 'lg' })} href="/sign-up">
              {t('primary_button')}
            </Link>

            <a
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
              href="https://nextjs-boilerplate.com/pro-saas-starter-kit"
            >
              {t('secondary_button')}

              <ArrowRightIcon className="ml-1 size-5" />
            </a>
          </>
        )}
      />
    </Section>
  );
};

export { Hero };
