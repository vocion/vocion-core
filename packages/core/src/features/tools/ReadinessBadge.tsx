import { Check, CircleHelp, TriangleAlert } from 'lucide-react';

/**
 * The one-word verdict on whether a tool can run, shown on the Tools list and
 * on each tool's own page.
 *
 * Three states, not two, and the third is the reason this is a component
 * rather than two lines of inline markup in each page. "We could not read the
 * key this workspace has on file" is not "this workspace needs a key": an
 * admin who reads "Needs key" goes and stores one, which is precisely the
 * wrong move when a key is already there and the store is what is broken. The
 * new key would land beside the unreadable one and the next call would still
 * refuse, because the call path will not fall back to the server's key while
 * an org key might exist.
 *
 * So that state says it cannot check, and says nothing about readiness either
 * way.
 * @param props
 * @param props.ready - Whether the capability can run right now.
 * @param props.keyStateUnknown - Whether the credential store refused to say
 * what this workspace holds, which overrides `ready` entirely.
 */
export function ReadinessBadge(props: { ready: boolean; keyStateUnknown: boolean }) {
  if (props.keyStateUnknown) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <CircleHelp className="size-3" />
        Can't check
      </span>
    );
  }
  if (props.ready) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" />
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
      <TriangleAlert className="size-3" />
      Needs key
    </span>
  );
}
