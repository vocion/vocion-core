'use client';

import { AlertTriangle, Loader2, PencilLine } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * Edit the operating intent, through the action rail rather than around it.
 *
 * The person edits `operating-intent.yaml` as text and states why. Saving
 * does not write the file: it proposes `workspace.write_operating_intent`,
 * which lands as a reviewable, undoable `action_run`. A change of direction
 * is a decision, and a decision that left no record is one nobody can ask
 * about a month later.
 *
 * The reason field is required here for the same reason it is required on the
 * action: the diff says what changed and only a person can say why.
 * @param props - The editor's inputs.
 * @param props.initialText - The file as it stands, or the empty string when it has not been authored.
 * @param props.blocker - Why it cannot be edited from this host, when it cannot.
 */
export function OperatingIntentEditor({ initialText, blocker }: {
  /** The file as it stands, or the empty string when it has not been authored. */
  initialText: string;
  /** Why it cannot be edited from this host, when it cannot. */
  blocker: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initialText);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'working' | 'proposed' | 'error'; message?: string; runId?: number }>({ kind: 'idle' });

  if (blocker) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border p-4 text-[13px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          This intent cannot be edited from here:
          {' '}
          {blocker}
          . Edit
          {' '}
          <code>operating-intent.yaml</code>
          {' '}
          in the workspace repository and apply it there.
        </span>
      </div>
    );
  }

  const propose = async () => {
    if (reason.trim() === '') {
      setState({ kind: 'error', message: 'Say why this changed. The diff shows what; only you can say why.' });
      return;
    }
    setState({ kind: 'working' });
    try {
      const res = await client.review.propose({
        actionId: 'workspace.write_operating_intent',
        input: { content: text, reason: reason.trim() },
        rationale: reason.trim(),
        // A person asked for this, so the card carries no machine verdict.
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      setState({ kind: 'proposed', runId: res.runId });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilLine className="size-4" />
        {initialText === '' ? 'State the intent' : 'Edit the intent'}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <p className="text-[13px] text-muted-foreground">
        This edits
        {' '}
        <code>operating-intent.yaml</code>
        {' '}
        in the workspace. Saving proposes the change on the review queue, so it lands as a decision with your reason on it and the previous text one Undo away.
      </p>
      <textarea
        aria-label="operating-intent.yaml"
        className="h-96 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs"
        value={text}
        onChange={e => setText(e.target.value)}
        spellCheck={false}
      />
      <input
        aria-label="Why this changed"
        className="w-full rounded-md border border-border bg-background p-2 text-[13px]"
        placeholder="Why this changed, in one sentence"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={propose} disabled={state.kind === 'working' || state.kind === 'proposed'}>
          {state.kind === 'working' && <Loader2 className="size-4 animate-spin" />}
          Propose the change
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {state.kind === 'proposed' && (
        <p className="text-[13px] text-muted-foreground">
          Proposed as run
          {' '}
          {state.runId}
          . Approve it on the Review queue and the workspace applies; nothing has changed yet.
        </p>
      )}
      {state.kind === 'error' && (
        <p className="text-[13px] text-destructive">{state.message}</p>
      )}
    </div>
  );
}
