'use client';

/**
 * A paginated document, rendered the way it will print, beside the chat.
 *
 * The HTML is self-contained and agent-authored, so it renders in a sandboxed
 * iframe (`srcdoc`, no `allow-same-origin`): its styles cannot bleed into the
 * app and its scripts cannot read the app. The frame is laid out at the width
 * the house framework was tuned at (850px) and scaled to the pane, so a sheet
 * is a sheet at any rail width.
 *
 * Select-to-talk works inside the frame the same way it does on every record
 * page. A selection cannot cross the sandbox boundary, so a small script
 * injected into the document posts the selected text out, and the pane shows
 * the one control the other surfaces show — which ends at the same place,
 * `openAgentSurface`, with the passage quoted and the artifact as the record
 * (agent-chat-surface.md §6: one entry function). "Change" is "Ask" with the
 * instruction pre-typed, so "cut this" or "make this three agents" is one
 * click plus the words; the agent edits the sheet through edit_document.
 */

import type { DocumentVerification } from '@/libs/cards/specs';
import type { RecordRef } from '@/services/chat/pageContext';
import { ExternalLink, FileDown, MessageSquareText, Pencil } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { SelectionToolbar } from '@/features/dashboard/chat/SelectionToolbar';
import { verificationChip } from '@/libs/documents/audit';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

export const DOCUMENT_FRAME_WIDTH = 850;

/** What the injected script posts up; the frame id keeps two open documents apart. */
type SelectionMessage = { type: 'vocion:document-selection'; frame: string; text: string; x: number; y: number };

function bridgeScript(frameId: string): string {
  // Kept tiny and dependency-free: it runs inside the client's document.
  return `<script>(function(){var F=${JSON.stringify(frameId)};function post(){var s=window.getSelection();var t=s?String(s).trim():'';var r=null;try{if(s&&s.rangeCount&&!s.isCollapsed){r=s.getRangeAt(0).getBoundingClientRect();}}catch(e){}parent.postMessage({type:'vocion:document-selection',frame:F,text:t.length>=4&&r?t:'',x:r?r.left+r.width/2:0,y:r?r.top:0},'*');}document.addEventListener('mouseup',function(){setTimeout(post,0);});document.addEventListener('keyup',function(e){if(e.key==='Shift'||e.key==='ArrowLeft'||e.key==='ArrowRight'){setTimeout(post,0);}});document.addEventListener('mousedown',function(){parent.postMessage({type:'vocion:document-selection',frame:F,text:'',x:0,y:0},'*');});})();</script>`;
}

/**
 * Inject the bridge before `</body>` (or at the end when there is none).
 * @param html
 * @param frameId
 */
export function withSelectionBridge(html: string, frameId: string): string {
  const script = bridgeScript(frameId);
  const i = html.lastIndexOf('</body>');
  return i === -1 ? `${html}${script}` : `${html.slice(0, i)}${script}${html.slice(i)}`;
}

