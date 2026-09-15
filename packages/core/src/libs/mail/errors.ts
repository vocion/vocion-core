/**
 * The one error type outbound mail raises. `code` is what a caller switches
 * on; `status` is the HTTP status a route would return for it.
 */
export class MailError extends Error {
  constructor(
    public readonly code: 'DISABLED' | 'MISCONFIGURED' | 'PROVIDER',
    message: string,
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = 'MailError';
  }
}
