import type { NextResponse } from 'next/server';
import { AskError } from '@/services/AskService';
import { jsonError } from '../_shared';

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
