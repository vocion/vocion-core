'use client';

import type { ReportRecording } from '@/services/factory/featureReport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * One recording on the feature page: Vocion's own player, loading only its
 * first frame until pressed. When the recording has a narrated version (the
 * seat's avatar and voiceover over it, `services/artifacts/narrate.ts`), a
 * two-way switch above the player picks Recording or Narrated — the shared
 * Tabs, so only the chosen video is mounted. Phone-safe: the switch is as
 * wide as its two words, the player as wide as the column.
 * @param props - The recording and its label.
 * @param props.label - Which recording it is ("Live check").
 * @param props.recording - The recording, with its narration when one was made.
 */
export function RecordingPlayer({ label, recording }: { label: string; recording: ReportRecording }) {
  const player = (v: { url: string; contentType: string; caption: string }, testId: string) => (
    // A browser recording has no sound to caption; a narrated one's script is
    // on its artifact, and what it shows is the figcaption below.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      key={v.url}
      controls
      preload="metadata"
      playsInline
      className="block max-h-80 w-full max-w-full rounded-md bg-muted object-contain"
      aria-label={`${label}: ${v.caption}`}
      data-testid={testId}
    >
      <source src={v.url} type={v.contentType} />
    </video>
  );
  const ownPlayer = player(recording, 'recording-player');
  if (!recording.narrated) {
    return ownPlayer;
  }
  return (
    <Tabs defaultValue="recording" className="min-w-0 gap-1.5" data-testid="recording-switch">
      <TabsList className="h-8">
        <TabsTrigger value="recording" className="px-2.5 text-[12px]">Recording</TabsTrigger>
        <TabsTrigger value="narrated" className="px-2.5 text-[12px]">Narrated</TabsTrigger>
      </TabsList>
      <TabsContent value="recording" className="min-w-0">{ownPlayer}</TabsContent>
      <TabsContent value="narrated" className="min-w-0">
        {player(recording.narrated, 'recording-player-narrated')}
      </TabsContent>
    </Tabs>
  );
}
