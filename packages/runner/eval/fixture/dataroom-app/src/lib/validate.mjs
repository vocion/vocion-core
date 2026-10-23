export class HttpError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const notFound = () => new HttpError(404, 'not_found');
export const forbidden = () => new HttpError(403, 'forbidden');
export const badRequest = (code, detail) => new HttpError(400, code, detail);

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value.trim());
}

export function requireString(value, code, { min = 1, max = 200 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min || s.length > max) {
    throw badRequest(code);
  }
  return s;
}
