import { getI18nPath } from '@/utils/Helpers';
import { UserProfile } from '@clerk/nextjs';

export default async function UserProfilePage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;

  return (
    <div className="mt-5">
      <UserProfile
        routing="path"
        path={getI18nPath('/dashboard/user-profile', locale)}
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
