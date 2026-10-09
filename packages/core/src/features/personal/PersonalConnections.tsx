'use client';

import type { PersonalConnectionRow } from '@/services/personal/connections';
import { useCallback, useEffect, useState } from 'react';
import { IntegrationLogo, ListRow, ListRows, Subline } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { readConnectOutcome } from '@/features/dashboard/connectOutcome';
import { connectFailureSummary } from '@/libs/connect/attemptWording';
import { client } from '@/libs/Orpc';

type Status = Awaited<ReturnType<typeof client.personal.connections>>;

/** Where the vendor sends the person back to: this page. */
const RETURN_TO = '/dashboard/connectors';

/**
 * The start route for one connection: the person's own login, with the vendor.
 * @param row - The connection.
 */
function connectHref(row: Pick<PersonalConnectionRow, 'provider' | 'connector'>): string {
  const params = new URLSearchParams({ connector: row.connector, returnTo: RETURN_TO });
  return `/api/connect/${row.provider}/start?${params}`;
}

/**
 * The day a connection was made, as "Oct 9".
 * @param at - When.
 */
function day(at: Date | string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(at));
}

/**
 * Personal → Connectors: the person's OWN accounts, connected for their own
 * assistant only (docs/guides/personal-connections.md). One row per thing
 * they can connect, each with the one move it needs — Connect, or Disconnect
 * — and what connecting it lets the assistant do. An Org admin sees the
 * Org's switch for personal connections beside the list it governs.
 */
export function PersonalConnections() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await client.personal.connections());
    } catch {
      setLine({ ok: false, text: 'Your connections could not be read just now. Reload to try again.' });
    }
  }, []);

  useEffect(() => {
    // The connect callback lands here with what happened; say it once, then clear the URL.
    const outcome = readConnectOutcome(window.location.search);
    if (outcome) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL on arrival
      setLine(outcome.ok
        ? { ok: true, text: 'Connected. Your assistant can read it now — only for you.' }
        : { ok: false, text: `${connectFailureSummary('The vendor', outcome.reason)}. Nothing was stored.` });
      const url = new URL(window.location.href);
      for (const key of ['connect', 'reason', 'source', 'connector']) {
        url.searchParams.delete(key);
      }
      window.history.replaceState(null, '', url);
    }
    void refresh();
  }, [refresh]);

  const disconnect = async (row: PersonalConnectionRow) => {
    setBusy(row.connector);
    setLine(null);
    try {
      await client.personal.disconnect({ connector: row.connector });
      setLine({ ok: true, text: row.provider === 'google' ? 'Google disconnected — Gmail, Calendar and Drive share one Google login. Nothing of it is kept.' : `${row.label} disconnected. Nothing of it is kept.` });
      await refresh();
    } catch {
      setLine({ ok: false, text: `${row.label} could not be disconnected just now. Try again.` });
    }
    setBusy(null);
  };

  const setPolicy = async (allowed: boolean) => {
    setBusy('policy');
    try {
      await client.personal.setPolicy({ allowed });
      await refresh();
    } catch {
      setLine({ ok: false, text: 'The Org setting could not be changed just now.' });
    }
    setBusy(null);
  };

  if (!status) {
    return line ? <p role="status" className="text-sm text-muted-foreground">{line.text}</p> : null;
  }

  return (
    <div className="max-w-3xl space-y-5" data-testid="personal-connections">
      <p className="text-[13px] text-muted-foreground">
        Your own accounts, read by your assistant and nobody else. Nothing from them is copied into a shared workspace, and your Org's admins cannot open them.
      </p>

      {line && (
        <p role="status" className={line.ok ? 'text-sm text-foreground' : 'text-sm text-brand-fail'}>{line.text}</p>
      )}

      {status.allowed
        ? (
            <ListRows>
              {status.connections.map(row => (
                <ListRow
                  key={row.connector}
                  data-testid={`personal-connection-${row.connector}`}
                  title={(
                    <span className="flex items-center gap-2.5">
                      <IntegrationLogo brand={row.brand} name={row.label} size="sm" />
                      {row.label}
                    </span>
                  )}
                  subline={(
                    <Subline
                      separator="·"
                      segments={row.account
                        ? [`Connected as ${row.account}`, row.connectedAt ? `since ${day(row.connectedAt)}` : null, row.unlocks]
                        : [row.available ? null : 'Not set up on this server yet', row.unlocks]}
                    />
                  )}
                  actionsAlways
                  actions={row.account
                    ? (
                        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void disconnect(row)}>
                          Disconnect
                        </Button>
                      )
                    : row.available
                      ? (
                          <Button asChild size="sm" variant="outline">
                            <a href={connectHref(row)}>Connect</a>
                          </Button>
                        )
                      : null}
                />
              ))}
            </ListRows>
          )
        : (
            <p className="text-sm text-muted-foreground" data-testid="personal-connections-off">
              Your Org has turned off personal connections, so your own accounts cannot be connected or read.
            </p>
          )}

      {status.canChangePolicy && (
        <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Let members connect their own accounts</p>
            <p className="text-xs text-muted-foreground">For everyone in your Org. Off stops every personal connection from being made or read.</p>
          </div>
          <Switch on={status.allowed} label="Let members connect their own accounts" disabled={busy !== null} onChange={on => void setPolicy(on)} />
        </div>
      )}
    </div>
  );
}
