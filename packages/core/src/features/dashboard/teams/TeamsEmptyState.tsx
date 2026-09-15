'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { client } from '@/libs/Orpc';
import { DEFAULT_SAMPLE_WORKSPACE, SAMPLE_WORKSPACES } from '@/services/sampleWorkspaces';

/**
 * The zero-teams state on /dashboard/teams — ICP-first: teams language,
 * and a one-click "load a sample workspace" as the primary action (the
 * first-run product, design §2a). The primary button seeds
 * SAMPLE_WORKSPACES[0]; any further registry entries render underneath as
 * plain alternatives, so with a single starter registered this page is
 * exactly what it was. The button is gated by the caller — it renders
 * ONLY when the workspace has zero teams — and behind a confirm dialog
 * here (trio call: gate it; the apply is additive, never destructive).
 * The gate is ALSO server-enforced — teams.seedSample rejects any
 * workspace that already has teams. The secondary path is the quiet YAML
 * authoring docs link.
 */
export function TeamsEmptyState() {
  const t = useTranslations('Teams');
  const router = useRouter();
  const [seeding, setSeeding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alternatives = SAMPLE_WORKSPACES.filter(w => w.slug !== DEFAULT_SAMPLE_WORKSPACE.slug);

  const onSeed = async (slug: string) => {
    // eslint-disable-next-line no-alert -- house confirm pattern (MembersPanel)
    if (!window.confirm(t('seed_confirm'))) {
      return;
    }
    setSeeding(slug);
    setError(null);
    try {
      await client.teams.seedSample({ slug });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(null);
    }
  };

  return (
    <div>
      <EmptyState
        icon={Users}
        title={t('empty_title')}
        description={t('empty_body')}
        action={{
          label: seeding === DEFAULT_SAMPLE_WORKSPACE.slug ? t('seed_loading') : t('empty_primary'),
          onClick: () => void onSeed(DEFAULT_SAMPLE_WORKSPACE.slug),
        }}
        secondaryAction={{ label: t('empty_secondary'), href: 'https://www.vocion.ai/docs/features/teams' }}
      />
      {alternatives.length > 0 && (
        <ul className="mx-auto mt-4 flex max-w-md flex-col gap-2">
          {alternatives.map(sample => (
            <li key={sample.slug} className="text-center">
              <Button
                variant="outline"
                size="sm"
                disabled={seeding !== null}
                onClick={() => void onSeed(sample.slug)}
              >
                {seeding === sample.slug ? t('seed_loading') : sample.label}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{sample.description}</p>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-3 text-center text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}
