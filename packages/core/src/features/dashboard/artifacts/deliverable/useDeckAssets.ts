'use client';

/**
 * A deck's images as data URIs, for its sandboxed page frames.
 *
 * A frame with no `allow-same-origin` has an opaque origin, so a request it
 * makes for `/api/artifacts/…` is cross-site and goes without the session
 * cookie. The pane fetches each asset once, as the person, and hands the
 * frame the bytes. Until one arrives (or if it cannot be fetched) the frame
 * gets the served URL, which is no worse than before.
 */

import type { DeckAsset } from '@/libs/cards/specs';
import { useEffect, useState } from 'react';
import { artifactHref } from '@/libs/tools/artifacts/url';

const cache = new Map<string, Promise<string | null>>();

function dataUrl(url: string): Promise<string | null> {
  let hit = cache.get(url);
  if (!hit) {
    hit = fetch(url, { credentials: 'same-origin' })
      .then(res => (res.ok ? res.blob() : null))
      .then(blob => (blob
        ? new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          })
        : null))
      .catch(() => null);
    cache.set(url, hit);
  }
  return hit;
}

/**
 * The resolver a deck's page frames use: `asset:<id>` → a data URI once fetched, else the served URL.
 * @param assets - The deck's assets.
 */
export function useDeckAssets(assets: Record<string, DeckAsset> | undefined): (id: string) => string | null {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const key = JSON.stringify(Object.entries(assets ?? {}).map(([id, a]) => [id, a.url]));

  useEffect(() => {
    let live = true;
    const entries = JSON.parse(key) as Array<[string, string]>;
    void Promise.all(entries.map(async ([id, url]) => [id, await dataUrl(artifactHref(url))] as const)).then((pairs) => {
      if (live) {
        setResolved(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p[1] !== null)));
      }
    });
    return () => {
      live = false;
    };
  }, [key]);

  return (id: string) => resolved[id] ?? (assets?.[id] ? artifactHref(assets[id].url) : null);
}
