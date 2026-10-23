'use client';

/**
 * One page of a deliverable, live: the engine's own page HTML for that slide
 * or sheet in a sandboxed iframe (scripts for Vocion's element runtime and
 * the bridge, no `allow-same-origin`), laid out at its real size and scaled
 * to fit its box. Editable pages edit in place (`bridge.ts`); every page
 * offers select-to-talk the way the document frame does.
 */

import type { EditMessage, SelectRequestMessage, SizeMessage } from './bridge';
import type { RecordRef } from '@/services/chat/pageContext';
import { MessageSquareText, Pencil } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SelectionToolbar } from '@/features/dashboard/chat/SelectionToolbar';
import { cn } from '@/utils/Helpers';
import { useFrameSelection } from '../DocumentFrame';
import { EDIT_MESSAGE, SELECT_MESSAGE, SIZE_MESSAGE, withPageBridge } from './bridge';

export type PageFrameProps = {
  /** The page document (`pageDocument`). */
  html: string;
  /** Its logical size: 1920×1080 for a slide; a sheet's height is measured once it renders. */
  width: number;
  height: number;
  /** Measure the page's height from the frame (a sheet); a slide's is fixed. */
  measure?: boolean;
  /** The page root the bridge stamps. */
  root: string;
  title: string;
  editable?: boolean;
  /** Offer select-to-talk (Ask / Change). */
  selectable?: boolean;
  record?: RecordRef;
  onEdit?: (edit: Pick<EditMessage, 'path' | 'before' | 'after'>) => void;
  onSelectRequest?: (req: Pick<SelectRequestMessage, 'index' | 'to'>) => void;
  /** A thumbnail: no bridge at all, nothing to click into. */
  inert?: boolean;
  className?: string;
  /** Size the box from its width at the page's aspect ratio (capped at 70% of the viewport's height); otherwise the caller sizes it. */
  fitWidth?: boolean;
  /** Hook for tests and probes, e.g. `data-document-iframe`. */
  frameProps?: Record<string, string>;
};

export function PageFrame(props: PageFrameProps) {
  const frameId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [measured, setMeasured] = useState<number | null>(null);
  const height = props.measure && measured ? measured : props.height;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }
    const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box.width > 0 && box.height > 0 ? Math.min(box.width / props.width, box.height / height) : 0;
  const offset = { x: Math.max(0, (box.width - props.width * scale) / 2), y: Math.max(0, (box.height - height * scale) / 2) };

  const srcDoc = useMemo(
    () => (props.inert ? props.html : withPageBridge(props.html, { frame: frameId, root: props.root, editable: Boolean(props.editable), selection: Boolean(props.selectable) })),
    [props.html, props.inert, props.root, props.editable, props.selectable, frameId],
  );

  // The latest handlers, read from the message listener without re-binding it.
  const handlers = useRef({ onEdit: props.onEdit, onSelectRequest: props.onSelectRequest });
  useEffect(() => {
    handlers.current = { onEdit: props.onEdit, onSelectRequest: props.onSelectRequest };
  });

  useEffect(() => {
    if (props.inert) {
      return;
    }
    const onMessage = (ev: MessageEvent<EditMessage | SelectRequestMessage | SizeMessage>) => {
      const d = ev.data;
      if (!d || typeof d !== 'object' || d.frame !== frameId) {
        return;
      }
      if (d.type === EDIT_MESSAGE && typeof d.path === 'number' && typeof d.before === 'string' && typeof d.after === 'string') {
        handlers.current.onEdit?.({ path: d.path, before: d.before, after: d.after });
      } else if (d.type === SELECT_MESSAGE) {
        handlers.current.onSelectRequest?.({ index: d.index, to: d.to });
      } else if (d.type === SIZE_MESSAGE && props.measure && Number.isFinite(d.h) && d.h > 0) {
        setMeasured(Math.min(Math.round(d.h), 20_000));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId, props.inert, props.measure]);

  const { hit, open } = useFrameSelection(frameId, { scale: scale || 1, ...offset }, props.record);

  return (
    <div
      ref={hostRef}
      className={cn('relative min-h-0 min-w-0 overflow-hidden', props.className)}
      style={props.fitWidth ? { aspectRatio: `${props.width} / ${height}`, maxHeight: '70vh' } : undefined}
      data-page-frame={props.inert ? 'thumbnail' : 'page'}
    >
      {scale > 0 && (
        <iframe
          title={props.title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          loading={props.inert ? 'lazy' : undefined}
          tabIndex={props.inert ? -1 : undefined}
          aria-hidden={props.inert ? true : undefined}
          className={cn('absolute border-0 bg-white', props.inert && 'pointer-events-none')}
          style={{ left: offset.x, top: offset.y, width: props.width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          {...props.frameProps}
        />
      )}
      {hit && !props.inert && (
        <SelectionToolbar
          x={hit.x}
          y={hit.y}
          width={box.width}
          actions={[
            { label: 'Ask', icon: MessageSquareText, onClick: () => open('ask') },
            { label: 'Change', icon: Pencil, onClick: () => open('change') },
          ]}
          testId="document"
        />
      )}
    </div>
  );
}
