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

export const client: RouterClient<typeof router> = createORPCClient(link);
