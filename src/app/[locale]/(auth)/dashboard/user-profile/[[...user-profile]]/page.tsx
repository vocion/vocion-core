import { getI18nPath } from '@/utils/Helpers';
import { UserProfile } from '@clerk/nextjs';
import { setRequestLocale } from 'next-intl/server';

export default async function UserProfilePage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <div className="mt-5">
      <UserProfile
        routing="path"
        path={getI18nPath('/dashboard/user-profile', locale)}
        appearance={{
          elements: {
            rootBox: 'w-full',
            cardBox: 'w-full',
            pageScrollBox: 'overflow-y-visible', // Avoid scroll bar on mobile
          },
        }}
      />
    </div>
  );
};
