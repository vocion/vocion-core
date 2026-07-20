'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { client } from '@/libs/Orpc';

/**
 * The zero-teams state on /dashboard/teams — ICP-first: teams language,
 * and a one-click "load the sample revenue workspace" as the primary
 * action (the first-run product, design §2a). The button is gated by
 * the caller — it renders ONLY when the workspace has zero teams — and
 * behind a confirm dialog here (trio call: gate it; the apply is
 * additive, never destructive). The secondary path is the quiet YAML
 * authoring docs link.
 *
 * TODO(slice-4): the backing teams.seedSample route is a 501 stub until
 * the sample bundle lands; its message renders in the error line below.
 */
export function TeamsEmptyState() {
  const t = useTranslations('Teams');
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSeed = async () => {
    // eslint-disable-next-line no-alert -- house confirm pattern (MembersPanel)
    if (!window.confirm(t('seed_confirm'))) {
      return;
    }
    setSeeding(true);
    setError(null);
    try {
      await client.teams.seedSample();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div>
      <EmptyState
        icon={Users}
        title={t('empty_title')}
        description={t('empty_body')}
        action={{ label: seeding ? t('seed_loading') : t('empty_primary'), onClick: () => void onSeed() }}
        secondaryAction={{ label: t('empty_secondary'), href: 'https://www.vocion.ai/docs/features/teams' }}
      />
      {error && (
        <p className="mt-3 text-center text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}
