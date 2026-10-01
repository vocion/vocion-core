import { describe, expect, it } from 'vitest';
import { sentryRefOf } from './reference';

describe('which Sentry project an environment reports to', () => {
  it('reads the structured field, defaulting the environment to the record\'s stage', () => {
    expect(sentryRefOf({ stage: 'production', observability: { sentry: { org: 'northwind', project: 'northwind-api' } } }))
      .toEqual({ org: 'northwind', project: 'northwind-api', environment: 'production', from: 'sentry' });
    expect(sentryRefOf({ stage: 'production', observability: { sentry: { org: 'northwind', project: 'northwind-api', environment: 'prod' } } })?.environment).toBe('prod');
  });

  it('still reads the free-text line records were written with, so none needs a migration', () => {
    expect(sentryRefOf({ stage: 'staging', observability: { errors: 'Sentry northwind/northwind-web' } }))
      .toEqual({ org: 'northwind', project: 'northwind-web', environment: 'staging', from: 'errors' });
  });

  it('prefers the structured field, and reads nothing from a line that is not Sentry\'s or holds no pair', () => {
    expect(sentryRefOf({ observability: { sentry: { org: 'northwind', project: 'a' }, errors: 'Sentry other/b' } })?.project).toBe('a');
    expect(sentryRefOf({ observability: { errors: 'Rollbar northwind/api' } })).toBeNull();
    expect(sentryRefOf({ observability: { errors: 'Sentry, ask the team' } })).toBeNull();
    expect(sentryRefOf({})).toBeNull();
  });
});
