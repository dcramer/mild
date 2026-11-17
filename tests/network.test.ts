import type * as ChildProcess from 'node:child_process';
import type * as Os from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { listenAddresses, machineNames, resolveHere } from '../src/cli/network.ts';
import { DEFAULT_SETTINGS, readSettings } from '../src/config.ts';

// A made-up machine. Read from the real one, the answers changed whenever an interface came or went mid-run
// (a container's bridge), and a name that resolves, or a Tailscale that answers, belonged to whoever ran it.
const at = (address: string, family: 'IPv4' | 'IPv6', internal = false) => ({ address, family, internal }) as NetworkInterfaceInfo;
vi.mock('node:os', async (original) => ({
  ...(await original<typeof Os>()),
  hostname: () => 'Devbox.example.net',
  networkInterfaces: () => ({
    lo: [at('127.0.0.1', 'IPv4', true), at('::1', 'IPv6', true)],
    eth0: [at('192.168.1.40', 'IPv4'), at('fe80::1%eth0', 'IPv6')],
    docker0: [at('172.17.0.1', 'IPv4')],
  }),
}));
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const address = { 'devbox.example.net': '192.168.1.40', 'elsewhere.example.org': '192.0.2.1' }[host];
    if (!address) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return { address, family: 4 };
  },
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFileSync: (file: string) => {
    if (file !== 'tailscale') throw new Error(`not run in tests: ${file}`);
    return Buffer.from(JSON.stringify({ Self: { DNSName: 'devbox.tail1234.ts.net.' } }));
  },
}));

describe('network', () => {
  it('accepts a host only if it is an address of this machine, or a name for one', async () => {
    expect(await resolveHere('127.0.0.1')).toBe('127.0.0.1');
    expect(await resolveHere('172.17.0.1')).toBe('172.17.0.1');
    expect(await resolveHere('devbox.example.net')).toBe('192.168.1.40');
    expect(await resolveHere('192.0.2.1')).toBeNull();
    expect(await resolveHere('elsewhere.example.org')).toBeNull();
    expect(await resolveHere('no-such-host.invalid')).toBeNull();
  });

  it('listens on localhost alone, one more address, or everything, as the setting says', async () => {
    expect(await listenAddresses(DEFAULT_SETTINGS)).toEqual(['127.0.0.1']);
    expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: 'all' })).toEqual(['::']);
    expect(readSettings({ SIFT_DASHBOARD_HOST: '0.0.0.0' }).dashboardHost).toBe('all');
    await expect(listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: '192.0.2.1' })).rejects.toThrow('does not point at this machine');
    expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: '192.168.1.40' })).toEqual(['127.0.0.1', '192.168.1.40']);
    expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: 'devbox.example.net' })).toEqual(['127.0.0.1', '192.168.1.40']);
    expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: '127.0.0.1' })).toEqual(['127.0.0.1']);
  });

  it("answers to this machine's own names and addresses, never to localhost", () => {
    expect(machineNames()).toEqual(['192.168.1.40', '[fe80::1]', '172.17.0.1', 'devbox.example.net', 'devbox', 'devbox.local', 'devbox.tail1234.ts.net']);
  });
});
