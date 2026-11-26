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

  it('reads the hex spelling `new URL` produces, not just the dotted one', () => {
    const hostname = new URL('https://[::ffff:127.0.0.1]/').hostname;

    expect(hostname).toBe('[::ffff:7f00:1]');
    expect(isPrivateAddress(hostname)).toBe(true);
  });

  it('judges an IPv4 address embedded in mapped, compatible, NAT64 and 6to4 forms by the IPv4 rules', () => {
    const privateEmbedded = [
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '::ffff:a9fe:a9fe', // mapped: 127.0.0.1, 10.0.0.1, 169.254.169.254
      '::7f00:1',
      '::a00:1',
      '::a9fe:a9fe',
      '::127.0.0.1', // compatible
      '64:ff9b::7f00:1',
      '64:ff9b::a00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::10.0.0.1', // NAT64
      '2002:7f00:1::',
      '2002:a00:1::1',
      '2002:a9fe:a9fe::', // 6to4
      '::ffff:0:7f00:1',
      '0:0:0:0:ffff:0:7f00:1',
      '::ffff:0:a00:1',
      '::ffff:0:a9fe:a9fe', // IPv4-translated (SIIT): 127.0.0.1, 10.0.0.1, 169.254.169.254
    ];
    for (const ip of privateEmbedded) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('keeps a public IPv4 public inside those forms, and a public IPv6 public', () => {
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '::ffff:0:808:808', '0:0:0:0:ffff:0:808:808', '64:ff9b::808:808', '2002:808:808::1', '2606:4700::1111', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses the special-use IPv6 ranges', () => {
    for (const ip of ['::', '::1', '0:0:0:0:0:0:0:1', '64:ff9b:1::1', '64:ff9b:1:ffff::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '100::1', '100:0:0:0:ffff::1', 'fec0::1', 'febf::1', 'fc00::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('does not over-block next to those ranges', () => {
    for (const ip of ['2001:4860:4860::8888', '2001:1::1', '100:0:0:1::1', '64:ff9b:2::1', 'fe00::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses a malformed IPv6 rather than guessing', () => {
    for (const ip of ['1::2::3', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '::ffff:1.2.3', '::ffff:1.2.3.999', 'gggg::1', '::12345', 'fe80::1%eth0']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
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

  it('refuses localhost written with a trailing dot', () => {
    for (const u of ['https://localhost./', 'http://api.internal./a.png']) {
      expect(urlShape(u).ok, u).toBe(false);
    }
  });

  it('refuses a private address written as a literal, including the metadata service', () => {
    for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/a.png', 'http://[::1]/a.png', 'http://10.1.2.3/a.png', 'http://[::ffff:127.0.0.1]/a.png', 'http://[::ffff:169.254.169.254]/a.png']) {
      expect(urlShape(u).ok, u).toBe(false);
    }
  });

  it('refuses something that is not a URL at all', () => {
    expect(urlShape('logo.png').ok).toBe(false);
  });
});
