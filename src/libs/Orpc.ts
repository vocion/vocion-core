import type { RouterClient } from '@orpc/server';
import type { router } from '@/routers';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

const link = new RPCLink({
  url: () => {
    if (typeof window === 'undefined') {
      // eslint-disable-next-line unicorn/prefer-type-error
      throw new Error('RPCLink is not allowed on the server side.');
    }

    return `${window.location.origin}/rpc`;
  },
});

export const client: RouterClient<typeof router> = createORPCClient(link);
