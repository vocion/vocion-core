import { os } from '@orpc/server';
import { headers } from 'next/headers';
import { logger } from '@/libs/Logger';

export const ping = os
  .use(async ({ next }) => next({
    context: {
      headers: await headers(),
    },
  }))
  .handler(async () => {
    logger.info('Counter has been incremented');

    return {
      hello: 'world',
    };
  });
