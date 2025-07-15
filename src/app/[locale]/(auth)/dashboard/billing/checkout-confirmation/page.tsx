import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { MessageState } from '@/features/dashboard/MessageState';

export default async function CheckoutConfirmation(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'CheckoutConfirmation',
  });

  return (
    <MessageState
      icon={(
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M0 0h24v24H0z" stroke="none" />
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )}
      title={t('message_state_title')}
      description={t('message_state_description')}
      button={(
        <Link
          className={buttonVariants({ size: 'lg' })}
          href="/dashboard/billing"
        >
          {t('message_state_button')}
        </Link>
      )}
    />
  );
};
