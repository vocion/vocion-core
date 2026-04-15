import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CenteredMenu } from '@/features/landing/CenteredMenu';
import { Section } from '@/features/landing/Section';
import { Link } from '@/libs/I18nNavigation';
import { VocionLogo } from './VocionLogo';

export const Navbar = () => {
  const t = useTranslations('Navbar');

  return (
    <Section className="px-3 py-6">
      <CenteredMenu
        logo={(
          <Link href="/" className="hover:opacity-80">
            <VocionLogo />
          </Link>
        )}
        rightMenu={(
          <>
            <li>
              <ThemeSwitcher />
            </li>
            <li>
              <LocaleSwitcher />
            </li>
            <li className="mr-2.5 ml-1">
              <Link href="/sign-in">{t('sign_in')}</Link>
            </li>
            <li>
              <Link className={buttonVariants()} href="/sign-up">
                {t('sign_up')}
              </Link>
            </li>
          </>
        )}
      >
        <li>
          <Link href="/solve">{t('product')}</Link>
        </li>

        <li>
          <Link href="/docs">{t('docs')}</Link>
        </li>

        <li>
          <Link href="/blog">{t('blog')}</Link>
        </li>

        <li>
          <Link href="/use-cases">{t('community')}</Link>
        </li>

        <li>
          <Link href="/company">{t('company')}</Link>
        </li>
      </CenteredMenu>
    </Section>
  );
};
