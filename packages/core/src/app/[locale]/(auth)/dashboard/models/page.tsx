import { Cpu, ExternalLink } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { VisionEngineControl } from '@/features/dashboard/VisionEngineControl';
import { clerkAuth as auth } from '@/libs/Auth';
import { visionModelsReport } from '@/services/VisionModelService';

/**
 * /dashboard/models — the vision engines behind Analyze, with the receipts:
 * the trained classifier's project, every training run (version, ARN,
 * status, F1, per-label precision/recall, training time), its datasets,
 * the training set on disk per template, and usage of both engines from the
 * tool-call record. Read-only except the start/stop switch.
 */

export const dynamic = 'force-dynamic';

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const pct = (n: number | null | undefined) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : '—');
const dur = (s: number | null | undefined) => (typeof s === 'number' ? `${Math.floor(s / 60)} min ${s % 60}s` : '—');

function statusTone(s: string) {
  if (s === 'RUNNING') {
    return 'text-emerald-700 border-emerald-600/40';
  }
  if (s === 'TRAINING_IN_PROGRESS' || s === 'STARTING' || s === 'STOPPING') {
    return 'text-amber-700 border-amber-600/40';
  }
  if (s.includes('FAILED')) {
    return 'text-red-600 border-red-500/40';
  }
  return 'text-muted-foreground border-border';
}

