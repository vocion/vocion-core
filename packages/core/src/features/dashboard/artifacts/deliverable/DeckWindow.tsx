'use client';

/**
 * A deck in a browser window of its own (`/dashboard/artifacts/<id>/window`).
 *
 * Present mode's slide view (`PresentMode`, `display="window"`) filling the
 * window: no app chrome, arrows and clicks move it, and the slide on screen is
 * written into the URL (`?slide=3`) so a reload or a copied link opens at the
 * same place. Nothing is rendered a second way — the pages, the frame HTML and
 * the asset resolution are the ones the deliverable pane uses.
 */

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { SLIDE_PARAM } from './deckWindowUrl';
import { deliverablePages, pageDocument } from './pages';
import { PresentMode } from './PresentMode';
import { useDeckAssets } from './useDeckAssets';

export type DeckWindowProps = {
  artifactId: number;
  title: string;
  spec: Record<string, unknown>;
  /** The 0-based slide the URL named (`slideIndexFromParam`). */
  start: number;
};

export function DeckWindow(props: DeckWindowProps) {
  const t = useTranslations('Deliverable');
  const { spec, title } = props;
  const pages = useMemo(() => deliverablePages('deck', spec), [spec]);
  const assetUrl = useDeckAssets((spec as { assets?: Record<string, { url: string; contentType: string }> }).assets);
  const frameHtml = useCallback((key: string) => pageDocument('deck', spec, key, assetUrl), [spec, assetUrl]);

  // The place is kept in the URL without a history entry per slide: Back
  // leaves the window's history alone, a reload opens where the person was.
  const onIndex = useCallback((i: number) => {
    const url = new URL(window.location.href);
    if (i === 0) {
      url.searchParams.delete(SLIDE_PARAM);
    } else {
      url.searchParams.set(SLIDE_PARAM, String(i + 1));
    }
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  if (pages.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center bg-black text-sm text-white/70" data-deck-window-empty>
        {t('window.empty')}
      </main>
    );
  }
  return (
    <PresentMode
      display="window"
      artifactId={props.artifactId}
      title={title}
      pages={pages}
      frameHtml={frameHtml}
      start={props.start}
      onIndex={onIndex}
    />
  );
}
