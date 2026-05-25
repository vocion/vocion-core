import { ScrollText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';

/**
 * Placeholder shipped in v0.5.0 PR1 (sidebar reorg). The real list +
 * detail pages land in PR2 — they consume the existing
 * `routers/Playbooks.ts` `list()` + `get()` endpoints. Backend is
 * complete; this file is just keeping the nav slot non-404 while the
 * UI follows.
 * @param props
 * @param props.params
 */
export default async function PlaybooksPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScrollText className="size-5" />
            </div>
            <span>Playbooks</span>
          </div>
        )}
        description="Markdown + YAML procedural guides agents read on demand."
      />
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Coming soon — list + detail pages (v0.5.0 PR2). Backend (
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">routers/Playbooks.ts</code>
          ) ships today.
        </p>
      </div>
    </>
  );
}
