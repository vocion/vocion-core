import type { Metadata } from 'next';
import { OrganizationList } from '@clerk/nextjs';
import { getTranslations, setRequestLocale } from 'next-intl/server';

type IOrganizationSelectionProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata(props: IOrganizationSelectionProps): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({
    locale,
    namespace: 'Dashboard',
  });

  return {
    title: t('meta_title'),
    description: t('meta_description'),
  };
}

export default async function OrganizationSelectionPage(props: IOrganizationSelectionProps) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <OrganizationList
        afterSelectOrganizationUrl="/dashboard"
        afterCreateOrganizationUrl="/dashboard"
        hideSlug
        hidePersonal
        skipInvitationScreen
      />
    </div>
  );
}
