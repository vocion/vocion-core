import { Check, CircleHelp, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TONE } from '@/components/ui/status-pill';
import { cn } from '@/utils/Helpers';

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
      <Badge className={cn('text-[10px]', TONE.neutral.bg, TONE.neutral.fg)}>
        <CircleHelp className="size-3" />
        Can't check
      </Badge>
    );
  }
  if (props.ready) {
    return (
      <Badge className={cn('text-[10px]', TONE.pass.bg, TONE.pass.fg)}>
        <Check className="size-3" />
        Ready
      </Badge>
    );
  }
  return (
    <Badge className={cn('text-[10px]', TONE.amber.bg, TONE.amber.fg)}>
      <TriangleAlert className="size-3" />
      Needs key
    </Badge>
  );
}
