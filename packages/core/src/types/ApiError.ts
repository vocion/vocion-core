export const API_ERROR_CODE = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not-found',
  BAD_REQUEST: 'bad-request',
  TOO_MANY_REQUESTS: 'too-many-requests',
  /** What a recommendation was proposed on changed before it was approved. `data.stale` says what. */
  STALE: 'STALE',
} as const;
