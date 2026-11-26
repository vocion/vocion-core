import { describe, expect, it } from 'vitest';

import { connectorKindOf } from './families';

describe('connectorKindOf', () => {
  it('names a connector source by its `_connector`, not its stored kind', () => {
    // Sources added from the Connectors page are stored as kind `plugin`, so
    // the kind column alone would never say "zendesk".
    expect(connectorKindOf('plugin', { _connector: 'zendesk' })).toBe('zendesk');
  });

  it('falls back to the kind column when the config names no connector', () => {
    // A local-files source that took the slug `zendesk` is still local
    // files: the Tools page and the agent tools must both skip it.
    expect(connectorKindOf('local-files', {})).toBe('local-files');
    expect(connectorKindOf('local-files', null)).toBe('local-files');
  });

  it('ignores an empty or non-string `_connector`', () => {
    expect(connectorKindOf('local-files', { _connector: '' })).toBe('local-files');
    expect(connectorKindOf('local-files', { _connector: 42 })).toBe('local-files');
  });
});
