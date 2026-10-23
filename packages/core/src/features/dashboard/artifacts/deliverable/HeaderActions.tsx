'use client';

/**
 * The deliverable's three verbs, worn in the shared artifact header
 * (`ArtifactHeader`, `actionsFor`): **Present** (decks), **Download** (PDF,
 * and PPTX or Word) and **Upload a new version**. Same icon-button shape as
 * every other header verb.
 */

import type { ExportFormat } from './transfer';
import { Download, Presentation, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const ICON_BUTTON = 'inline-flex items-center rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

function Tip(props: { label: string; children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{props.children}</TooltipTrigger>
        <TooltipContent side="bottom">{props.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PresentAction(props: { onPresent: () => void }) {
  const t = useTranslations('Deliverable');
  return (
    <Tip label={t('present.action')}>
      <button type="button" onClick={props.onPresent} className={ICON_BUTTON} aria-label={t('present.action')} data-deliverable-present>
        <Presentation className="size-3.5" aria-hidden />
      </button>
    </Tip>
  );
}

export function DownloadAction(props: { formats: ExportFormat[]; onDownload: (format: ExportFormat) => void; pdfPages?: number | null }) {
  const t = useTranslations('Deliverable');
  const label = (f: ExportFormat) => (f === 'pdf'
    ? (props.pdfPages ? t('download.pdfPages', { pages: props.pdfPages }) : t('download.pdf'))
    : f === 'pptx' ? t('download.pptx') : t('download.docx'));
  return (
    <DropdownMenu>
      <Tip label={t('download.action')}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={ICON_BUTTON} aria-label={t('download.action')} data-deliverable-download>
            <Download className="size-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        {props.formats.map(f => (
          <DropdownMenuItem key={f} onSelect={() => props.onDownload(f)} data-deliverable-download-format={f}>
            {label(f)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UploadAction(props: { onUpload: () => void; kind: 'deck' | 'document' }) {
  const t = useTranslations('Deliverable');
  const label = props.kind === 'deck' ? t('upload.actionDeck') : t('upload.actionDocument');
  return (
    <Tip label={label}>
      <button type="button" onClick={props.onUpload} className={ICON_BUTTON} aria-label={label} data-deliverable-upload>
        <Upload className="size-3.5" aria-hidden />
      </button>
    </Tip>
  );
}
