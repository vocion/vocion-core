'use client';

import type { BriefAudioState, ListenSpeed } from '@/services/briefings/audio/types';
import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '@/libs/Orpc';
import { clock, LISTEN_SPEEDS } from '@/services/briefings/audio/types';
import { cn } from '@/utils/Helpers';

/** How often a pending brief is asked about again, and for how long. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 3 * 60_000;

/**
 * Listen to your brief (docs/guides/listen-to-your-brief.md): one compact
 * player, the same on the brief's page and under the brief's chat message.
 *
 * A native `<audio>` element does the playing — that is what keeps a brief
 * going with the screen locked on an iPhone, where the browser allows it — and
 * this draws the controls: play/pause, a scrubber, the time, and 1×/1.5×/2×.
 * The lock screen and headphones get the title and play/pause/skip through
 * the Media Session API.
 *
 * The first view asks for the audio (`briefings.audio`), which makes it if it
 * is not made yet; the player says it is on its way and asks again. With no
 * voice connected, or listening turned off, it draws nothing at all.
 * @param props - Which brief.
 * @param props.briefingId - The brief.
 * @param props.focusPlay - Focus play on arrival (the email's Listen button opens `?listen=1`).
 * @param props.className - Placement.
 */
export function BriefAudioPlayer({ briefingId, focusPlay = false, className }: { briefingId: number; focusPlay?: boolean; className?: string }) {
  const [state, setState] = useState<BriefAudioState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<ListenSpeed>(1);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const ask = async () => {
      try {
        const next = await client.briefings.audio({ id: briefingId });
        if (!alive) {
          return;
        }
        setState(next);
        if (next.status === 'ready') {
          setSpeed(next.speed);
          setDuration(next.durationMs / 1000);
        }
        if (next.status === 'pending' && Date.now() - started < POLL_FOR_MS) {
          timer = setTimeout(() => void ask(), POLL_MS);
        }
      } catch {
        if (alive) {
          setState({ status: 'off', reason: '' });
        }
      }
    };
    void ask();
    return () => {
      alive = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [briefingId]);

  const ready = state?.status === 'ready' ? state : null;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, ready]);

  useEffect(() => {
    if (ready && focusPlay) {
      playRef.current?.focus();
    }
  }, [ready, focusPlay]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    if (el.paused) {
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (el) {
      el.currentTime = Math.max(0, Math.min(seconds, el.duration || duration || seconds));
      setAt(el.currentTime);
    }
  }, [duration]);

  // The lock screen and headphones: title, play, pause, skip.
  useEffect(() => {
    if (!ready || typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title: ready.title, artist: 'Vocion', album: 'Your briefs' });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => void audioRef.current?.play()],
      ['pause', () => audioRef.current?.pause()],
      ['seekbackward', d => seek((audioRef.current?.currentTime ?? 0) - (d.seekOffset ?? 15))],
      ['seekforward', d => seek((audioRef.current?.currentTime ?? 0) + (d.seekOffset ?? 15))],
      ['seekto', d => d.seekTime !== undefined && seek(d.seekTime)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch { /* not supported here */ }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch { /* not supported here */ }
      }
    };
  }, [ready, seek]);

  if (!state || state.status === 'off') {
    return null;
  }
  if (state.status === 'pending') {
    return (
      <div data-testid="brief-audio" data-state="pending" role="status" className={cn('flex items-center gap-2 text-[13px] text-muted-foreground', className)}>
        <span className="size-2 animate-pulse rounded-full bg-foreground/40" aria-hidden />
        Preparing your brief to listen to…
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p data-testid="brief-audio" data-state="failed" className={cn('text-[13px] text-muted-foreground', className)}>
        {`Audio isn't available for this brief yet: ${state.reason}`}
      </p>
    );
  }

  const nextSpeed = LISTEN_SPEEDS[(LISTEN_SPEEDS.indexOf(speed) + 1) % LISTEN_SPEEDS.length]!;
  const total = duration || state.durationMs / 1000;
  return (
    <div
      data-testid="brief-audio"
      data-state="ready"
      role="group"
      aria-label="Listen to this brief"
      className={cn('flex w-full max-w-md items-center gap-2 rounded-full border border-border/70 bg-background px-2 py-1', className)}
    >
      {/* playsInline + preload metadata: Safari on iPhone plays inline and keeps going with the screen locked.
          No caption track: what is said is the brief itself, on the page or one tap from the message. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={state.src}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={e => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = speed;
          if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
            setDuration(e.currentTarget.duration);
          }
        }}
      />
      <button
        ref={playRef}
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="ml-0.5 size-3.5" aria-hidden />}
      </button>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={Math.max(1, Math.round(total))}
        step={1}
        value={Math.min(Math.round(at), Math.max(1, Math.round(total)))}
        onChange={e => seek(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-foreground"
      />
      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums" data-testid="brief-audio-time">
        {`${clock(at * 1000)} / ${clock(total * 1000)}`}
      </span>
      <button
        type="button"
        onClick={() => setSpeed(nextSpeed)}
        aria-label={`Playback speed ${speed}×, change to ${nextSpeed}×`}
        className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium text-foreground/80 tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {`${speed}×`}
      </button>
    </div>
  );
}
