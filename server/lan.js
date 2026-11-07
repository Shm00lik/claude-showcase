import net from 'node:net';

const bl = new net.BlockList();
for (const [a, p] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]])
  bl.addSubnet(a, p, 'ipv4');
bl.addAddress('::1', 'ipv6');
bl.addSubnet('fc00::', 7, 'ipv6');
bl.addSubnet('fe80::', 10, 'ipv6');

export function isLanAddress(addr) {
  if (typeof addr !== 'string') return false;
  const a = addr.replace(/^::ffff:/i, '');
  const f = net.isIPv4(a) ? 'ipv4' : net.isIPv6(a) ? 'ipv6' : null;
  return f !== null && bl.check(a, f);
}

export function originAllowed(req) {
  const { origin, host } = req.headers;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

// DNS-rebinding guard: Host must be an IP literal or localhost.
export function hostAllowed(req) {
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  const m = host.match(/^(\[[0-9a-f:.]+\]|[^:\s\[\]]+)(?::\d+)?$/i);
  if (!m) return false;
  const name = m[1].replace(/^\[|\]$/g, '');
  return name.toLowerCase() === 'localhost' || net.isIP(name) !== 0;
}
