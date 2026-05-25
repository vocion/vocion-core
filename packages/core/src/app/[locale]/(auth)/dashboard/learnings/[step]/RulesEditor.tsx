'use client';

import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';

type Rule = {
  id: number;
  ruleText: string;
  source: string | null;
  createdBy: string | null;
  createdAt: string;
};

type Props = {
  step: string;
  initialRules: Rule[];
};

/**
 * Inline CRUD for learning rules. Talks to:
 *   POST   /api/v1/learnings/<step>/rules
 *   PATCH  /api/v1/learnings/<step>/rules/<ruleId>
 *   DELETE /api/v1/learnings/<step>/rules/<ruleId>
 *
 * Mutations call `router.refresh()` so the server-rendered list re-fetches
 * after each change — no client-side cache to sync.
 * @param root0
 * @param root0.step
 * @param root0.initialRules
 */
export function RulesEditor({ step, initialRules }: Props) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/learnings/${encodeURIComponent(step)}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: newText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      const added = await res.json();
      setRules(r => [...r, { ...added, createdAt: added.createdAt }]);
      setNewText('');
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(ruleId: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/learnings/${encodeURIComponent(step)}/rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleText: draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      const updated = await res.json();
      setRules(rs => rs.map(r => (r.id === ruleId ? { ...r, ruleText: updated.ruleText } : r)));
      setEditingId(null);
      setDraft('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(ruleId: number) {
    // eslint-disable-next-line no-alert -- native confirm is sufficient for the v0.5 floor; replace with a modal in v0.5.1
    if (!confirm('Remove this rule? This is irreversible.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/learnings/${encodeURIComponent(step)}/rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      setRules(rs => rs.filter(r => r.id !== ruleId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">
          Rules (
          {rules.length}
          )
        </h2>
        {!adding && (
          <button
            type="button"
            className={buttonVariants({ size: 'sm' })}
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
          >
            <Plus className="mr-2 size-4" />
            Add rule
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={onAdd} className="mb-4 rounded-xl border border-primary/30 bg-background p-4 ring-1 ring-primary/10">
          <textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            rows={3}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            placeholder="One-paragraph directive — what to do, when, why."
          />
          <div className="mt-3 flex items-center gap-2">
            <button type="submit" disabled={busy || newText.trim().length === 0} className={buttonVariants({ size: 'sm' })}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
              Save
            </button>
            <button
              type="button"
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              onClick={() => {
                setAdding(false);
                setNewText('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {rules.length === 0 && !adding
        ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
              No rules yet. Click
              {' '}
              <strong className="font-semibold text-foreground">Add rule</strong>
              {' '}
              to author one, or let the self-improver propose them.
            </div>
          )
        : (
            <ul className="space-y-3">
              {rules.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <li key={r.id} className="rounded-xl border border-border bg-background p-4">
                    {isEditing
                      ? (
                          <div>
                            <textarea
                              value={draft}
                              onChange={e => setDraft(e.target.value)}
                              rows={3}
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy || draft.trim().length === 0}
                                onClick={() => onSaveEdit(r.id)}
                                className={buttonVariants({ size: 'sm' })}
                              >
                                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                                Save
                              </button>
                              <button
                                type="button"
                                className={buttonVariants({ size: 'sm', variant: 'outline' })}
                                onClick={() => {
                                  setEditingId(null);
                                  setDraft('');
                                }}
                              >
                                <X className="mr-2 size-4" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        )
                      : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <p className="flex-1 text-sm whitespace-pre-wrap">{r.ruleText}</p>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(r.id);
                                    setDraft(r.ruleText);
                                    setError(null);
                                  }}
                                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  aria-label="Edit"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDelete(r.id)}
                                  className="rounded p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                  aria-label="Remove"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono">
                                #
                                {r.id}
                              </span>
                              <span aria-hidden>·</span>
                              <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                              {r.source && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="font-mono">
                                    source:
                                    {r.source}
                                  </span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}
