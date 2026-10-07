import type { RouterClient } from '@orpc/server';
import type { router } from '@/routers';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { isServer } from '@/utils/Helpers';

const link = new RPCLink({
  url: () => {
    if (isServer()) {
      throw new Error('RPCLink is not allowed on the server side.');
    }

    return `${window.location.origin}/rpc`;
  },
});

/**
 * `fetch` that never reads or writes the HTTP cache. A revealed credential
 * must reach the page once, for that click, and stay in nothing else.
 * @param request - The request the link built.
 * @param init - Extra options the link passes through.
 * @param init.redirect
 */
async function fetchWithoutCache(request: Request, init: { redirect?: Request['redirect'] }): Promise<Response> {
  return fetch(request, { ...init, cache: 'no-store' });
}

const noStoreLink = new RPCLink({
  url: () => {
    if (isServer()) {
      throw new Error('RPCLink is not allowed on the server side.');
    }

    return `${window.location.origin}/rpc`;
  },
  fetch: fetchWithoutCache,
});

/** The client for calls whose answer is a secret: the response is never cached. */
export const noStoreClient: RouterClient<typeof router> = createORPCClient(noStoreLink);

export const client: RouterClient<typeof router> = createORPCClient(link);
