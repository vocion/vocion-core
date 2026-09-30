'use client';

import { Copy, Download, Loader2, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { announcementHtml, announcementImageFilename } from '@/libs/factory/announcementCopy';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * THE ANNOUNCEMENT'S ONE PRESS, with its picture (backlog 043).
 *
 * - `slack` — Post to Slack: `POST /api/v1/objects/:id/announce` runs
 *   `release.announce` as the person, which posts the words with the live
 *   screenshot uploaded beside them. The line under it says what happened —
 *   with its picture, or why without — and Undo deletes the post.
 * - `copy` — no Slack connection: Copy puts the announcement on the clipboard
 *   as rich text with the picture inside it (and plain text beside it), and
 *   the picture is a download of its own for a place that takes files.
 *
 * `published` draws only the Undo for a post a press made.
 */

type Props = {
  releaseId: number;
  title: string;
  text: string | null;
  imageUrl: string | null;
  mode: 'slack' | 'copy' | 'published';
  /** The `release.announce` run that published it, for Undo (`published` only). */
  runId?: number | null;
};

type Receipt = { kind: 'done'; line: string; runId: number | null } | { kind: 'info'; line: string } | { kind: 'error'; line: string };

/**
 * The picture's bytes as a data URL, so the paste carries the picture itself
 * rather than a link that needs a Vocion sign-in. Null when it cannot be read.
 * @param url - Where the page draws it from.
 */
async function dataUrlOf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      return null;
    }
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function ReleaseAnnouncePublish({ releaseId, title, text, imageUrl, mode, runId = null }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'post' | 'copy' | 'undo' | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const post = async () => {
    setBusy('post');
    try {
      const res = await fetch(`/api/v1/objects/${releaseId}/announce`, { method: 'POST', credentials: 'same-origin' });
      const body = await res.json().catch(() => ({})) as { runId?: number; status?: string; line?: string | null; error?: string | { message?: string } | null };
      if (body.status === 'done') {
        setReceipt({ kind: 'done', line: body.line ?? 'Posted to Slack.', runId: body.runId ?? null });
      } else if (body.status === 'pending') {
        setReceipt({ kind: 'info', line: body.line ?? 'Waiting on a person to publish it.' });
      } else {
        const why = typeof body.error === 'string' ? body.error : body.error?.message ?? null;
        setReceipt({ kind: 'error', line: why ? `Not posted: ${why}` : `Not posted: the server answered ${res.status}.` });
      }
      router.refresh();
    } catch (err) {
      setReceipt({ kind: 'error', line: `Not posted: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!text) {
      return;
    }
    setBusy('copy');
    try {
      const src = imageUrl ? (await dataUrlOf(imageUrl)) ?? new URL(imageUrl, window.location.href).toString() : null;
      const html = announcementHtml({ text, title, imageSrc: src });
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        setReceipt({ kind: 'info', line: imageUrl ? 'Copied with its picture. Paste it where the announcement goes; the picture is also a download.' : 'Copied. Paste it where the announcement goes.' });
      } else {
        await navigator.clipboard.writeText(text);
        setReceipt({ kind: 'info', line: imageUrl ? 'Copied the words only: this browser cannot copy a picture. Download it beside them.' : 'Copied. Paste it where the announcement goes.' });
      }
    } catch (err) {
      setReceipt({ kind: 'error', line: `Not copied: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const undo = async (id: number) => {
    setBusy('undo');
    try {
      await client.review.undoAction({ id });
      setReceipt({ kind: 'info', line: 'Undone: the Slack post is deleted and the announcement is unpublished.' });
      router.refresh();
    } catch (err) {
      setReceipt({ kind: 'error', line: `Not undone: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const undoId = receipt?.kind === 'done' ? receipt.runId : mode === 'published' ? runId : null;
  const spin = <Loader2 className="size-3.5 animate-spin" aria-hidden />;

  return (
    <div className="mt-3" data-testid="release-announce-publish" data-mode={mode}>
      {mode !== 'published' && receipt?.kind !== 'done' && (
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'slack'
            ? (
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => void post()} data-testid="release-announce-slack">
                  {busy === 'post' ? spin : <Send className="size-3.5" aria-hidden />}
                  Post to Slack
                </Button>
              )
            : (
                <Button type="button" size="sm" disabled={busy !== null || !text} onClick={() => void copy()} data-testid="release-announce-copy">
                  {busy === 'copy' ? spin : <Copy className="size-3.5" aria-hidden />}
                  {imageUrl ? 'Copy with picture' : 'Copy'}
                </Button>
              )}
          {mode === 'copy' && imageUrl && (
            <a href={imageUrl} download={announcementImageFilename(title, null)} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="release-announce-download">
              <Download className="size-3.5" aria-hidden />
              Download picture
            </a>
          )}
        </div>
      )}
      {(receipt || undoId) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px]" role="status" data-testid="release-announce-receipt">
          {receipt && <span className={receipt.kind === 'error' ? 'text-[var(--brand-fail)]' : 'text-muted-foreground'}>{receipt.line}</span>}
          {undoId && (
            <button type="button" disabled={busy !== null} onClick={() => void undo(undoId)} className="inline-flex items-center gap-1 text-foreground underline underline-offset-2" data-testid="release-announce-undo">
              {busy === 'undo' ? spin : <RotateCcw className="size-3" aria-hidden />}
              Undo
            </button>
          )}
        </p>
      )}
    </div>
  );
}
