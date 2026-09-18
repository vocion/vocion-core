import type { NextResponse } from 'next/server';
import type { Ask } from '@/services/AskService';
import { workspaceUrl } from '@/libs/links';
import { AskError } from '@/services/AskService';
import { projectSlugById } from '@/services/ProjectService';
import { jsonError } from '../_shared';

/** An ask as the API returns it: the row plus the canonical link to decide it. */
export type ApiAsk = Ask & {
  /**
   * Where a person decides this ask — `/w/<workspace>/dashboard/inbox/<id>`,
   * absolute when `NEXT_PUBLIC_APP_URL` is set. Workspace-aware (libs/links.ts),
   * so a filer can paste it into Slack or an approval file and it opens the
   * right workspace. Null only when the project row is gone.
   */
  url: string | null;
};

/**
 * Attach the canonical inbox link to each ask of one org. One slug lookup per
 * response, not per row.
 * @param orgId - Project id the asks belong to.
 * @param asks - Rows from AskService.
 */
export async function withAskUrls<T extends Ask>(orgId: string, asks: T[]): Promise<(T & { url: string | null })[]> {
  const slug = asks.length ? await projectSlugById(orgId) : null;
  return asks.map(a => ({ ...a, url: slug ? workspaceUrl(slug, `/dashboard/inbox/${a.id}`, { absolute: true }) : null }));
}

/**
 * {@link withAskUrls} for a single ask.
 * @param orgId - Project id.
 * @param ask - The row.
 */
export async function withAskUrl<T extends Ask>(orgId: string, ask: T): Promise<T & { url: string | null }> {
  const [row] = await withAskUrls(orgId, [ask]);
  return row!;
}

/**
 * Map an AskError onto the API's error envelope; rethrow anything else so a
 * genuine fault still surfaces as a 500 with a stack trace.
 * @param error - Whatever the service threw.
 */
export function askErrorResponse(error: unknown): NextResponse {
  if (error instanceof AskError) {
    return jsonError(error.code, error.message, error.status);
  }
  throw error;
}

/**
 * Read an optional string field: a non-empty trimmed string, `null` when the
 * caller sent null or an empty string, `undefined` when the key is absent.
 * @param body
 * @param key
 */
export function optStr(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) {
    return undefined;
  }
  const v = body[key];
  if (v === null) {
    return null;
  }
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Read an optional ISO-8601 timestamp field: a `Date`, `undefined` when the key
 * is absent, `null` when the caller sent null or an empty string (clear it), or
 * the 400 body to send back when the string does not parse.
 * @param body
 * @param key
 */
export function optDate(body: Record<string, unknown>, key: string): Date | null | undefined | NextResponse {
  if (!(key in body)) {
    return undefined;
  }
  const v = body[key];
  if (v === null || v === '') {
    return null;
  }
  const d = typeof v === 'string' ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) {
    return jsonError('VALIDATION_FAILED', `${key} must be an ISO-8601 timestamp`, 400);
  }
  return d;
}
