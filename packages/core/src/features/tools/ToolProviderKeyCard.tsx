'use client';

/**
 * Pasting the provider key a tool spends, from the tool's own page.
 *
 * A workspace should not have to know that "web search costs money" and "API
 * credentials" are the same subject: the key goes in where the tool is, and
 * lands in the org's API credentials like every other stored key. Rotating or
 * revoking it afterwards happens on the credentials page, which is why this
 * card links there rather than growing its own copy of that surface.
 *
 * These platforms hold one live key per org, so saving a second replaces the
 * first the instant it is stored. The card says that before the click rather
 * than after it.
 */

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/** One input the platform's credential is made of, as the page passes it in. */
export type ToolProviderKeyField = {
  name: string;
  label: string;
  shapeHint: string;
  secret: boolean;
};

type ToolProviderKeyCardProps = {
  /** Credential platform this key is stored under, e.g. `tavily`. */
  platformId: string;
  /** Platform name as people know it, e.g. `Tavily`. */
  platformLabel: string;
  /** One line of guidance from the platform registry. */
  helpText: string;
  /** The inputs to render, in form order. */
  fields: readonly ToolProviderKeyField[];
  /** Masked hint of the key already on file, or null when there is none. */
  storedKeyHint: string | null;
  /**
   * Whether the deployment itself has a key for this platform.
   *
   * Without it the card cannot tell "you are running on our key" from "nobody
   * has a key at all" — and promising the first while the readiness badge says
   * "Needs key" contradicts the page the card sits on.
   */
  serverHasKey: boolean;
};

/**
 * Whether every field has something in it.
 *
 * A partly filled credential is never worth sending: the platform validates
 * the whole set, so an empty field would come back as an error the page can
 * answer on its own.
 * @param fields - The fields being asked for.
 * @param values - What has been typed so far, keyed by field name.
 */
function everyFieldFilled(
  fields: readonly ToolProviderKeyField[],
  values: Record<string, string>,
): boolean {
  return fields.every(field => (values[field.name] ?? '').trim().length > 0);
}

/**
 * The provider-key card for one tool.
 * @param props - See {@link ToolProviderKeyCardProps}.
 */
export function ToolProviderKeyCard(props: ToolProviderKeyCardProps) {
  const { platformId, platformLabel, helpText, fields, storedKeyHint, serverHasKey } = props;
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasStoredKey = storedKeyHint !== null;
  const saveLabel = hasStoredKey ? 'Replace key' : 'Save key';

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!everyFieldFilled(fields, values)) {
      setError(`Paste your ${platformLabel} key first.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await client.apiTokens.createPlatformKey({
        name: `${platformLabel} — tools`,
        platform: platformId,
        values,
      });
      setValues({});
      // The readiness badge and the stored-key hint are both rendered on the
      // server, so the page has to be re-fetched for either to change.
      router.refresh();
    } catch (err) {
      console.error('[ToolProviderKeyCard] could not save the provider key', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not save the key.');
    }
    setSaving(false);
  };

  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {platformLabel}
          {' '}
          key
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{helpText}</p>

      {hasStoredKey
        ? (
            <p className="mb-3 text-xs text-muted-foreground">
              This workspace is using its own key (
              <span className="font-mono">{storedKeyHint}</span>
              ). Saving another one replaces the key on file, and the old one stops being used
              immediately.
            </p>
          )
        : (
            <p className="mb-3 text-xs text-muted-foreground">
              {serverHasKey
                ? 'No key from this workspace yet, so calls run on the Vocion server key. Paste your own to bill your account instead.'
                : 'Nobody has a key for this yet, so the tool cannot run. Paste yours to turn it on for this workspace.'}
            </p>
          )}

      <form onSubmit={onSave} className="flex flex-col gap-3">
        {fields.map(field => (
          <div key={field.name} className="flex flex-col gap-1">
            <Label htmlFor={`tool-key-${platformId}-${field.name}`} className="text-xs">
              {field.label}
            </Label>
            <Input
              id={`tool-key-${platformId}-${field.name}`}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={field.shapeHint}
              value={values[field.name] ?? ''}
              onChange={event => setValues({ ...values, [field.name]: event.target.value })}
            />
          </div>
        ))}

        {error !== null && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
          <Link href="/dashboard/api-tokens" className="text-xs text-muted-foreground hover:text-foreground">
            Manage in API credentials
          </Link>
        </div>
      </form>
    </section>
  );
}
