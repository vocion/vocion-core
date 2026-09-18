'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RailColumn } from '@/features/dashboard/chat/RailColumn';
import { clampRailWidth, defaultRailWidth, RAIL_SHEET_BREAKPOINT, readStoredRailWidth } from '@/features/dashboard/chat/railState';
import { useEscapeToClose, useOpenPreviewRef } from './previewState';

/**
 * The preview's own host — the column, on the pages that have no chat rail.
 *
 * There is ONE right column (`features/dashboard/chat/RailColumn`). Where a
 * rail is mounted, the dock draws it and the preview is its top pane; where
 * there is none — the decision sheets, which `PageDock`'s `NO_DOCK_ROUTES`
 * deliberately leaves railless — this draws the same column with the preview
 * as its only pane. The claim in `dockState.ts` settles which, and the dock
 * always wins, so a page can render this without knowing whether it has a
 * rail.
 *
 * Any number of surfaces may render it; only one paints, and it paints
 * nothing unless a preview is open. The width is the rail's width, read from
 * the same store, because it is the same column.
 */
export function PreviewPanel() {
  const previewRef = useOpenPreviewRef();
  const [width, setWidth] = useState(() => defaultRailWidth(1440));
  const [narrow, setNarrow] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Geometry is the browser's to know: the server render uses the defaults and
  // this adopts the real viewport and the remembered width after mount.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */
  useEffect(() => {
    setMounted(true);
    setWidth(clampRailWidth(readStoredRailWidth() ?? defaultRailWidth(window.innerWidth), window.innerWidth));
    const mql = window.matchMedia(`(max-width: ${RAIL_SHEET_BREAKPOINT - 1}px)`);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect */

  useEscapeToClose(previewRef !== null);

  if (!mounted) {
    return null;
  }
  return createPortal(
    <RailColumn priority="preview" chat={null} narrow={narrow} width={width} aria-label="Preview" />,
    document.body,
  );
}
