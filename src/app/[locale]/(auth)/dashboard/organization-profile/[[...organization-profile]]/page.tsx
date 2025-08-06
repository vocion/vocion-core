import { OrganizationProfile } from '@clerk/nextjs';
import { setRequestLocale } from 'next-intl/server';
import { getI18nPath } from '@/utils/Helpers';

export default async function OrganizationProfilePage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <div className="mt-5">
      <OrganizationProfile
        routing="path"
        path={getI18nPath('/dashboard/organization-profile', locale)}
        afterLeaveOrganizationUrl="/onboarding/organization-selection"
        appearance={{
          elements: {
            rootBox: 'w-full',
            cardBox: 'w-full flex', // `flex` is needed when the component has a large width
          },
        }}
      />
    </div>
  );
};
