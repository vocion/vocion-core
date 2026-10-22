'use client';

/**
 * TEACH A ROUTINE — the door on the Routines page. Three fields: what the work
 * is called, the site it is done on, and an optional note. Teach files the
 * routine and opens the site in a new tab. The person records the task there
 * with Slate (its hotkey or button: no web page can start Slate's extension, so
 * the routine's page says how, `teaching.instruction`), narrating why each step
 * happens, and stops; Vocion picks the recording up on its own
 * (`services/routines/teaching.ts`) while the routine's page shows where
 * teaching stands.
 *
 * The tab is opened blank inside the click, before the request — a window
 * opened after an `await` is a popup the browser blocks — and pointed at the
 * site when the answer comes back.
 */

import { GraduationCap } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * Point a window opened blank at an address, or close it when there is none.
 * @param win - The window, or null when the browser refused it.
 * @param url - Where it goes.
 */
function aim(win: Window | null, url: string | null | undefined) {
  if (!win) {
    return;
  }
  if (!url) {
    win.close();
    return;
  }
  try {
    win.opener = null;
    win.location.href = url;
  } catch {
    win.close();
  }
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * @param props - The button.
 * @param props.label - The button's words.
 * @param props.variant - Primary on the page header, outline in an empty state.
 */
export function TeachRoutineButton({ label = 'Teach a routine', variant = 'default' }: { label?: string; variant?: 'default' | 'outline' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const uid = useId();
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteUrl = site.trim() && !/^https?:\/\//i.test(site.trim()) ? `https://${site.trim()}` : site.trim();
  const ready = name.trim().length >= 3 && (siteUrl === '' || looksLikeUrl(siteUrl));

  const teach = () => {
    if (!ready || busy) {
      return;
    }
    // Opened now, inside the click, so the browser lets them through.
    const siteWin = siteUrl ? window.open('about:blank', '_blank') : null;
    setBusy(true);
    setError(null);
    void client.routines.teach({ name: name.trim(), ...(siteUrl ? { targetUrl: siteUrl } : {}), ...(note.trim() ? { note: note.trim() } : {}) })
      .then((res) => {
        if (!res.routine) {
          aim(siteWin, null);
          setError(res.error ?? 'It did not start.');
          return;
        }
        aim(siteWin, res.routine.teaching?.targetUrl ?? siteUrl);
        setOpen(false);
        router.push(`/dashboard/routines/${res.routine.id}`);
      })
      .catch(() => {
        aim(siteWin, null);
        setError('That did not go through. Try again.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)} data-routine-teach-open>
        <GraduationCap className="size-3.5" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={o => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Teach a routine</DialogTitle>
            <DialogDescription>
              Do the task once on the site while Slate records, and say why each step happens as you go. Stop the recording when you are done; Vocion reads it and drafts the routine for its expert to approve.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              teach();
            }}
            data-routine-teach-form
          >
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-name`} className="block text-[13px] font-medium text-foreground">What is the work called?</label>
              <Input id={`${uid}-name`} value={name} onChange={e => setName(e.target.value)} placeholder="Add a user and enroll them" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-site`} className="block text-[13px] font-medium text-foreground">The site you’ll teach on</label>
              <Input id={`${uid}-site`} value={site} onChange={e => setSite(e.target.value)} placeholder="https://console.example.com" inputMode="url" aria-invalid={siteUrl !== '' && !looksLikeUrl(siteUrl)} />
              <span className="block text-[12px] text-muted-foreground">It opens in a new tab; record the task there with Slate.</span>
            </div>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-foreground">
                Anything to know first?
                {' '}
                <span className="font-normal text-muted-foreground">Optional</span>
              </span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Who does this today, how often, what goes wrong…"
                className="w-full resize-none rounded-lg bg-surface-soft px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground/70 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-foreground/10"
              />
            </label>
            {error && <p className="text-[12px] text-brand-fail" role="alert">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!ready || busy} data-routine-teach>
                {busy ? 'Opening…' : 'Teach'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
