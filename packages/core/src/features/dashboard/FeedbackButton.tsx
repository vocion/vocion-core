'use client';

import { MessageSquareText } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Header "Feedback" control — a small dialog that posts a note to the same
 * feedback endpoint Drive comments and the review queue use, so a remark made
 * here enters the learning loop like any other. Tagged with the page it was
 * written on.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <FeedbackDialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="hidden h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground md:inline-flex"
        aria-label="Send feedback"
      >
        <MessageSquareText className="size-4" aria-hidden />
        Feedback
      </DialogTrigger>
    </FeedbackDialog>
  );
}

/**
 * The feedback dialog itself, controlled — so a menu item (the account menu,
 * since 2026-09-18: the header lost its Feedback and Docs buttons) can open it
 * without owning a trigger. `children` is an optional trigger.
 * @param props
 * @param props.open
 * @param props.onOpenChange
 * @param props.children - An optional `DialogTrigger`.
 */
export function FeedbackDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children?: React.ReactNode }) {
  const pathname = usePathname();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function submit() {
    const note = text.trim();
    if (!note) {
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual', payload: { text: note, artifactTitle: `Dashboard feedback · ${pathname}` } }),
      });
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      setStatus('sent');
      setText('');
      setTimeout(() => {
        onOpenChange(false);
        setStatus('idle');
      }, 900);
    } catch {
      setStatus('error');
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setStatus('idle');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      {children}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            What's wrong, missing, or good on this page? It lands in the feedback queue with the page noted.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          placeholder="Tell us what happened…"
          className="w-full resize-none rounded-lg bg-surface-soft px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-foreground/10"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {status === 'sent' && 'Thanks — sent.'}
            {status === 'error' && 'Could not send. Try again.'}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={status === 'sending' || text.trim().length === 0}
            className="inline-flex h-9 items-center rounded-lg bg-action px-3.5 text-[13px] font-medium text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
