'use client';

/**
 * The key that turns dynamic routing on (ADR 0006), at one level: the
 * instance (System) or this workspace (Developers). Write-only: the card shows
 * the last four characters of a saved key and never reads one back. Saving
 * replaces the key at that level; removing it falls back to the next level
 * (workspace → instance → off).
 */

import type { KeyOnFile, KeyScope } from '@/services/routing/jevKey';
import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { client } from '@/libs/Orpc';

export type JevKeyCardProps = {
  scope: KeyScope;
  /** The key saved or set at this level, or null. */
  onFile: KeyOnFile | null;
  /** What a run here uses when this level has no key: a sentence. */
  otherwise: string;
  /** Whether this viewer may save or remove it. */
  canEdit: boolean;
  /** Why it cannot be edited here, when it cannot (shown instead of the form). */
  lock: string | null;
  /** The pinned Jev model, e.g. typesafe/jev-1.13. */
  jevModel: string;
};

/**
 * The card's status sentence. Pure.
 * @param p - The card's props.
 */
export function jevKeyLine(p: Pick<JevKeyCardProps, 'scope' | 'onFile' | 'otherwise'>): string {
  const level = p.scope === 'instance' ? 'The instance key' : 'This workspace\'s key';
  if (!p.onFile) {
    return `No ${p.scope === 'instance' ? 'instance' : 'workspace'} key. ${p.otherwise}`;
  }
  if (p.onFile.source === 'env') {
    return `${level} comes from the server environment (TYPESAFE_API_KEY, ${p.onFile.hint}). A key saved here takes its place.`;
  }
  const when = p.onFile.updatedAt ? ` on ${p.onFile.updatedAt.slice(0, 10)}` : '';
  return `${level} is set (${p.onFile.hint}, ${p.onFile.provider === 'openrouter' ? 'an OpenRouter key' : 'TypeSafe'}), saved${when}.`;
}

export function JevKeyCard(props: JevKeyCardProps) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = props.onFile?.source === 'saved';

  async function act(kind: 'save' | 'remove') {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'save') {
        await client.routing.saveKey({ scope: props.scope, key });
        setKey('');
      } else {
        await client.routing.removeKey({ scope: props.scope });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-lg border border-border p-4" data-testid={`jev-key-${props.scope}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4" aria-hidden />
        {props.scope === 'instance' ? 'Jev (TypeSafe) API key — instance' : 'Jev (TypeSafe) API key — this workspace (override)'}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{jevKeyLine(props)}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        A Jev (TypeSafe) API key, from the TypeSafe console (an OpenRouter key, sk-or-…, also works). Jev (
        {props.jevModel}
        ) is asked before each factory run which engine, model and effort to use, from the seat&apos;s candidates. Without any key nothing calls Jev and routing is static.
      </p>
      {props.lock && <p className="mt-3 text-[13px]">{props.lock}</p>}
      {props.canEdit && !props.lock && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('save');
          }}
        >
          <div className="grid min-w-64 flex-1 gap-1">
            <Label htmlFor={`jev-key-${props.scope}-input`} className="text-xs">{saved ? 'New Jev (TypeSafe) API key' : 'Jev (TypeSafe) API key'}</Label>
            <Input id={`jev-key-${props.scope}-input`} type="password" autoComplete="off" spellCheck={false} placeholder="Paste the key" value={key} onChange={e => setKey(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={busy || !key.trim()}>{saved ? 'Replace Jev key' : 'Save Jev key'}</Button>
          {saved && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act('remove')}>Remove Jev key</Button>}
        </form>
      )}
      {!props.canEdit && !props.lock && <p className="mt-3 text-[13px] text-muted-foreground">An admin sets this key.</p>}
      {error && <p className="mt-2 text-[13px] text-fail" role="alert">{error}</p>}
    </div>
  );
}
