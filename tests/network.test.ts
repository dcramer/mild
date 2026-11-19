import type * as ChildProcess from 'node:child_process';
import type * as Os from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { localHost } from '../src/cli/host.ts';
import { machineNames } from '../src/cli/network.ts';
import { tempDir } from './helpers.ts';

// The host's database is the test's own.
vi.mock('../src/store/store.ts', async (actual) => ({
  ...(await actual<object>()),
  openStore: async () => await (await import('./fixtures.ts')).freshStore(),
}));

// A made-up machine. Read from the real one, the answers changed whenever an interface came or went mid-run
// (a container's bridge), and a Tailscale that answers belonged to whoever ran it.
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
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFileSync: (file: string) => {
    if (file !== 'tailscale') throw new Error(`not run in tests: ${file}`);
    return Buffer.from(JSON.stringify({ Self: { DNSName: 'devbox.tail1234.ts.net.' } }));
  },
}));

describe('network', () => {
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

  it("answers to this machine's names and SIFT_URL's, and offers sign-in here and there", async () => {
    expect(await host({ SIFT_HOME: tempDir(), SIFT_URL: 'https://mail.example.org' })).toMatchObject({
      url: 'https://mail.example.org',
      allowedHosts: [...machineNames(), 'mail.example.org'],
      signInAddresses: ['http://localhost:8787', 'https://mail.example.org'],
    });
    expect(await host({ SIFT_HOME: tempDir() })).toMatchObject({
      url: 'http://localhost:8787',
      allowedHosts: machineNames(),
      signInAddresses: ['http://localhost:8787'],
    });
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
