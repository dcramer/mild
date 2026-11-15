import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

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
