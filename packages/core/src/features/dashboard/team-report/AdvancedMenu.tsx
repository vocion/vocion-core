'use client';

import { ChevronDown, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Link } from '@/libs/I18nNavigation';

/**
 * Advanced (spec §11): every file reference on the report lives here and
 * nowhere else. Vocion is Git-backed without looking Git-backed on the
 * executive page.
 * @param props
 * @param props.teams - Slugs to offer "Edit teams/<slug>.yaml" for.
 */
export function AdvancedMenu({ teams }: { teams: { slug: string; name: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Advanced">
          Advanced
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Workspace as code</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/workspace" className="flex items-center gap-2">
            <FileCode2 className="size-3.5" aria-hidden />
            <span>
              Edit
              {' '}
              <code className="font-mono text-[12px]">workspace.yaml</code>
            </span>
          </Link>
        </DropdownMenuItem>
        {teams.length > 0 && <DropdownMenuSeparator />}
        {teams.map(t => (
          <DropdownMenuItem key={t.slug} asChild>
            <Link href={`/dashboard/teams/${encodeURIComponent(t.slug)}`} className="flex items-center gap-2">
              <FileCode2 className="size-3.5" aria-hidden />
              <span className="truncate">
                Edit
                {' '}
                <code className="font-mono text-[12px]">{`teams/${t.slug}.yaml`}</code>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/docs/guides/team-performance">How measures are read</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
