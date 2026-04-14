import { ORPCError } from '@orpc/server';
import { API_ERROR_CODE } from '@/types/ApiError';

export const ApiError = {
  unauthorized: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.UNAUTHORIZED, { status: 401, data: clientData }),
  forbidden: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.FORBIDDEN, { status: 403, data: clientData }),
  notFound: (clientData?: any) =>
    new ORPCError(API_ERROR_CODE.NOT_FOUND, { status: 404, data: clientData }),
};
