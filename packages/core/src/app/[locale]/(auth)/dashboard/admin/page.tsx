import { setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { SystemStatus } from '@/features/dashboard/SystemStatus';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { isOperatorUser } from '@/services/OperatorConsoleService';

export default async function AdminPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  // The operator console has no sidebar row — it is for the few people who
  // run the deployment, so its door is here, shown only to them.
  const { userId } = await auth();
  const operator = userId ? await isOperatorUser(userId).catch(() => false) : false;

  return (
    <>
      <TitleBar
        title="System"
        description="What this workspace holds — and, for the people who operate this installation, the health of its services"
        actions={operator
          ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/operator">Operator console</Link>
              </Button>
            )
          : undefined}
      />
      <SystemStatus />
    </>
  );
}
