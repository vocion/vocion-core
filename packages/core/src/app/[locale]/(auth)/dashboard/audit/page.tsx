import { Activity } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function AuditPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title="Audit"
        description="Every context change, skill run, approval decision. Tied to context SHA + actor for full traceability."
      />

      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <Activity className="mx-auto mb-3 size-6 text-muted-foreground" />
        <div className="text-sm font-medium">Audit feed — not yet wired</div>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Every
          {' '}
          <code className="rounded bg-muted px-1">context:apply</code>
          {' '}
          already records a row in
          {' '}
          <code className="rounded bg-muted px-1">context_version</code>
          ; every skill run stamps the active context SHA. The feed here will surface that history once the query view ships.
        </p>
      </div>
    </>
  );
}
