import { describe, expect, it } from 'vitest';
import { isPrivateAddress, urlShape } from './publicUrl';

describe('isPrivateAddress', () => {
  it('knows the ranges a public client cannot reach', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('lets a real public address through', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.167.1.1', '93.184.216.34']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('covers IPv6, including an IPv4 address wearing a v6 hat', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('refuses anything it cannot parse rather than guessing', () => {
    expect(isPrivateAddress('not-an-address')).toBe(true);
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
  });
});

describe('urlShape', () => {
  it('accepts an ordinary https URL', () => {
    const v = urlShape('https://northwind.example/logo.png');

    expect(v.ok).toBe(true);
  });

  it('refuses a scheme that is not http(s), naming it', () => {
    const v = urlShape('file:///etc/passwd');

    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toContain('file://');
  });

  it('refuses localhost and the names that mean this network', () => {
    for (const u of ['http://localhost:3000/a.png', 'http://api.internal/a.png', 'http://printer.local/a.png']) {
      expect(urlShape(u).ok, u).toBe(false);
    }
  });

  it('refuses a private address written as a literal, including the metadata service', () => {
    for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/a.png', 'http://[::1]/a.png', 'http://10.1.2.3/a.png']) {
      expect(urlShape(u).ok, u).toBe(false);
    }
  });

  it('refuses something that is not a URL at all', () => {
    expect(urlShape('logo.png').ok).toBe(false);
  });
});
