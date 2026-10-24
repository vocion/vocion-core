'use client';

/**
 * One key on System Keys (System) or Workspace Keys (Developers): a bordered
 * card with the service's mark, its name and one line on what it is for, a
 * Connected pill or a Connect button, and the key itself — write-only, so a
 * saved key shows as dots and its last four characters, never read back.
 *
 * Presentational: the caller owns saving and removing. More keys are more of
 * these cards, stacked.
 */

import type { LucideIcon } from 'lucide-react';
import type { Tint } from '@/libs/tints';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LetterTile } from '@/components/ui/letter-tile';

export type ApiKeyCardProps = {
  /** The service, in bold: "Jev by TypeSafe". */
  name: string;
  /** One sentence on what the key gets you. */
  blurb: string;
  icon?: LucideIcon;
  tint?: Tint;
  /** A short muted line under the blurb, e.g. "Overrides the instance key". */
  note?: string | null;
  /** The saved key's hint (`…abcd`), or null when there is none at this level. */
  hint: string | null;
  /** Where the key came from: saved here (removable) or the server environment. */
  source: 'saved' | 'env' | null;
  /** Where the key is made and reset: `{ href, label }`. */
  console: { href: string; label: string };
  canEdit: boolean;
  /** Why it cannot be set here, when it cannot (shown instead of the field). */
  lock: string | null;
  busy: boolean;
  error: string | null;
  /** Save `key` at this level; resolves true when it was saved. */
  onSave: (key: string) => Promise<boolean>;
  onRemove: () => Promise<void>;
  testId?: string;
};

/**
 * `••••••••••••••••abcd` for a hint `…abcd`. Pure.
 * @param hint - The key's hint.
 */
const maskedKey = (hint: string): string => `${'•'.repeat(16)}${hint.replace(/^…/, '')}`;

export function ApiKeyCard(props: ApiKeyCardProps) {
  const id = useId();
  const formId = `${id}-form`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const connected = props.hint !== null;
  const editable = props.canEdit && !props.lock;
  const showField = editable && (!connected || editing);

  // "Remove and replace" opens the field: put the cursor in it.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  function cancel() {
    setEditing(false);
    setKey('');
  }

  async function submit() {
    if (!key.trim()) {
      inputRef.current?.focus();
      return;
    }
    if (await props.onSave(key)) {
      setKey('');
      setEditing(false);
    }
  }

  const external = (
    <a href={props.console.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2 hover:text-primary">
      {props.console.label}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid={props.testId}>
      <div className="flex items-start gap-3.5">
        <LetterTile name={props.name} icon={props.icon} tint={props.tint} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-foreground">{props.name}</div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{props.blurb}</p>
          {props.note && <p className="mt-1 text-[12px] text-muted-foreground/80">{props.note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {connected && (
            <span className="inline-flex h-7 items-center rounded-md bg-pass-soft px-2.5 text-[12px] font-medium text-pass">Connected</span>
          )}
          {editable && !connected && (
            <Button type="submit" form={formId} size="sm" disabled={props.busy}>Connect</Button>
          )}
          {editable && connected && editing && (
            <Button type="button" size="sm" variant="ghost" disabled={props.busy} onClick={cancel}>Cancel</Button>
          )}
        </div>
      </div>

      {(connected || showField) && (
        <div className="mt-5">
          <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">API key</div>
          {showField
            ? (
                <form
                  id={formId}
                  className="mt-1.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <Input
                    ref={inputRef}
                    aria-label={`${props.name} API key`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste your API key"
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    className="border-border bg-background font-mono placeholder:font-sans"
                  />
                  {editing && <Button type="submit" size="sm" className="h-9" disabled={props.busy || !key.trim()}>Save</Button>}
                </form>
              )
            : (
                <div className="mt-1.5 flex h-9 items-center rounded-lg border border-border bg-background px-3 font-mono text-[13px] tracking-wide text-foreground select-none" aria-label={`${props.name} API key, ending ${props.hint!.replace(/^…/, '')}`}>
                  {maskedKey(props.hint!)}
                </div>
              )}
          <p className="mt-2 text-[12px] text-muted-foreground">
            {connected && props.source === 'env'
              ? 'Set in the server environment (TYPESAFE_API_KEY). A key saved here takes its place. '
              : connected ? 'Your API key is stored securely. ' : ''}
            {connected ? 'You can reset it at ' : 'Get a key at '}
            {external}
          </p>
        </div>
      )}

      {props.lock && <p className="mt-4 text-[12px] text-muted-foreground">{props.lock}</p>}
      {!props.canEdit && !props.lock && <p className="mt-4 text-[12px] text-muted-foreground">An admin sets this key.</p>}

      {editable && connected && !editing && (
        <button type="button" className="mt-4 cursor-pointer text-[13px] text-fail underline underline-offset-2 hover:opacity-80" onClick={() => setEditing(true)}>
          {props.source === 'saved' ? 'Remove and replace' : 'Replace'}
        </button>
      )}
      {editable && editing && props.source === 'saved' && (
        <button type="button" className="mt-4 cursor-pointer text-[13px] text-fail underline underline-offset-2 hover:opacity-80 disabled:opacity-50" disabled={props.busy} onClick={() => void props.onRemove().then(() => setEditing(false))}>
          Remove key
        </button>
      )}
      {props.error && <p className="mt-3 text-[13px] text-fail" role="alert">{props.error}</p>}
    </div>
  );
}
