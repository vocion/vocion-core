/**
 * mission Card — a workspace mission's charter, read from its YAML.
 *
 * The spec is the authored file (`libs/workspace/source.ts`), so the card
 * shows the charter a person recognises from the mission page — goal, success
 * criteria, deliverables, owner, autonomy — and falls back to the YAML itself
 * when the text does not parse (a half-typed edit, an `extends: core` patch
 * that only carries the fields it changes). Nothing here is a second store:
 * the pane edits the text, and the card reads whatever the text says.
 */

import type { MissionSourceSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { parse as parseYaml } from 'yaml';
import { cn } from '@/utils/Helpers';
import { missionSpecSchema } from '../specs';

export const MISSION_SLUG = 'mission';

type Charter = {
  name?: string;
  description?: string;
  goal?: string;
  agent?: string;
  status?: string;
  extendsCore: boolean;
  successCriteria: string[];
  desiredArtifacts: string[];
  autonomy?: number;
  schedule?: string;
};

/**
 * Read the charter out of the YAML, tolerating anything the schema would
 * refuse — the card is a view, not a gate; the gate is the save.
 * @param yaml
 */
export function parseCharter(yaml: string): Charter | null {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const autonomy = typeof r.autonomyPolicy === 'object' && r.autonomyPolicy !== null ? (r.autonomyPolicy as { level?: unknown }).level : undefined;
  return {
    name: str(r.name),
    description: str(r.description),
    goal: str(r.goal),
    agent: str(r.agent),
    status: str(r.status),
    extendsCore: r.extends === 'core',
    successCriteria: list(r.successCriteria),
    desiredArtifacts: list(r.desiredArtifacts),
    autonomy: typeof autonomy === 'number' ? autonomy : undefined,
    schedule: str(r.schedule),
  };
}

export function MissionCardView({ data, surface }: { data: MissionSourceSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const charter = parseCharter(data.yaml);
  if (!charter) {
    return (
      <article className="min-w-0" data-mission-card="raw">
        <p className="mb-2 text-[11px] text-muted-foreground">Shown as written — this YAML does not parse yet.</p>
        <pre className="overflow-auto rounded-md border border-border/70 bg-muted/30 p-3 font-mono text-[12px] leading-5 text-foreground">{data.yaml}</pre>
      </article>
    );
  }
  if (dense) {
    return (
      <article className="min-w-0 text-sm" data-mission-card="dense">
        <p className="font-medium text-foreground">{charter.name ?? data.slug}</p>
        {charter.goal && <p className="mt-0.5 line-clamp-3 text-muted-foreground">{charter.goal}</p>}
      </article>
    );
  }
  return (
    <article className="min-w-0 text-[15px] leading-7" data-mission-card="charter">
      <header className="mb-4">
        <h3 className="text-base font-semibold text-foreground">{charter.name ?? data.slug}</h3>
        <p className="text-[12px] text-muted-foreground">
          <code className="font-mono">{data.slug}</code>
          {charter.status && ` · ${charter.status}`}
          {charter.extendsCore && ' · patches the core default'}
        </p>
        {charter.description && <p className="mt-1 text-sm text-muted-foreground">{charter.description}</p>}
      </header>
      <section className="mb-4">
        <h4 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Goal</h4>
        <p className={cn('text-foreground', !charter.goal && 'text-muted-foreground italic')}>{charter.goal ?? 'No goal written yet.'}</p>
      </section>
      {charter.successCriteria.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Success criteria</h4>
          <ul className="list-disc space-y-1 pl-5 text-foreground/90">
            {charter.successCriteria.map(c => <li key={c}>{c}</li>)}
          </ul>
        </section>
      )}
      {charter.desiredArtifacts.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Deliverables</h4>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {charter.desiredArtifacts.map(a => <li key={a}>{a}</li>)}
          </ul>
        </section>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {charter.agent && (
          <>
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="font-mono text-foreground">{charter.agent}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Autonomy</dt>
        <dd className="text-foreground">
          level
          {' '}
          {charter.autonomy ?? 1}
        </dd>
        {charter.schedule && (
          <>
            <dt className="text-muted-foreground">Schedule</dt>
            <dd className="font-mono text-foreground">{charter.schedule}</dd>
          </>
        )}
      </dl>
    </article>
  );
}

export const missionCard = defineCard({
  slug: MISSION_SLUG,
  name: 'Mission',
  description: 'A workspace mission — the charter read from its YAML file. Edited in place; every save is a version and a workspace apply.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: missionSpecSchema,
  Renderer: ({ data, surface }) => <MissionCardView data={data} surface={surface} />,
});
