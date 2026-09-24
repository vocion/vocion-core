/**
 * The REST route must honour an artifact's audience, not just its org.
 *
 * `canOpenArtifact` used to be applied by the artifact PAGE and nothing else,
 * so `/api/artifacts/<id>` served a document marked "Only me" in full to anyone
 * signed in to the same workspace. These cases pin the rule at the layer the
 * route actually goes through.
 */

import type { ArtifactRowLookup } from './serve';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveArtifactFile } from './serve';

const ORG = 'proj-northwind';
const OWNER = 'usr-owner';
const OTHER = 'usr-other';

const rowWith = (shareAudience: 'me' | 'workspace' | 'anyone', shareOwnerId: string | null): ArtifactRowLookup =>
  async () => ({
    orgId: ORG,
    kind: 'markdown',
    url: null,
    spec: { text: 'the brief' },
    title: 'Q3 brief',
    payload: { kind: 'markdown', title: 'Q3 brief' },
    shareAudience,
    shareOwnerId,
  });

const serve = (lookupRow: ArtifactRowLookup, viewer: { userId: string | null; hasToken: boolean }) =>
  resolveArtifactFile({ callerOrgId: ORG, id: '1', lookupRow, viewer, dir: '/tmp/unused-by-card-artifacts' });

describe('resolveArtifactFile audience', () => {
  it('serves a `me` artifact to the person who chose it', async () => {
    const res = await serve(rowWith('me', OWNER), { userId: OWNER, hasToken: false });

    expect(res.status).toBe(200);
  });

  it('refuses a `me` artifact to a colleague in the same workspace', async () => {
    const res = await serve(rowWith('me', OWNER), { userId: OTHER, hasToken: false });

    // 404, not 403 — the same answer the route gives for another tenant's row,
    // so a caller learns nothing about what exists.
    expect(res.status).toBe(404);
  });

  it('refuses a `me` artifact to an API token, which is nobody', async () => {
    const res = await serve(rowWith('me', OWNER), { userId: null, hasToken: false });

    expect(res.status).toBe(404);
  });

  it('serves a `workspace` artifact to any member', async () => {
    const res = await serve(rowWith('workspace', null), { userId: OTHER, hasToken: false });

    expect(res.status).toBe(200);
  });

  it('serves an `anyone` artifact to a holder of the public link', async () => {
    const res = await serve(rowWith('anyone', null), { userId: null, hasToken: true });

    expect(res.status).toBe(200);
  });

  it('still refuses another org, whatever the audience says', async () => {
    const foreign: ArtifactRowLookup = async () => ({
      orgId: 'proj-kestrel',
      kind: 'markdown',
      url: null,
      spec: {},
      title: 'theirs',
      shareAudience: 'anyone',
      shareOwnerId: null,
    });
    const res = await serve(foreign, { userId: OTHER, hasToken: true });

    expect(res.status).toBe(404);
  });
});

/**
 * The content-addressed branch: an id like `<orgId>-<hash>` names a stored
 * FILE and has no row, so the audience check above never ran for it. A `me`
 * file artifact stores exactly that URL, which left it readable by any member
 * of the org through the legacy path while the numeric path refused them.
 *
 * These write a real file, so an allowed case returns 200 rather than a 404
 * that could equally mean "no such directory". A refusal test that cannot
 * observe the passing case is not testing the gate.
 */
describe('resolveArtifactFile audience, content-addressed ids', () => {
  const LEGACY_ID = `${ORG}-deadbeef`;
  const FILENAME = `${LEGACY_ID}.txt`;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vocion-artifacts-'));
    await writeFile(path.join(dir, FILENAME), 'the bytes', 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const legacy = (
    share: { audience: 'me' | 'workspace' | 'anyone'; ownerId: string | null } | null,
    viewer: { userId: string | null; hasToken: boolean },
  ) => resolveArtifactFile({
    callerOrgId: ORG,
    id: LEGACY_ID,
    filename: FILENAME,
    lookupRow: async () => null,
    lookupShareByFile: async () => share,
    viewer,
    dir,
  });

  it('serves the file to the owner of its `me` artifact', async () => {
    const res = await legacy({ audience: 'me', ownerId: OWNER }, { userId: OWNER, hasToken: false });

    expect(res.status).toBe(200);
  });

  it('refuses a colleague the file behind a `me` artifact', async () => {
    const res = await legacy({ audience: 'me', ownerId: OWNER }, { userId: OTHER, hasToken: false });

    expect(res.status).toBe(404);
  });

  it('refuses an API token the same file', async () => {
    const res = await legacy({ audience: 'me', ownerId: OWNER }, { userId: null, hasToken: false });

    expect(res.status).toBe(404);
  });

  it('serves a file whose artifact is workspace-shared', async () => {
    const res = await legacy({ audience: 'workspace', ownerId: null }, { userId: OTHER, hasToken: false });

    expect(res.status).toBe(200);
  });

  it('leaves a file no row claims on the org-prefix rule it always had', async () => {
    // A genuine pre-0095 orphan. It has no audience to honour, so "unknown"
    // must not become "refused" and break every legacy file at once.
    const res = await legacy(null, { userId: OTHER, hasToken: false });

    expect(res.status).toBe(200);
  });

  it('refuses an id outside the caller\'s org, before any lookup', async () => {
    let asked = false;
    const res = await resolveArtifactFile({
      callerOrgId: ORG,
      id: 'proj-kestrel-deadbeef',
      lookupRow: async () => null,
      lookupShareByFile: async () => {
        asked = true;
        return null;
      },
      viewer: { userId: OTHER, hasToken: false },
      dir,
    });

    expect(res.status).toBe(404);
    expect(asked).toBe(false);
  });
});
