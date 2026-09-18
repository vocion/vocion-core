'use client';

/**
 * The version menu: every version of this artifact, newest first, with who
 * wrote it and why. Selecting one shows it READ-ONLY in the pane; restoring
 * writes a new head version carrying that content, so nothing in the list
 * ever disappears or changes meaning.
 */

import type { ArtifactVersionPayload } from '@/services/ArtifactService';
import { Check, History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authorLabel, relativeTime } from './kinds';

export function VersionMenu({ versions, headVersion, viewing, selfId, loading, onView, onRestore, onOpenChange }: {
  versions: ArtifactVersionPayload[];
  headVersion: number;
  /** The version currently shown; equals `headVersion` when live. */
  viewing: number;
  selfId?: string | null;
  loading?: boolean;
  onView: (version: number) => void;
  onRestore: (version: number) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" aria-label="Version history">
          <History className="size-3.5" />
          <span className="hidden sm:inline">History</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {loading ? 'Loading versions…' : `${versions.length} ${versions.length === 1 ? 'version' : 'versions'}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {versions.map(v => (
          <DropdownMenuItem
            key={v.id}
            onSelect={() => onView(v.version)}
            className="flex-col items-start gap-0.5 py-2"
          >
            <span className="flex w-full items-center gap-1.5 text-xs font-medium text-foreground">
              {v.version === viewing ? <Check className="size-3 shrink-0" aria-hidden /> : <span className="w-3 shrink-0" />}
              v
              {v.version}
              {v.version === headVersion && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">current</span>}
              <span className="ml-auto text-[11px] font-normal text-muted-foreground">{relativeTime(v.createdAt)}</span>
            </span>
            <span className="pl-4.5 text-[11px] text-muted-foreground">
              {authorLabel(v.authorKind, v.authorId, selfId)}
              {v.changeSummary ? ` · ${v.changeSummary}` : ''}
            </span>
            {v.version !== headVersion && (
              <button
                type="button"
                className="mt-1 ml-4.5 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRestore(v.version);
                }}
              >
                <RotateCcw className="size-3" />
                Restore this version
              </button>
            )}
          </DropdownMenuItem>
        ))}
        {!loading && versions.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">No history yet.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
