import { isIP } from 'node:net';

/** True for an address on the public internet: not loopback, private, link-local, shared, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped) return isPublicAddress(mapped);
    // Loopback and unspecified, unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
    return !(lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff'));
  }
  return false;
}
