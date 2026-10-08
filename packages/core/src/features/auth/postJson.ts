/**
 * POST JSON to one of the auth routes and read the answer in one shape:
 * the body on success, or the route's `code`, its sentence and how long a 429
 * asked to wait. Each form maps the code to its own translated words, so a
 * server sentence only shows when the code is one the form does not know.
 */

export type PostJsonResult<T>
  = | { ok: true; data: T }
    | { ok: false; status: number; code: string | null; error: string | null; retryAfterMinutes: number | null };

/**
 * @param url - The route.
 * @param body - The JSON body; omitted sends none.
 */
export async function postJson<T>(url: string, body?: unknown): Promise<PostJsonResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: null, error: null, retryAfterMinutes: null };
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.ok) {
    return { ok: true, data: data as T };
  }
  const retryAfter = Number(response.headers.get('retry-after'));
  return {
    ok: false,
    status: response.status,
    code: typeof data?.code === 'string' ? data.code : null,
    error: typeof data?.error === 'string' ? data.error : null,
    retryAfterMinutes: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(1, Math.ceil(retryAfter / 60)) : null,
  };
}

/**
 * Where to go after a step finishes: the requested page when it is on this
 * site, else the dashboard — never another origin a crafted link named.
 * @param callbackUrl - The `callbackUrl` the page was opened with.
 */
export function sameOriginDestination(callbackUrl: string): string {
  try {
    const target = new URL(callbackUrl, window.location.href);
    return target.origin === window.location.origin ? target.toString() : '/dashboard';
  } catch {
    return '/dashboard';
  }
}
