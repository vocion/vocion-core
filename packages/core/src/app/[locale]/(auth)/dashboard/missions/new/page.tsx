import { setRequestLocale } from 'next-intl/server';
import { MissionBriefForm } from '@/features/dashboard/MissionBriefForm';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listMissions } from '@/services/MissionService';

export default async function NewMissionPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { locale } = await props.params;
  const { template } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const templates = orgId ? await listMissions(orgId) : [];

  return (
    <>
      <TitleBar title="Start a mission" description="Brief the work in plain language. Your team will plan it, split it up, and run it under your review." />
      <div className="max-w-2xl">
        <MissionBriefForm
          templates={templates.map(t => ({ slug: t.slug, name: t.name }))}
          defaultTemplate={template}
        />
      </div>
    </>
  );
}
