import { ORPCError } from '@orpc/server';
import { API_ERROR_CODE } from '@/types/ApiError';

export const ApiError = {
  unauthorized: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.UNAUTHORIZED, { status: 401, data: clientData }),
  forbidden: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.FORBIDDEN, { status: 403, data: clientData }),
  notFound: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.NOT_FOUND, { status: 404, data: clientData }),
  badRequest: (message?: string) =>
    new ORPCError(API_ERROR_CODE.BAD_REQUEST, { status: 400, message }),
  tooManyRequests: (message: string, retryAfterSeconds: number) =>
    new ORPCError(API_ERROR_CODE.TOO_MANY_REQUESTS, { status: 429, message, data: { retryAfterSeconds } }),
  /**
   * Nothing ran: what the item was proposed on changed. The message is the
   * one line a person reads; `data.stale` carries it typed (what changed,
   * where to see it, whether it can be redrafted) for a surface that offers
   * "Proceed anyway" (approve again with `overrideStale`) and "Redraft".
   * @param stale
   * @param stale.line
   */
  stale: (stale: { line: string; [key: string]: unknown }) =>
    new ORPCError(API_ERROR_CODE.STALE, { status: 409, message: `Not run: ${stale.line}`, data: { stale } }),
};
