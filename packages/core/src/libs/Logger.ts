import type { AsyncSink } from '@logtape/logtape';
import { configure, fromAsyncSink, getConsoleSink, getJsonLinesFormatter, getLogger } from '@logtape/logtape';
import { Env } from './Env';

const betterStackSink: AsyncSink = async (record) => {
  await fetch(`https://${Env.NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Env.NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN}`,
    },
    body: JSON.stringify(record),
  });
};

const canForwardToBetterStack = Boolean(Env.NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN) && Boolean(Env.NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST);

// Not awaited on purpose. This module is reached by the Temporal worker and
// the CLI scripts through tsx, which compiles the package as CommonJS, and a
// top-level await is a hard transform error there ("Top-level await is
// currently not supported with the cjs output format"). That killed every
// scheduled mission check on a box the moment the agent harness, which
// imports this file, was loaded. configure() does its work right after its
// first internal await, so sinks attach a microtask after this module loads;
// a record logged before that has no sink, which is what happened before
// this module finished loading anyway. Load failures are reported on the
// console instead of taking the process down.
void configure({
  sinks: {
    console: getConsoleSink({ formatter: getJsonLinesFormatter() }),
    betterStack: fromAsyncSink(betterStackSink),
  },
  loggers: [
    { category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
    {
      category: ['app'],
      sinks: canForwardToBetterStack ? ['console', 'betterStack'] : ['console'],
      lowestLevel: Env.NEXT_PUBLIC_LOGGING_LEVEL,
    },
  ],
}).catch((error: unknown) => {
  console.error('[logger] configure failed', error);
});

export const logger = getLogger(['app']);
