import { ArrowRightIcon } from '@radix-ui/react-icons';
import { useTranslations } from 'next-intl';
import { badgeVariants } from '@/components/ui/badgeVariants';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { Section } from '@/features/landing/Section';
import { Link } from '@/libs/I18nNavigation';

export const Hero = () => {
  const t = useTranslations('Hero');

  return (
    <Section className="py-28 lg:py-36">
      <div className="text-center">
        <span className={badgeVariants()}>
          {t('badge')}
        </span>
      </div>

      <div className="mt-4 text-center text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
        {t.rich('title', {
          important: chunks => (
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              {chunks}
            </span>
          ),
        })}
      </div>

      <div className="mx-auto mt-6 max-w-2xl text-center text-lg leading-relaxed text-muted-foreground sm:text-xl">
        {t('description')}
      </div>

      <div className="mt-10 flex justify-center gap-x-5 gap-y-3 max-sm:flex-col">
        <Link className={buttonVariants({ size: 'lg' })} href="/sign-up">
          {t('primary_button')}
        </Link>

        <Link
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
          href="/sign-up"
        >
          {t('secondary_button')}
          <ArrowRightIcon className="ml-1 size-5" />
        </Link>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {(['proof1', 'proof2', 'proof3', 'proof4'] as const).map(key => (
          <div key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" />
            {t(key)}
          </div>
        ))}
      </div>
    </Section>
  );
};
