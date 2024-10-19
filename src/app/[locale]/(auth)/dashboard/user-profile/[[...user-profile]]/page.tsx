import { UserProfile } from '@clerk/nextjs';

import { getI18nPath } from '@/utils/Helpers';

const UserProfilePage = (props: { params: { locale: string } }) => {
  return (
    <div className="mt-5">
      <UserProfile
        routing="path"
        path={getI18nPath('/dashboard/user-profile', props.params.locale)}
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

export default UserProfilePage;
