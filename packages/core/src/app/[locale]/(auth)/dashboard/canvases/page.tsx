import { LayoutGrid } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listCanvases } from '@/services/ArtifactService';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/canvases — every canvas a person saved beside a conversation.
 * Re-open one to get the conversation back with that arrangement; export it
 * from there as a workspace page.
 * @param props
 * @param props.params
 */
export default async function CanvasesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const canvases = orgId ? await listCanvases({ orgId }) : [];

  return (
    <>
      <TitleBar title="Canvases" description="Working views saved beside a conversation — reopen one, or export it as a workspace page." />
      {canvases.length === 0
        ? (
            <div className="mt-8">
              <EmptyState icon={LayoutGrid} title="No canvases yet" description="Open a conversation full screen, arrange what the agent rendered, and save it here." />
            </div>
          )
        : (
            <ul className="mt-4 divide-y divide-border/70 rounded-lg border border-border">
              {canvases.map(c => (
                <li key={c.id}>
                  {c.conversationId
                    ? (
                        <Link href={`/dashboard/chat/${c.conversationId}?grid=open&canvas=${c.id}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-muted/40">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{c.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {c.tileCount}
                              {' '}
                              {c.tileCount === 1 ? 'tile' : 'tiles'}
                              {' '}
                              · saved
                              {' '}
                              {c.updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </span>
                          <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      )
                    : (
                        <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-muted-foreground">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{c.name}</span>
                            <span className="block text-xs">
                              conversation deleted ·
                              {c.tileCount}
                              {' '}
                              tiles
                            </span>
                          </span>
                        </div>
                      )}
                </li>
              ))}
            </ul>
          )}
    </>
  );
}
