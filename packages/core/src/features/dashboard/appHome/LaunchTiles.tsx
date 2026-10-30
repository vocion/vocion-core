'use client';

import type { Tint } from '@/libs/tints';
import type { AppLaunchTile } from '@/libs/workspace/schemas';
import { useState } from 'react';
import { CatalogCard } from '@/components/patterns';
import { LetterTile } from '@/components/ui/letter-tile';
import { iconByName } from '@/features/dashboard/iconByName';
import { useRouter } from '@/libs/I18nNavigation';
import { tileHref } from '@/libs/workspace/appHomeLinks';
import { cn } from '@/utils/Helpers';

/** The words, plain strings (a server page hands them over); `drop` carries `{types}`. */
type Labels = { start: string; open: string; run: string; drop: string; dropping: string; dropFailed: string };

/**
 * "Start something": the app's launch tiles (`app.yaml` `home.launch`), the
 * one emphasized thing on its home. Each is a front door (`CatalogCard`, the
 * app's tint): one title, one plain line, one action. A tile that `accepts`
 * files takes a drop: the file is uploaded the way the composer uploads one
 * and Chat opens with it attached under the tile's words, for the person to
 * finish and send.
 *
 * Two columns on a phone, three on a wide screen.
 * @param props
 * @param props.tiles - The tiles, in the manifest's order.
 * @param props.tint - The app's tint.
 * @param props.labels - The words.
 * @param props.first - The empty home: the tile shows its `firstTitle` ("Onboard your first client").
 */
export function LaunchTiles({ tiles, tint, labels, first = false }: { tiles: AppLaunchTile[]; tint: Tint; labels: Labels; first?: boolean }) {
  return (
    <div data-testid="home-launch" className={cn('grid auto-rows-fr gap-3', tiles.length === 1 ? 'grid-cols-1 sm:max-w-sm' : 'grid-cols-2 lg:grid-cols-3')}>
      {tiles.map(tile => <Tile key={tile.title} tile={tile} tint={tint} labels={labels} title={first ? tile.firstTitle ?? tile.title : tile.title} />)}
    </div>
  );
}

function Tile({ tile, tint, labels, title }: { tile: AppLaunchTile; tint: Tint; labels: Labels; title: string }) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const accepts = tile.accepts ?? [];
  const label = tile.href ? labels.open : tile.workflow ? labels.run : labels.start;
  const card = (
    <CatalogCard
      tint={tint}
      title={title}
      job={tile.description}
      // On a phone two tiles share a row: the mark sits out, so the words get the width.
      lead={<span className="hidden sm:block"><LetterTile name={title} icon={iconByName(tile.icon)} tint={tint} size="md" /></span>}
      action={{ label, href: tileHref(tile) }}
      meta={accepts.length > 0 ? (note ?? labels.drop.replace('{types}', accepts.join(', '))) : undefined}
      className={cn('p-3.5 sm:p-5 [&>div]:gap-0 sm:[&>div]:gap-3', over && 'ring-2 ring-ring/50')}
    />
  );
  if (accepts.length === 0) {
    return <div data-testid="home-tile" data-tile={title} className="h-full">{card}</div>;
  }
  const take = async (files: File[]) => {
    const wanted = files.filter(f => accepts.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (wanted.length === 0) {
      setNote(labels.drop.replace('{types}', accepts.join(', ')));
      return;
    }
    setNote(labels.dropping);
    try {
      const { uploadAttachments } = await import('@/features/dashboard/chat/attachmentUpload');
      const { attachments } = await uploadAttachments(wanted, null);
      if (attachments.length === 0) {
        setNote(labels.dropFailed);
        return;
      }
      router.push(`${tileHref(tile)}&attach=${attachments.map(a => a.id).join(',')}`);
    } catch {
      setNote(labels.dropFailed);
    }
  };
  return (
    <div
      data-testid="home-tile"
      data-tile={title}
      data-accepts={accepts.join(',')}
      className="h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take([...e.dataTransfer.files]);
      }}
    >
      {card}
    </div>
  );
}