export default async function ModelsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return <TitleBar title="Vision models" description="Sign in to an organization to see its models." />;
  }
  const r = await visionModelsReport(orgId);
  const consoleUrl = r.classifier.projectArn
    ? `https://${r.region}.console.aws.amazon.com/rekognition/custom-labels#/projects/${encodeURIComponent(r.classifier.projectName ?? '')}`
    : null;

  return (
    <>
      <TitleBar title="Vision models" description="The engines behind Analyze — what is trained, on what, how it scored, and how much each has been used." />

      <div className="mt-4 space-y-6">
        <VisionEngineControl />

        {/* Engines summary */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-border p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="size-4 text-muted-foreground" />
              Claude Vision
              <Badge variant="outline" className="ml-auto text-[11px]">reference comparison</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Compares a photo against verified-good photos of the same kit, names the region, crops to count fasteners. No training run: enrol a kit with one good photo. Adopted learnings ride in the prompt.</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono">claude-sonnet-4-6</dd>
              <dt className="text-muted-foreground">Checks run</dt>
              <dd className="font-mono">
                {r.usage.claude.calls}
                {r.usage.claude.errors ? ` (${r.usage.claude.errors} errors)` : ''}
              </dd>
              <dt className="text-muted-foreground">Avg time</dt>
              <dd className="font-mono">{r.usage.claude.avgMs != null ? `${Math.round(r.usage.claude.avgMs / 1000)}s` : '—'}</dd>
              <dt className="text-muted-foreground">Last used</dt>
              <dd>{fmt(r.usage.claude.lastAt)}</dd>
            </dl>
          </section>
          <section className="rounded-lg border border-border p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="size-4 text-muted-foreground" />
              Amazon Rekognition Custom Labels
              <Badge variant="outline" className="ml-auto text-[11px]">whole-image classifier</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Trained on this workspace's good/bad sets. Second opinion: a label with confidence, no region. Bills per hour while its endpoint runs.</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-mono break-all">{r.classifier.projectName ?? '—'}</dd>
              <dt className="text-muted-foreground">Region</dt>
              <dd className="font-mono">{r.region}</dd>
              <dt className="text-muted-foreground">Checks run</dt>
              <dd className="font-mono">
                {r.usage.rekognition.calls}
                {r.usage.rekognition.errors ? ` (${r.usage.rekognition.errors} errors)` : ''}
              </dd>
              <dt className="text-muted-foreground">Last used</dt>
              <dd>{fmt(r.usage.rekognition.lastAt)}</dd>
            </dl>
            {consoleUrl && (
              <a href={consoleUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs underline">
                Open in the AWS console
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </section>
        </div>

        {/* Training runs */}
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold">
            Training runs
            <span className="ml-2 font-normal text-muted-foreground">{`${r.classifier.runs.length} version${r.classifier.runs.length === 1 ? '' : 's'} · each row is one training of the classifier`}</span>
          </div>
          {r.classifier.runs.length === 0
            ? <p className="px-5 py-6 text-sm text-muted-foreground">{r.classifier.configured ? 'No training runs yet.' : 'No classifier configured (VOCION_REKOGNITION_PROJECT_ARN).'}</p>
            : (
                <ul className="divide-y divide-border">
                  {r.classifier.runs.map(run => (
                    <li key={run.arn} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{run.versionName}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(run.status)}`}>{run.status}</span>
                        {typeof run.f1 === 'number' && <span className="text-xs text-muted-foreground">{`test F1 ${run.f1.toFixed(2)}`}</span>}
                        <span className="ml-auto text-xs text-muted-foreground">{`trained ${fmt(run.createdAt)}`}</span>
                      </div>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="text-muted-foreground">Training ended</dt>
                          <dd>{fmt(run.trainingEndedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Billable training time</dt>
                          <dd>{dur(run.billableTrainingSeconds)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Inference units</dt>
                          <dd>{run.minInferenceUnits ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Status message</dt>
                          <dd>{run.statusMessage ?? '—'}</dd>
                        </div>
                      </dl>
                      <div className="mt-2 font-mono text-[11px] break-all text-muted-foreground">{run.arn}</div>
                      {run.labels.length > 0 && (
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-left text-[12px]">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="py-1 pr-4 font-medium">Label</th>
                                <th className="py-1 pr-4 font-medium">F1</th>
                                <th className="py-1 pr-4 font-medium">Precision</th>
                                <th className="py-1 pr-4 font-medium">Recall</th>
                                <th className="py-1 pr-4 font-medium">Test images</th>
                              </tr>
                            </thead>
                            <tbody>
                              {run.labels.map(l => (
                                <tr key={l.label} className="border-b border-border/60 last:border-0">
                                  <td className="py-1 pr-4 font-mono">{l.label}</td>
                                  <td className="py-1 pr-4 tabular-nums">{pct(l.f1)}</td>
                                  <td className="py-1 pr-4 tabular-nums">{pct(l.precision)}</td>
                                  <td className="py-1 pr-4 tabular-nums">{pct(l.recall)}</td>
                                  <td className="py-1 pr-4 tabular-nums">{l.testImages ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-1 text-[11px] text-muted-foreground">Scores are on the held-out test split only. With two test images per label these are small-sample numbers: treat as promising, not proven.</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </section>

        {/* Datasets + training set */}
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-border p-5">
            <div className="text-sm font-semibold">Rekognition datasets</div>
            <p className="mt-1 text-xs text-muted-foreground">What the last training saw. Rebuilt from the bucket's good/bad folders when a training is started.</p>
            <ul className="mt-3 space-y-2 text-[13px]">
              {r.classifier.datasets.length === 0 && <li className="text-muted-foreground">—</li>}
              {r.classifier.datasets.map(d => (
                <li key={d.arn} className="rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.type}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(d.status)}`}>{d.status}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{`${d.entries ?? '?'} images · ${d.labelled ?? '?'} labelled · ${d.labels ?? '?'} labels`}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{d.arn}</div>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-lg border border-border p-5">
            <div className="text-sm font-semibold">Training set on disk</div>
            <p className="mt-1 text-xs text-muted-foreground">{r.bucket ? `s3://${r.bucket} — per template, good/ and bad/. Approved dataset.add_example decisions land here; the next training run picks them up.` : 'No s3 source in this workspace.'}</p>
            {r.trainingSet && (
              <table className="mt-3 w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">Template</th>
                    <th className="py-1 pr-4 font-medium">Good</th>
                    <th className="py-1 pr-4 font-medium">Bad</th>
                  </tr>
                </thead>
                <tbody>
                  {r.trainingSet.map(t => (
                    <tr key={t.template} className="border-b border-border/60 last:border-0">
                      <td className="py-1 pr-4 font-mono">{t.template}</td>
                      <td className="py-1 pr-4 text-emerald-700 tabular-nums">{t.good}</td>
                      <td className="py-1 pr-4 text-amber-700 tabular-nums">{t.bad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
