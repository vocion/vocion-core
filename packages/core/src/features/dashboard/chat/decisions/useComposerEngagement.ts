'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

/** The chat composer's own box (`ChatComposer.tsx`). */
const COMPOSER = '[data-agent-composer]';

function composerOf(target: EventTarget | null): HTMLTextAreaElement | null {
  return target instanceof Element ? target.closest<HTMLTextAreaElement>(COMPOSER) : null;
}

/**
 * WHEN THE PERSON STARTS CHATTING, THE DOCKED ASK STEPS ASIDE (Chris,
 * 2026-10-23: "when I start chatting, can you collapse the ask/action card?").
 * `onEngage` runs when they tap into the composer or type in it; `onRelease`
 * when they leave it empty. A tap or a keystroke is the person's intent, so a
 * page that focuses the composer by itself folds nothing.
 * @param onEngage - They started writing.
 * @param onRelease - They left the composer with nothing in it.
 */
export function useComposerEngagement(onEngage: () => void, onRelease: () => void): void {
  const engage = useRef(onEngage);
  const release = useRef(onRelease);
  useLayoutEffect(() => {
    engage.current = onEngage;
    release.current = onRelease;
  });
  useEffect(() => {
    const onPointer = (e: Event) => {
      if (composerOf(e.target)) {
        engage.current();
      }
    };
    const onInput = (e: Event) => {
      const box = composerOf(e.target);
      if (box && box.value.trim().length > 0) {
        engage.current();
      }
    };
    const onLeave = (e: FocusEvent) => {
      const box = composerOf(e.target);
      // Into the card itself, or nowhere: an empty composer gives the card back.
      if (box && box.value.trim().length === 0 && !composerOf(e.relatedTarget)) {
        release.current();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusout', onLeave, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusout', onLeave, true);
    };
  }, []);
}