export function DocumentFrame(props: {
  html: string;
  title: string;
  sheets?: number;
  verification?: DocumentVerification;
  /** The artifact this document is — the record a selection is about. Absent for a preview with no row (a pending shell). */
  record?: RecordRef;
  /** Served URL of the document itself, for Open. */
  openHref?: string;
  className?: string;
}) {
  const frameId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [hostWidth, setHostWidth] = useState(400);
  const [frameHeight, setFrameHeight] = useState<number>(() => Math.max(1100, (props.sheets ?? 1) * 1082 + 40));
  const [hit, setHit] = useState<{ text: string; x: number; y: number } | null>(null);

  // Fit the 850px layout to whatever width the pane has.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      setHostWidth(el.clientWidth);
      setScale(Math.min(1, el.clientWidth / DOCUMENT_FRAME_WIDTH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<SelectionMessage>) => {
      const d = ev.data;
      if (!d || d.type !== 'vocion:document-selection' || d.frame !== frameId) {
        return;
      }
      if (!d.text) {
        setHit(null);
        return;
      }
      setHit({ text: d.text, x: d.x * scale, y: d.y * scale });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId, scale]);

  const srcDoc = useMemo(() => withSelectionBridge(props.html, frameId), [props.html, frameId]);

  const onLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    // The frame is sandboxed without same-origin, so its height cannot be
    // read; the sheet count says how tall the document is (1056px + 26px gap).
    const sheets = props.verification?.sheets.length ?? props.sheets ?? 1;
    setFrameHeight(Math.max(1100, sheets * 1082 + 40));
    void e;
  }, [props.sheets, props.verification]);

  const open = useCallback((mode: 'ask' | 'change') => {
    if (!hit) {
      return;
    }
    const text = hit.text;
    setHit(null);
    openAgentSurface(
      {
        ...(mode === 'change' ? { prompt: 'Change this: ' } : {}),
        context: {
          path: pathname,
          title: typeof document === 'undefined' ? '' : document.title,
          ...(props.record ? { record: props.record } : {}),
          selection: { text, quote: true },
          openedFrom: true,
        },
        fallbackContext: text,
      },
      href => router.push(href),
    );
  }, [hit, pathname, props.record, router]);

  const chip = verificationChip(props.verification, props.sheets);
  const issues = props.verification?.issues ?? [];

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', props.className)} data-document-frame>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span data-document-state className={cn(props.verification && !props.verification.ok && 'text-brand-amber')}>{chip}</span>
        {props.verification?.pdfPages != null && <span>{`PDF ${props.verification.pdfPages} ${props.verification.pdfPages === 1 ? 'page' : 'pages'}`}</span>}
        <span className="ml-auto flex items-center gap-2">
          {props.verification?.pdf && (
            <a href={props.verification.pdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground" data-document-pdf>
              <FileDown className="size-3" aria-hidden />
              PDF
            </a>
          )}
          {props.openHref && (
            <a href={props.openHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground" data-document-open>
              <ExternalLink className="size-3" aria-hidden />
              Open
            </a>
          )}
        </span>
      </div>
      {issues.length > 0 && (
        <details className="rounded-md border border-brand-amber/40 bg-brand-amber/5 px-3 py-1.5 text-[12px]" data-document-issues>
          <summary className="cursor-pointer font-medium text-foreground">{`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} from the last render-verify`}</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-foreground/85">
            {issues.map(i => <li key={i}>{i}</li>)}
          </ul>
        </details>
      )}
      <div ref={hostRef} className="relative w-full overflow-hidden" style={{ height: Math.ceil(frameHeight * scale) }}>
        <iframe
          title={props.title}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox"
          onLoad={onLoad}
          className="absolute top-0 left-0 border-0 bg-[#e9e9e4]"
          style={{ width: DOCUMENT_FRAME_WIDTH, height: frameHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          data-document-iframe
        />
        {hit && (
          <SelectionToolbar
            x={hit.x}
            y={hit.y}
            width={hostWidth}
            actions={[
              { label: 'Ask', icon: MessageSquareText, onClick: () => open('ask') },
              { label: 'Change', icon: Pencil, onClick: () => open('change') },
            ]}
            testId="document"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The dense form for a chat turn or the log: what it is, how many sheets, whether it verified, and its first sheet.
 * @param props
 * @param props.title
 * @param props.sheets
 * @param props.verification
 * @param props.className
 */
export function DocumentSummary(props: { title: string; sheets?: number; verification?: DocumentVerification; className?: string }) {
  const first = props.verification?.sheets.find(s => s.image);
  return (
    <div className={cn('flex min-w-0 items-start gap-3', props.className)} data-document-summary>
      {first?.image && (
        <img src={first.image} alt="" className="h-20 w-auto shrink-0 rounded border border-border bg-white object-cover" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{props.title}</p>
        <p className={cn('text-[11px] text-muted-foreground', props.verification && !props.verification.ok && 'text-brand-amber')}>{verificationChip(props.verification, props.sheets)}</p>
      </div>
    </div>
  );
}
