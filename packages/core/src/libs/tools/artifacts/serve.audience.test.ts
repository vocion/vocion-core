/**
 * The REST route must honour an artifact's audience, not just its org.
 *
 * `canOpenArtifact` used to be applied by the artifact PAGE and nothing else,
 * so `/api/artifacts/<id>` served a document marked "Only me" in full to anyone
 * signed in to the same workspace. These cases pin the rule at the layer the
 * route actually goes through.
 */

import type { ArtifactRowLookup } from './serve';
import { describe, expect, it } from 'vitest';
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
