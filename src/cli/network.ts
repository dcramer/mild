import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import type { Settings } from '../config.ts';

export interface LocalAddress {
  address: string;
  /** What kind of network it is on, for the person choosing. */
  label: string;
  tailscale: boolean;
}

// Tailscale hands out addresses from the carrier-grade NAT range, 100.64.0.0/10.
const isTailscale = (address: string, name: string) => {
  const [a = 0, b = 0] = address.split('.').map(Number);
  return name.startsWith('tailscale') || (a === 100 && b >= 64 && b <= 127);
};
// Bridges and virtual pairs that containers create; nobody opens a dashboard through these.
const isContainerPlumbing = (name: string) => /^(docker|br-|veth|virbr|cni|flannel|podman)/.test(name);

/** This machine's IPv4 addresses that another machine could reach, Tailscale first. */
export function localAddresses(): LocalAddress[] {
  const found: LocalAddress[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (isContainerPlumbing(name)) continue;
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const tailscale = isTailscale(entry.address, name);
      found.push({ address: entry.address, label: tailscale ? 'Tailscale' : `local network, ${name}`, tailscale });
    }
  }
  return found.toSorted((x, y) => Number(y.tailscale) - Number(x.tailscale));
}

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
  // Every address, including container bridges that `localAddresses` leaves out of menus: a request to any of them is still a request to this machine.
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  return [...new Set([...addresses, host, short, `${short}.local`, ...(name ? [name] : [])])];
}

/** What the dashboard listens on, from the `dashboard.host` setting. */
export async function listenAddresses(settings: Settings): Promise<string[]> {
  const { dashboardHost } = settings;
  if (dashboardHost === undefined) return ['127.0.0.1'];
  if (dashboardHost === 'all') return ['0.0.0.0'];
  const address = await resolveHere(dashboardHost);
  if (!address) throw new Error(`dashboard.host is ${dashboardHost}, which does not point at this machine.`);
  return address === '127.0.0.1' ? ['127.0.0.1'] : ['127.0.0.1', address];
}

/** Where a browser can find the dashboard, best first: the Tailscale name, then addresses. */
export function dashboardUrls(settings: Settings, port: number = settings.dashboardPort): string[] {
  const { dashboardHost } = settings;
  if (dashboardHost === undefined) return [`http://localhost:${port}`];
  const name = tailscaleName();
  const addresses = localAddresses();
  let hosts: string[];
  if (dashboardHost === 'all') hosts = [...(name ? [name] : []), ...addresses.map((a) => a.address)];
  else {
    // The Tailscale name only applies if the chosen address is the Tailscale one.
    const viaTailscale = addresses.some((a) => a.tailscale && a.address === dashboardHost);
    hosts = [...(name && viaTailscale ? [name] : []), dashboardHost];
  }
  return (hosts.length > 0 ? hosts : ['localhost']).map((host) => `http://${host}:${port}`);
}
