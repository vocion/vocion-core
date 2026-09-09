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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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
        setOpen(false);
        setStatus('idle');
      }, 900);
    } catch {
      setStatus('error');
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStatus('idle');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogTrigger
        className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-flex"
        aria-label="Send feedback"
      >
        <MessageSquareText className="size-4" aria-hidden />
        Feedback
      </DialogTrigger>
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
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
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
            className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
