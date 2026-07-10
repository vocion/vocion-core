import { desc, eq } from 'drizzle-orm';
import { Newspaper } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EmptyState } from '@/components/ui/empty-state';
import { BriefingChatStarter } from '@/features/dashboard/BriefingChatStarter';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { briefingSchema } from '@/models/Schema';

/**
 * Briefings — the daily front door. The morning automation's briefing check
 * publishes here (publish_briefing); the latest renders open, history below.
 * @param props
 * @param props.params
 */
export default async function BriefingsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const briefings = await db
    .select()
    .from(briefingSchema)
    .where(eq(briefingSchema.orgId, orgId))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(30);

  const [latest, ...history] = briefings;

  return (
    <>
      <TitleBar
        title="Briefings"
        description="The team's recurring reads — the morning revenue briefing lands here on its automation."
      />

      {!latest
        ? (
            <EmptyState
              icon={Newspaper}
              title="No briefings yet"
              description="The morning automation publishes the first one at its next fire — or run a check now from the briefing mission."
            />
          )
        : (
            <>
              <article className="mb-6 rounded-md border border-border p-6">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{latest.title}</h2>
                  <span className="text-xs text-muted-foreground">
                    {latest.createdAt.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {latest.publishedBy ? ` · ${latest.publishedBy}` : ''}
                  </span>
                </div>
                <div className="prose prose-sm mt-3 max-w-none dark:prose-invert">
                  <Markdown remarkPlugins={[remarkGfm]}>{latest.content}</Markdown>
                </div>
              </article>

              {history.length > 0 && (
                <section className="rounded-md border border-border p-5">
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Earlier</h3>
                  {history.map(b => (
                    <details key={b.id} className="border-b border-border py-2 last:border-0">
                      <summary className="cursor-pointer text-sm font-medium">
                        {b.title}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {b.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </summary>
                      <div className="prose prose-sm mt-2 max-w-none dark:prose-invert">
                        <Markdown remarkPlugins={[remarkGfm]}>{b.content}</Markdown>
                      </div>
                    </details>
                  ))}
                </section>
              )}

              <BriefingChatStarter briefingTitle={latest.title} briefingContent={latest.content} />
            </>
          )}
    </>
  );
}
