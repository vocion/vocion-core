import { cn } from '@/utils/Helpers';

/**
 * A record's or core noun's CODE — FE-294, RUN-439 — as every surface draws
 * it: muted, tabular, ahead of the title it names (`libs/codes.ts`). One
 * shape, so a code reads the same on a row, a card, a header and a chip.
 * @param props
 * @param props.code - The code; nothing is drawn without one.
 * @param props.className - Extra classes.
 */
export function RecordCode({ code, className }: { code: string | null | undefined; className?: string }) {
  if (!code) {
    return null;
  }
  return <span className={cn('shrink-0 font-normal text-muted-foreground tabular-nums', className)} data-testid="record-code">{code}</span>;
}
