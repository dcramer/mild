import { execFileSync } from 'node:child_process';
import { hostname, networkInterfaces } from 'node:os';

let tailscale: string | null | undefined;

/** This machine's Tailscale name (`box.tailnet.ts.net`), or null without Tailscale. Asked once. */
export function tailscaleName(): string | null {
  if (tailscale !== undefined) return tailscale;
  try {
    const status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) as {
      Self?: { DNSName?: string };
    };
    tailscale = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase() || null;
  } catch {
    tailscale = null;
  }
  return tailscale;
}

/**
 * Every name and address that means this machine. When the dashboard listens beyond localhost it answers
 * to these and nothing else, so a browser can use any of them and another website still cannot reach it
 * through a name of its own (DNS rebinding).
 */
export function machineNames(): string[] {
  const host = hostname().toLowerCase();
  const short = host.split('.')[0] ?? host;
  const name = tailscaleName();
  // Every address, container bridges included: a request to any of them is still a request to this machine.
  // IPv6 addresses appear in a Host header in brackets.
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => (entry.family === 'IPv6' ? `[${entry.address.split('%')[0]}]` : entry.address));
  return [...new Set([...addresses, host, short, `${short}.local`, ...(name ? [name] : [])])];
}

/** Where Google can sign someone in: this machine, and SIFT_URL. */
export const signInAddresses = (port: number, url: string | undefined): string[] => [...new Set([`http://localhost:${port}`, ...(url ? [url] : [])])];

/** The listener at `address`, as this machine reaches it: a wildcard at its own family's loopback, since `::` may take no IPv4. */
export function fromHere(address: string, port: number): string {
  const host = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '::1' : address;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}
