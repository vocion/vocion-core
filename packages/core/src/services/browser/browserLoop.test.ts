import { describe, expect, it } from 'vitest';
import { fillSecrets, maskSecrets } from './browserLoop';

describe('a secret input', () => {
  const secrets = { password: 'fixture-pass-42' };

  it('reaches the page only as the engine types it', () => {
    expect(fillSecrets('{{password}}', secrets, {})).toBe('fixture-pass-42');
    expect(fillSecrets('{{ password }}', secrets, {})).toBe('fixture-pass-42');
    expect(fillSecrets('{{email}}', secrets, { email: 'ap@larkfield.example' })).toBe('ap@larkfield.example');
    expect(fillSecrets('{{unknown}}', secrets, {})).toBe('{{unknown}}');
  });

  it('is never read back: any echo of its value is its placeholder again', () => {
    expect(maskSecrets('textbox "Password": fixture-pass-42', secrets)).toBe('textbox "Password": {{password}}');
  });
});
