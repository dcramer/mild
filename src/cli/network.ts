import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import type { Settings } from '../config.ts';

/**
 * The address on this machine that `host` (a name or an IP) refers to, or null if it does not point
 * here. The dashboard only listens on addresses this machine actually has.
 */
export async function resolveHere(host: string): Promise<string | null> {
  let address = host;
  if (isIP(host) === 0) {
    try {
      address = (await lookup(host, { family: 4 })).address;
    } catch {
      return null;
    }
  }
  const mine = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .some((entry) => entry.address === address);
  return mine ? address : null;
}

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

/** What the dashboard listens on, from `SIFT_DASHBOARD_HOST`. */
export async function listenAddresses(settings: Settings): Promise<string[]> {
  const { dashboardHost } = settings;
  if (dashboardHost === undefined) return ['127.0.0.1'];
  // `::` takes IPv4 as well. A name such as a Tailscale one can resolve to IPv6 first, so IPv4 alone is not enough.
  if (dashboardHost === 'all') return ['::'];
  const address = await resolveHere(dashboardHost);
  if (!address) throw new Error(`SIFT_DASHBOARD_HOST is ${dashboardHost}, which does not point at this machine.`);
  return address === '127.0.0.1' ? ['127.0.0.1'] : ['127.0.0.1', address];
}
