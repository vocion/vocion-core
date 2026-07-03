import { TitleBar } from '@/features/dashboard/TitleBar';
import { ProfilePanel } from '@/features/profile/ProfilePanel';

export default function ProfilePage() {
  return (
    <>
      <TitleBar
        title="Profile"
        description="Your account — display name, email, and password"
      />

      <ProfilePanel />
    </>
  );
}
