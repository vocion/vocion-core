import { OrganizationProfile } from '@clerk/nextjs';

import { getI18nPath } from '@/utils/Helpers';

const OrganizationProfilePage = (props: { params: { locale: string } }) => {
  return (
    <div className="mt-5">
      <OrganizationProfile
        routing="path"
        path={getI18nPath(
          '/dashboard/organization-profile',
          props.params.locale,
        )}
        afterLeaveOrganizationUrl="/onboarding/organization-selection"
        appearance={{
          elements: {
            rootBox: 'w-full',
            cardBox: 'w-full flex',
          },
        }}
      />
    </div>
  );
};

export default OrganizationProfilePage;
