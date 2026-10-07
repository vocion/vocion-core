/**
 * The shapes a REST credential's `headerName` and `scheme` may take. A leaf
 * with no imports, because two places check them: the platform registry when
 * the credential is saved (and the browser form reads the registry), and the
 * REST client before every call.
 */

/**
 * A header name as HTTP allows it (an RFC 9110 token), other than the headers
 * the request sets itself or the transport owns: a token sent in one of those
 * would be overwritten, or would break the request.
 */
export const HEADER_NAME_PATTERN = /^(?!(?:accept|content-type|content-length|host|connection|transfer-encoding)$)[\w!#$%&'*+.^`|~-]{1,64}$/i;

/** A scheme word (an RFC 9110 token): `Bearer`, `Token`, or `none` for a bare token. */
export const AUTH_SCHEME_PATTERN = /^[\w!#$%&'*+.^`|~-]{1,40}$/;
