import { beforeEach, describe, expect, it } from 'vitest';
import { cameFrom, resetTrailForTests, visited } from './cameFrom';

describe('where the person came from (#269: Merge should go back to Work)', () => {
  beforeEach(() => resetTrailForTests());

  it('remembers the page before this one, with its query; a query change on the same page moves nothing', () => {
    expect(cameFrom()).toBeNull();

    visited('/w/northwind/dashboard/p/work?product=share');
    visited('/w/northwind/dashboard/p/work?product=share&view=board');

    expect(cameFrom()).toBeNull();

    visited('/w/northwind/dashboard/inbox/proposal-12');

    expect(cameFrom()).toBe('/w/northwind/dashboard/p/work?product=share&view=board');

    visited('/w/northwind/dashboard/inbox/proposal-13');

    expect(cameFrom()).toBe('/w/northwind/dashboard/inbox/proposal-12');
  });
});
