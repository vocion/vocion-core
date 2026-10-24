'use client';

import type { ChatMessageArtifact } from './types';
import { useEffect, useState } from 'react';
import { client } from '@/libs/Orpc';

/**
 * What each artifact an answer links to is called, for its chip — read once
 * per artifact per page and shared by every answer that names it. An id the
 * server will not read (gone, another workspace's) gets no chip: the link in
 * the prose is the server's promise it exists, and the read is its proof.
 */
const known = new Map<number, ChatMessageArtifact | null>();
const reading = new Map<number, Promise<void>>();

function read(id: number): Promise<void> {
  const inFlight = reading.get(id);
  if (inFlight) {
    return inFlight;
  }
  const p = client.artifacts.get({ id })
    .then((a) => {
      known.set(id, { id: a.id, title: a.title, kind: a.kind as ChatMessageArtifact['kind'], version: a.version });
    })
    .catch(() => {
      known.set(id, null);
    })
    .finally(() => {
      reading.delete(id);
    });
  reading.set(id, p);
  return p;
}

const NONE: ChatMessageArtifact[] = [];

/**
 * The chips for artifacts an answer links to but did not write.
 * @param ids - The linked ids (`linkedArtifactIds`), minus the turn's own.
 */
export function useReferencedArtifacts(ids: readonly number[]): ChatMessageArtifact[] {
  const key = ids.join(',');
  const [resolved, setResolved] = useState<{ key: string; list: ChatMessageArtifact[] }>({ key: '', list: NONE });
  useEffect(() => {
    if (!key) {
      return;
    }
    const wanted = key.split(',').map(Number);
    let live = true;
    void Promise.all(wanted.filter(id => !known.has(id)).map(read)).then(() => {
      if (live) {
        setResolved({ key, list: wanted.map(id => known.get(id)).filter((a): a is ChatMessageArtifact => Boolean(a)) });
      }
    });
    return () => {
      live = false;
    };
  }, [key]);
  return resolved.key === key && key ? resolved.list : NONE;
}
