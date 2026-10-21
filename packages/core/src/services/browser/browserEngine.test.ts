import { afterEach, describe, expect, it, vi } from 'vitest';
import { mayLoad } from './browserEngine';
import { PRACTICE_ORIGIN } from './practiceSite';

describe('where a person\'s browser may go', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens the practice site, which never reaches the network', async () => {
    await expect(mayLoad(`${PRACTICE_ORIGIN}/login`)).resolves.toBe(true);
  });

  it('never opens the box itself, a private network or the cloud metadata address, whatever the page asked', async () => {
    for (const url of ['http://localhost:3000/api/internal/agent-tools', 'http://127.0.0.1:5432', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.8/admin', 'http://[::1]/']) {
      await expect(mayLoad(url)).resolves.toBe(false);
    }
  });

  it('opens only web pages: no files, no other schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'chrome://settings', 'not a url']) {
      await expect(mayLoad(url)).resolves.toBe(false);
    }
  });

  it('opens a named private host when the installation allows it, for a test or a demo', async () => {
    vi.stubEnv('VOCION_BROWSER_ALLOW_HOSTS', 'localhost:4010');

    await expect(mayLoad('http://localhost:4010/portal')).resolves.toBe(true);
    await expect(mayLoad('http://localhost:4011/portal')).resolves.toBe(false);
  });
});
