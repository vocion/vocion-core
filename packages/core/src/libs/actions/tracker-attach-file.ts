/**
 * `tracker.attach_file` — the mockup on the issue before a person decides it,
 * the after-shot on it when it ships. The designer draws into the workspace's
 * artifact store; this carries the file to where the client looks. Bytes come
 * from a stored artifact (by id or by its url) or from a URL the workspace can
 * reach; only an image or a PDF is attached, because that is what a board
 * reader opens. Undo deletes the attachment: reversible, `low`.
 */

import type { Action } from './types';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

export const ATTACH_FILE_ACTION_ID = 'tracker.attach_file';

/** The wire cap on a file fetched by URL; Jira's own default attachment limit is 10 MB. */
const MAX_BYTES = 10 * 1024 * 1024;

const attachInput = z.object({
  key: z.string().min(3).max(40).describe('The issue key, e.g. NOCO-123.'),
  artifactId: z.coerce.number().int().positive().optional().describe('An artifact of this workspace (a mockup, an after-shot) by its id.'),
  url: z.string().min(1).max(2000).optional().describe('Or the file\'s URL: a stored artifact url (/api/artifacts/…), or an https URL of an image or PDF the workspace can reach.'),
  filename: z.string().min(1).max(200).optional().describe('The name the attachment gets; derived from the source when omitted.'),
  caption: z.string().max(300).optional().describe('What the file shows, for the card and the record.'),
}).refine(i => i.artifactId !== undefined || i.url !== undefined, { message: 'Give an artifactId or a url.' });

type Input = z.infer<typeof attachInput>;

type Loaded = { filename: string; mimeType: string; bytes: Buffer };

async function loadFile(orgId: string, input: Input): Promise<Loaded> {
  let url = input.url ?? null;
  if (input.artifactId !== undefined) {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { artifactSchema } = await import('@/models/Schema');
    const [row] = await db.select({ url: artifactSchema.url, title: artifactSchema.title }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, input.artifactId))).limit(1);
    if (!row?.url) {
      throw new Error(`Artifact #${input.artifactId} is not in this workspace or holds no file.`);
    }
    url = row.url;
  }
  if (!url) {
    throw new Error('Give an artifactId or a url.');
  }
  const { isStoredArtifactUrl } = await import('@/libs/tools/artifacts/url');
  const { sniffImage, CONTENT_TYPES } = await import('@/libs/tools/image/inspect');
  const name = input.filename ?? (url.split(/[?#]/)[0]!.split('/').pop() || 'attachment');
  if (isStoredArtifactUrl(url)) {
    const { readStoredArtifact } = await import('@/libs/tools/artifacts/ingest');
    const bytes = await readStoredArtifact(orgId, url);
    if (!bytes) {
      throw new Error('The stored copy of that artifact is not in the artifact store.');
    }
    const kind = sniffImage(bytes);
    const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!kind && !isPdf) {
      throw new Error('That artifact is neither an image nor a PDF; only those are attached.');
    }
    return { filename: name, mimeType: kind ? CONTENT_TYPES[kind] : 'application/pdf', bytes };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${res.status}.`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`${url} is ${bytes.byteLength} bytes; the cap is ${MAX_BYTES}.`);
  }
  const kind = sniffImage(bytes);
  const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!kind && !isPdf) {
    throw new Error(`${url} is neither an image nor a PDF (${res.headers.get('content-type') ?? 'unknown type'}); only those are attached.`);
  }
  return { filename: name, mimeType: kind ? CONTENT_TYPES[kind] : 'application/pdf', bytes };
}

export const trackerAttachFileAction: Action<typeof attachInput> = {
  id: ATTACH_FILE_ACTION_ID,
  name: 'Attach a file to a tracker issue',
  description: 'Attach an image or PDF — a mockup, an after-shot, a report — to an issue of the connected issue tracker, from an artifact of this workspace (artifactId or its url) or from a URL. Undo deletes the attachment.',
  inputSchema: attachInput,
  grant: 'factory_write',
  external: true,
  dedupKeyFor: input => `${ATTACH_FILE_ACTION_ID}:${input.key.trim().toUpperCase()}:${input.artifactId !== undefined ? `artifact:${input.artifactId}` : input.url}`.slice(0, 400),
  ownsDedupKey: true,
  async precheck(_ctx, input) {
    if (!input.url) {
      return undefined;
    }
    const { isStoredArtifactUrl } = await import('@/libs/tools/artifacts/url');
    if (!/^https?:\/\//i.test(input.url) && !isStoredArtifactUrl(input.url)) {
      return `${input.url} is neither a stored artifact url nor an https URL, so there is nothing to fetch.`;
    }
    return undefined;
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    return {
      title: `Attach ${input.filename ?? (input.artifactId !== undefined ? `artifact #${input.artifactId}` : 'a file')} to ${input.key.toUpperCase()}`,
      system: 'Issue tracker',
      headline: 'Attach the file to the issue now; Undo deletes the attachment.',
      badges: [{ label: 'Issue tracker' }, { label: 'Undo deletes the attachment' }],
      ...(input.url && /\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(input.url) ? { content: [{ kind: 'image' as const, id: 'file', label: input.caption ?? 'Attachment', url: input.url }] } : {}),
      fields: [
        { label: 'Issue', value: input.key.toUpperCase() },
        ...(input.artifactId !== undefined ? [{ label: 'Artifact', value: `#${input.artifactId}` }] : []),
        ...(input.url ? [{ label: 'File', value: input.filename ?? input.url, href: input.url }] : []),
        ...(input.caption ? [{ label: 'Shows', value: input.caption }] : []),
      ],
      nextAction: 'Approving attaches the file now.',
      verbs: { approve: 'Attach it', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const key = input.key.trim().toUpperCase();
    const [provider, file] = await Promise.all([trackerProviderFor(ctx.orgId, { issueKey: key }), loadFile(ctx.orgId, input)]);
    const attached = await provider.attach(key, file);
    return { attached: true, key, attachmentId: attached.id, filename: file.filename, mimeType: file.mimeType, bytes: file.bytes.byteLength, url: provider.issueUrl(key), line: `Attached ${file.filename} to ${key}${input.caption ? `: ${input.caption}` : ''}` };
  },
  async undo(ctx, input, result) {
    const key = typeof result?.key === 'string' ? result.key : input.key.trim().toUpperCase();
    const attachmentId = typeof result?.attachmentId === 'string' ? result.attachmentId : null;
    if (!attachmentId) {
      throw new Error('This run recorded no attachment, so there is nothing to take back.');
    }
    const { trackerProviderFor } = await import('@/services/tracker/provider');
    const provider = await trackerProviderFor(ctx.orgId, { issueKey: key });
    await provider.deleteAttachment(attachmentId);
    return { deleted: true, key, attachmentId, line: `Deleted the attachment from ${key}.` };
  },
};
