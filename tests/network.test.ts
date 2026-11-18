import type * as ChildProcess from 'node:child_process';
import type * as Os from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { localHost } from '../src/cli/host.ts';
import { listenAddress, machineNames, resolveHere } from '../src/cli/network.ts';
import { DEFAULT_SETTINGS, readSettings } from '../src/config.ts';
import { tempDir } from './helpers.ts';

// The host's database is the test's own.
vi.mock('../src/store/store.ts', async (actual) => ({
  ...(await actual<object>()),
  openStore: async () => await (await import('./fixtures.ts')).freshStore(),
}));

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

  it('listens on one address: localhost, the one the setting names, or everything', async () => {
    expect(await listenAddress(DEFAULT_SETTINGS)).toBe('127.0.0.1');
    expect(await listenAddress({ ...DEFAULT_SETTINGS, dashboardHost: 'all' })).toBe('::');
    expect(readSettings({ SIFT_DASHBOARD_HOST: '0.0.0.0' }).dashboardHost).toBe('all');
    await expect(listenAddress({ ...DEFAULT_SETTINGS, dashboardHost: '192.0.2.1' })).rejects.toThrow('does not point at this machine');
    expect(await listenAddress({ ...DEFAULT_SETTINGS, dashboardHost: '192.168.1.40' })).toBe('192.168.1.40');
    expect(await listenAddress({ ...DEFAULT_SETTINGS, dashboardHost: 'devbox.example.net' })).toBe('192.168.1.40');
    expect(await listenAddress({ ...DEFAULT_SETTINGS, dashboardHost: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it("answers to this machine's own names and addresses, never to localhost", () => {
    expect(machineNames()).toEqual(['192.168.1.40', '[fe80::1]', '172.17.0.1', 'devbox.example.net', 'devbox', 'devbox.local', 'devbox.tail1234.ts.net']);
  });
});

describe("sift run's host", () => {
  const host = async (env: Record<string, string>) => await localHost({ PORT: '8787', ...env });

  it('signs sessions with a key kept in its home, so starting again signs no one out, unless SIFT_SESSION_SECRET gives one', async () => {
    const home = tempDir();
    const first = (await host({ SIFT_HOME: home })).sessionSecret;
    expect((await host({ SIFT_HOME: home })).sessionSecret).toBe(first);
    expect((await host({ SIFT_HOME: tempDir() })).sessionSecret).not.toBe(first);
    expect((await host({ SIFT_HOME: home, SIFT_SESSION_SECRET: 'synthetic-session' })).sessionSecret).toBe('synthetic-session');
  });

  it("answers to this machine's names and the name SIFT_DASHBOARD_HOST gives, and offers sign-in here and over Tailscale", async () => {
    expect(await host({ SIFT_HOME: tempDir(), SIFT_DASHBOARD_HOST: 'mail.example.org' })).toMatchObject({
      allowedHosts: [...machineNames(), 'mail.example.org'],
      signInAddresses: ['http://localhost:8787', 'https://devbox.tail1234.ts.net'],
    });
    expect((await host({ SIFT_HOME: tempDir(), SIFT_DASHBOARD_HOST: '0.0.0.0' })).allowedHosts).toEqual(machineNames());
  });

  it('believes a forwarded scheme only while it listens on loopback, where every peer is this machine', async () => {
    expect((await host({ SIFT_HOME: tempDir(), HOSTNAME: '127.0.0.1' })).forwarded).toBe(true);
    expect((await host({ SIFT_HOME: tempDir(), HOSTNAME: '::1' })).forwarded).toBe(true);
    expect((await host({ SIFT_HOME: tempDir(), HOSTNAME: '::' })).forwarded).toBe(false);
    expect((await host({ SIFT_HOME: tempDir(), HOSTNAME: '192.168.1.40' })).forwarded).toBe(false);
  });

  it("keeps Workflow's runs in its home and has them delivered to its own listener", async () => {
    const env: Record<string, string> = { SIFT_HOME: tempDir(), HOSTNAME: '::', PORT: '8790' };
    await localHost(env);
    expect(env).toMatchObject({ WORKFLOW_LOCAL_DATA_DIR: `${env['SIFT_HOME']}/workflow`, WORKFLOW_LOCAL_BASE_URL: 'http://[::1]:8790' });
  });
});
