'use client';

import { useState } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

const AUTONOMY = [
  { level: 1, label: 'Draft only — analyze & draft, no external actions' },
  { level: 2, label: 'Ask before action — prepare, but approve before anything goes out' },
  { level: 3, label: 'Act within rules — take pre-approved actions' },
];

export function MissionBriefForm({
  templates,
  defaultTemplate,
}: {
  templates: Array<{ slug: string; name: string }>;
  defaultTemplate?: string;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [missionSlug, setMissionSlug] = useState(defaultTemplate ?? '');
  const [level, setLevel] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!brief.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const run = await client.missions.start({
        brief: brief.trim(),
        missionSlug: missionSlug || undefined,
        autonomyLevel: level,
      });
      router.push(`/dashboard/missions/runs/${run.id}`);
    } catch (err) {
      setError((err as Error).message ?? 'Could not start the mission.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="brief" className="mb-1.5 block text-sm font-medium">What should your AI team work on?</label>
        <textarea
          id="brief"
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={5}
          placeholder="e.g. Analyze last month's campaigns and build the client story. Tell us what changed, what matters, and what to recommend. Don't send anything."
          className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </div>

      {templates.length > 0 && (
        <div>
          <label htmlFor="tmpl" className="mb-1.5 block text-sm font-medium">Standing mission (optional)</label>
          <select
            id="tmpl"
            value={missionSlug}
            onChange={e => setMissionSlug(e.target.value)}
            className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
          >
            <option value="">Pick a team for me (ad-hoc)</option>
            {templates.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="autonomy" className="mb-1.5 block text-sm font-medium">How much can the team do on its own?</label>
        <select
          id="autonomy"
          value={level}
          onChange={e => setLevel(Number(e.target.value))}
          className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
        >
          {AUTONOMY.map(a => <option key={a.level} value={a.level}>{a.label}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={busy || !brief.trim()}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Your team is planning & working…' : 'Brief the team'}
      </button>
      {busy && <p className="text-xs text-muted-foreground">Planning the work, assembling the team, and running the first tasks. This can take a moment.</p>}
    </form>
  );
}
