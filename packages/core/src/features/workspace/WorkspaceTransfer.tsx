'use client';

import type { ImportPreview, ImportResult } from '@/services/workspace/WorkspaceImportService';
import { zipSync } from 'fflate';
import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApplyDiff } from '@/features/dashboard/ApplyDiff';

/** What was picked to import: a zip as it is, or a folder zipped here. */
type Picked = { name: string; zip: Blob; files: number | null };

/** The error envelope every `/api/v1` endpoint answers with. */
type ApiError = { error?: { message?: string } };

/**
 * Export and import, on the Context page's title row (admins only).
 *
 * Export is a download: the workspace as a zip of its files
 * (`GET /api/v1/workspace/export`). Import is review, then apply, the way the
 * drift banner applies a changed folder: pick a zip or a folder, choose merge
 * (the default — nothing here that the upload does not mention changes) or
 * replace, read the diff the dry run returns, and apply exactly that. Changing
 * the file or the mode after a review asks for a new one.
 */
export function WorkspaceTransfer() {
  const t = useTranslations('WorkspaceTransfer');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPicked(null);
    setReplace(false);
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const pickZip = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setPicked({ name: file.name, zip: file, files: null });
      setPreview(null);
      setError(null);
    }
  };

  const pickFolder = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const file of Array.from(files)) {
        entries[file.webkitRelativePath || file.name] = new Uint8Array(await file.arrayBuffer());
      }
      const folder = (files[0]!.webkitRelativePath || files[0]!.name).split('/')[0] ?? 'workspace';
      setPicked({ name: folder, zip: new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: 'application/zip' }), files: files.length });
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (fields: Record<string, string>): Promise<unknown> => {
    const form = new FormData();
    form.set('file', picked!.zip, `${picked!.name}.zip`);
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, value);
    }
    const res = await fetch('/api/v1/workspace/import', { method: 'POST', body: form });
    const body = await res.json().catch(() => null) as unknown;
    if (!res.ok) {
      throw new Error((body as ApiError | null)?.error?.message ?? t('failed', { status: res.status }));
    }
    return body;
  };

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await send({ replace: String(replace) }) as ImportPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDone(await send({ replace: String(replace), apply: 'true', sha: preview.sha }) as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeCount = preview ? preview.changes.length : 0;

  return (
    <>
      <Button asChild variant="outline" size="pill">
        <a href="/api/v1/workspace/export" download>
          <Download aria-hidden="true" />
          {t('export')}
        </a>
      </Button>
      <Button variant="outline" size="pill" onClick={() => setOpen(true)}>
        <Upload aria-hidden="true" />
        {t('import')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) {
            return;
          }
          setOpen(next);
          if (!next) {
            if (done) {
              window.location.reload();
            }
            reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {done
            ? (
                <div className="space-y-3 text-sm">
                  <p>{t('done', { count: done.changes.length })}</p>
                  {done.errors.length > 0 && (
                    <ul className="space-y-1 text-xs text-destructive">
                      {done.errors.map(e => <li key={`${e.resource}:${e.slug}`}>{`${e.resource} ${e.slug}: ${e.message}`}</li>)}
                    </ul>
                  )}
                </div>
              )
            : (
                <div className="space-y-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => zipInput.current?.click()}>{t('pick_zip')}</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => folderInput.current?.click()}>{t('pick_folder')}</Button>
                    <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" onChange={e => pickZip(e.target.files)} />
                    <input ref={folderInput} type="file" multiple className="hidden" onChange={e => void pickFolder(e.target.files)} {...{ webkitdirectory: '' }} />
                    {picked && (
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {picked.files === null ? picked.name : t('picked_folder', { name: picked.name, count: picked.files })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-start gap-2">
                    <input
                      id="workspace-import-replace"
                      type="checkbox"
                      className="mt-0.5 size-3.5 cursor-pointer accent-foreground"
                      checked={replace}
                      disabled={busy}
                      aria-describedby="workspace-import-replace-help"
                      onChange={(e) => {
                        setReplace(e.target.checked);
                        setPreview(null);
                      }}
                    />
                    <div>
                      <label htmlFor="workspace-import-replace" className="cursor-pointer font-medium">{t('replace')}</label>
                      <p id="workspace-import-replace-help" className="text-xs text-muted-foreground">{replace ? t('replace_help') : t('merge_help')}</p>
                    </div>
                  </div>

                  {preview && (
                    <div className="space-y-2">
                      <ApplyDiff counts={preview.counts} changes={preview.changes} />
                      {preview.unchanged > 0 && <p className="text-xs text-muted-foreground">{t('unchanged', { count: preview.unchanged })}</p>}
                      {preview.errors.length > 0 && (
                        <ul className="space-y-1 text-xs text-destructive">
                          {preview.errors.map(e => <li key={`${e.resource}:${e.slug}:${e.message}`}>{`${e.resource} ${e.slug}: ${e.message}`}</li>)}
                        </ul>
                      )}
                      {preview.blockedBy && <p className="text-xs text-destructive">{preview.blockedBy}</p>}
                    </div>
                  )}
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
              )}

          <DialogFooter>
            {done
              ? <Button onClick={() => window.location.reload()}>{t('close')}</Button>
              : (
                  <>
                    <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t('cancel')}</Button>
                    {preview && !preview.blockedBy && changeCount > 0
                      ? (
                          <Button onClick={apply} disabled={busy}>
                            {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                            {t('apply', { count: changeCount })}
                          </Button>
                        )
                      : (
                          <Button onClick={review} disabled={busy || !picked || (preview !== null && changeCount === 0)}>
                            {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                            {preview && changeCount === 0 ? t('nothing_to_apply') : t('review')}
                          </Button>
                        )}
                  </>
                )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
