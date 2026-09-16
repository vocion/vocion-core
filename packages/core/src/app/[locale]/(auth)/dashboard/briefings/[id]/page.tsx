import type { InboxItem } from '@/services/InboxService';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BriefingChatStarter } from '@/features/dashboard/BriefingChatStarter';
import { BriefingView } from '@/features/dashboard/briefings/BriefingView';
import { BriefingSections } from '@/features/dashboard/BriefingSections';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { briefingHistory, getBriefing } from '@/services/briefings/store';
import { listInbox } from '@/services/InboxService';

/**
 * One briefing (`docs/specs/briefing-v2.md`).
 *
 * The page renders the TYPED document when the row carries one — nine
 * sections, in the spec's order, every empty one absent — and falls back to
 * the stored markdown when it does not, so briefs published before v2 still
 * read. Nothing on this page decides what to show: `renderedSections`,
 * `firstScreen` and the validator did that before the row was stored.
 *
 * The decision cards are re-read against the LIVE inbox at request time, so a
 * decision made between the brief being written and being read shows as made
 * rather than as still waiting.
 * @param props
 * @param props.params
 */
export default async function BriefingPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <>
        <TitleBar title="Briefing" />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to an organization to read briefings.</div>
      </>
    );
  }

  const numeric = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    notFound();
  }
  const brief = await getBriefing(orgId, numeric);
  if (!brief) {
    notFound();
  }

  const doc = brief.document;
  let liveDecisions: InboxItem[] = [];
  if (doc?.decisions && doc.decisions.judgment.length > 0) {
    const keys = new Set(doc.decisions.judgment.map(c => c.key));
    const inbox = await listInbox(orgId, { tab: 'open' });
    liveDecisions = inbox.items.filter(i => keys.has(i.key));
  }

  // A pre-v2 row has no history section of its own; give it the same preview.
  const history = doc ? null : await briefingHistory(orgId, brief.teamSlug, { excludeId: brief.id });

  return (
    <>
      {/* A typed brief is a Detail page and carries its own crumbs and H1;
          a pre-v2 markdown brief has no header of its own, so it gets one. */}
      {doc
        ? <BriefingView doc={doc} liveDecisions={liveDecisions} />
        : (
            <>
              <TitleBar
                title={brief.title}
                description={brief.createdAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              />
              <div data-briefing-root className="prose prose-sm max-w-none dark:prose-invert">
                <BriefingSections briefingId={brief.id} briefingTitle={brief.title} content={brief.content} agentSlug={brief.agentSlug ?? undefined} />
                {history && history.entries.length > 0 && (
                  <p className="not-prose mt-6 text-[13px] text-muted-foreground">
                    {`${history.total} briefings in all.`}
                  </p>
                )}
              </div>
            </>
          )}
      <BriefingChatStarter
        briefingId={brief.id}
        briefingTitle={doc?.title ?? brief.title}
        briefingContent={brief.content}
        agentSlug={brief.agentSlug ?? undefined}
      />
    </>
  );
}
