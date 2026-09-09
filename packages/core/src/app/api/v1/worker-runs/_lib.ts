import type { NextResponse } from 'next/server';
import { WorkerRunError } from '@/services/WorkerRunService';
import { jsonError } from '../_shared';

/**
 * Map a WorkerRunError onto the API's error envelope; rethrow anything else.
 * @param error - Whatever the service threw.
 */
export function workerRunErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkerRunError) {
    return jsonError(error.code, error.message, error.status);
  }
  throw error;
}

/**
 * Read a required non-empty string field, or null.
 * @param body
 * @param key
 */
export function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Read an optional plain-object field.
 * @param body
 * @param key
 */
export function obj(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}
