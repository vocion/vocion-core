'use client';

import type { RoutineVersionView, RoutineView } from '@/libs/routines/types';
import { ExternalLink } from 'lucide-react';
import { DetailMeta, DetailPage } from '@/components/patterns';
import { findingsOf } from '@/libs/routines/findings';
import { clock } from '@/libs/routines/types';
import { RecordingFindings } from './RecordingFindings';

/**
 * WHAT VOCION FOUND IN THE RECORDING, kept — the evidence behind the version
 * the analyst drafted from it: the recording, its moments on the track, and
 * every finding as the analyst wrote it, before the expert's answers moved the
 * automation on. One click from the automation's page
 * (`/dashboard/automations/<id>/recording`).
 * @param props
 * @param props.routine - The automation.
 * @param props.version - The version drafted from the recording.
 */
export function TaughtFromView({ routine, version }: { routine: RoutineView; version: RoutineVersionView }) {
  const source = routine.source!;
  const findings = findingsOf(version.spec);
  return (
    <div data-routine-taught-from={routine.id} data-tour="recording-findings-page">
      <DetailPage
        crumbs={[{ label: 'Automations', href: '/dashboard/automations' }, { label: routine.name, href: `/dashboard/automations/${routine.id}` }, { label: 'What Vocion found' }]}
        title="What Vocion found in the recording"
        subtitle={source.title ?? undefined}
        meta={(
          <DetailMeta
            items={[
              source.recordedBy ? `Recorded by ${source.recordedBy}` : null,
              source.durationSec ? `${clock(source.durationSec)} long` : null,
              `Drafted version ${version.n} on ${new Date(version.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
              (
                <a key="slate" href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
                  <ExternalLink className="size-3" aria-hidden />
                  Open in Slate
                </a>
              ),
            ]}
          />
        )}
      >
        <div className="mt-5">
          <RecordingFindings routineId={routine.id} source={source} findings={findings} />
        </div>
      </DetailPage>
    </div>
  );
}
