import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';

const exampleEvents = [
  { user: 'chris@metacto.com', action: 'connector.created', resource: 'Slack connector', time: '2 minutes ago' },
  { user: 'chris@metacto.com', action: 'domain.created', resource: 'Sales domain', time: '5 minutes ago' },
  { user: 'chris@metacto.com', action: 'object.created', resource: 'Account object', time: '8 minutes ago' },
  { user: 'chris@metacto.com', action: 'member.invited', resource: 'team@metacto.com', time: '15 minutes ago' },
  { user: 'chris@metacto.com', action: 'workspace.created', resource: 'CoreContext workspace', time: '1 hour ago' },
];

export default async function AuditPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Audit' });

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <DashboardSection
        title={t('section_recent')}
        description={t('section_recent_description')}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pr-4 pb-2 font-medium text-muted-foreground">{t('event_user')}</th>
                <th className="pr-4 pb-2 font-medium text-muted-foreground">{t('event_action')}</th>
                <th className="pr-4 pb-2 font-medium text-muted-foreground">{t('event_resource')}</th>
                <th className="pb-2 font-medium text-muted-foreground">{t('event_time')}</th>
              </tr>
            </thead>
            <tbody>
              {exampleEvents.map((event, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-3 pr-4 font-mono text-xs">{event.user}</td>
                  <td className="py-3 pr-4">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event.action}</code>
                  </td>
                  <td className="py-3 pr-4">{event.resource}</td>
                  <td className="py-3 text-muted-foreground">{event.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashboardSection>
    </>
  );
}
