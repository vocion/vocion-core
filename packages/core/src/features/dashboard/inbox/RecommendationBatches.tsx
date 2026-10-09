'use client';

import type { BatchResult, RecommendationBatch } from '@/services/needsYou/batches';
import { ChevronRight, Layers, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListRows } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { batchMakeup, batchReceipt } from './batchText';
import { INBOX_KIND_META } from './inboxMeta';
import { withMinimumPending } from './pending';

/**
 * Accept in one move: the decisions in view that carry the same
 * recommendation, gathered (`services/needsYou/batches.ts`). Twenty-four
 * approvals that each recommend "Approve" are one judgement; this is where it
 * is made once.
 *
 * One line per batch, on the list's own hairlines: what they recommend, how
 * many, what kinds they are. The items are one click away under the line —
 * hidden, never unreachable — and Accept decides each as recommended, as the
 * person, through the same services a row's quick verbs use. Visibly pending
 * while it runs; the toast says what was accepted and, item by item, what was
 * skipped or failed and why.
 * @param props - The batches, and the accept seam.
 * @param props.batches - From `recommendationBatches`, largest first.
 * @param props.accept - Seam for stories and tests; defaults to `inbox.acceptBatch`.
 */
export function RecommendationBatches({ batches, accept }: { batches: RecommendationBatch[]; accept?: (key: string, refs: string[]) => Promise<BatchResult> }) {
  if (batches.length === 0) {
    return null;
  }
  return (
    <section data-testid="inbox-batches" aria-label="Accept in one move" className="mb-3 sm:mb-4">
      <p className="mb-1 hidden px-2 text-[11px] text-muted-foreground/70 sm:block">Same recommendation — accept in one move</p>
      <ListRows className="border-y border-border/70">
        {batches.map(batch => <BatchLine key={batch.key} batch={batch} accept={accept ?? defaultAccept} />)}
      </ListRows>
    </section>
  );
}

function defaultAccept(key: string, refs: string[]): Promise<BatchResult> {
  return client.inbox.acceptBatch({ key, refs });
}

function BatchLine({ batch, accept }: { batch: RecommendationBatch; accept: (key: string, refs: string[]) => Promise<BatchResult> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  async function acceptAll() {
    setBusy(true);
    setReceipt(null);
    try {
      const result = await withMinimumPending(accept(batch.key, batch.items.map(i => i.ref)));
      const r = batchReceipt(batch.label, result);
      (r.ok ? toast.success : toast.error)(r.title, { description: r.description });
      setReceipt(`${r.title}. ${r.description}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Could not accept “${batch.label}”`, { description: message });
      setReceipt(`Could not accept: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="inbox-batch" data-batch={batch.key}>
      <div className="flex min-h-11 items-center gap-3 px-2 py-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} the ${batch.count} decisions recommending “${batch.label}”`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">
              {batch.count}
              {' recommend “'}
              {batch.label}
              ”
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{batchMakeup(batch)}</span>
          </span>
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        </button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void acceptAll()}
          data-testid="inbox-batch-accept"
          aria-label={`Accept all ${batch.count} as “${batch.label}”`}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {`Accept all ${batch.count}`}
        </Button>
      </div>
      {open && (
        <ul className="border-t border-border/60 py-1 pl-9" data-testid="inbox-batch-items">
          {batch.items.map(item => (
            <li key={item.ref} className="py-1 text-[13px]">
              <Link href={item.href} className="hover:underline">{item.title}</Link>
              <span className="ml-2 text-muted-foreground">{INBOX_KIND_META[item.kind]?.label ?? item.kind}</span>
            </li>
          ))}
        </ul>
      )}
      {receipt && <p role="status" className="px-9 pb-2 text-[12px] text-muted-foreground">{receipt}</p>}
    </div>
  );
}
