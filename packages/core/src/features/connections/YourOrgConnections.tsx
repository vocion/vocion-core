'use client';

import { Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ListRow, ListRows, Subline } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { client } from '@/libs/Orpc';

type Row = Awaited<ReturnType<typeof client.personal.yourConnections>>['connections'][number];

/**
 * In a person's own Personal: every server their Org declares that answers
 * each person as themselves (`services/outboundMcp/followingSources.ts`). A
 * signed-in one joins every turn they start in the Org's workspaces unless
 * they turn "Use in every workspace" off; one they have not signed in to
 * offers its sign-in here. Nothing to show, nothing drawn.
 */
export function YourOrgConnections() {
  const t = useTranslations('Connectors');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows((await client.personal.yourConnections()).connections);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  if (!rows || rows.length === 0) {
    return null;
  }

  const change = async (row: Row, on: boolean) => {
    setError(null);
    setRows(rows.map(r => (r.slug === row.slug ? { ...r, everyWorkspace: on } : r)));
    try {
      await client.personal.setEveryWorkspace({ slug: row.slug, on });
    } catch {
      setError(t('yours_change_failed', { name: row.name }));
      void refresh();
    }
  };

  return (
    <section data-testid="your-org-connections" className="mt-8">
      <h2 className="mb-1 text-xs font-medium text-muted-foreground">{t('yours_heading')}</h2>
      <p className="mb-2 max-w-2xl text-xs text-muted-foreground">{t('yours_line')}</p>
      <ListRows>
        {rows.map(row => (
          <ListRow
            key={row.slug}
            icon={Plug}
            title={row.name}
            subline={(
              <Subline
                segments={[
                  row.signedIn
                    ? (row.everyWorkspace ? t('yours_every') : t('yours_kept'))
                    : t('yours_signed_out'),
                  t('yours_from', { from: row.from }),
                ]}
              />
            )}
            actionsAlways
            actions={row.signedIn
              ? <Switch on={row.everyWorkspace} label={t('yours_switch', { name: row.name })} onChange={on => void change(row, on)} />
              : <Button size="sm" variant="outline" asChild><a href={row.signInHref}>{t('yours_sign_in')}</a></Button>}
            data-testid={`your-connection-${row.slug}`}
          />
        ))}
      </ListRows>
      {error && <p role="status" className="mt-2 text-xs text-brand-fail">{error}</p>}
    </section>
  );
}
