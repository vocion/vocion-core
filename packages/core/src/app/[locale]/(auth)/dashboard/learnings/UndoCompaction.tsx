'use client';

import { Loader2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@/components/ui/toast';

/**
 * Undo on an approved merge or retirement: the rules it retired come back as
 * they were (they were expired, never deleted), and a merged rule goes. Talks
 * to the same endpoint an external panel uses — `POST
 * /api/v1/learning-candidates/:id/decide` with `action: "undo"`.
 * @param props - The decision to put back.
 * @param props.id - The candidate.
 * @param props.kind - What it did, for the toast.
 */
export function UndoCompaction(props: { id: number; kind: 'merge' | 'expire' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function undo() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/learning-candidates/${props.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      toast.success(props.kind === 'merge' ? 'Merge undone' : 'Retirement undone', { description: 'The rules are back as they were; agents read them on their next run.' });
      router.refresh();
    } catch (err) {
      toast.error('Could not undo', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void undo()}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline disabled:opacity-60"
      data-testid={`undo-compaction-${props.id}`}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
      Undo
    </button>
  );
}
