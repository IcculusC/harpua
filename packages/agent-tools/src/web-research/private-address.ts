import net from "node:net";

/*
 * A safety net, NOT a security boundary. `isPrivateAddress` inspects the
 * literal hostname of a URL only — it does no DNS resolution, so a public name
 * that resolves to a private IP (DNS rebinding) is NOT caught here. Real egress
 * control belongs at the deployment layer (network segmentation, a proxy,
 * firewall rules). This exists so the naive cases — a model talked into
 * fetching `http://169.254.169.254/` for cloud credentials, or an accidental
 * hit on `http://192.168.1.1` / `http://localhost:6379` — are refused by
 * default instead of silently succeeding.
 */

/** Bare hostnames that always mean "this machine". */
const LOCAL_HOSTNAMES = new Set(["localhost"]);

/** Hostname suffixes conventionally used for local/internal names. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal"];

/** True for loopback/private/link-local/unspecified IPv4 (dotted-quad form). */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // "this host" (0.0.0.0/8)
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  return false;
}

/** Strip the brackets a URL wraps around an IPv6 literal (`[::1]` → `::1`). */
function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

/** True for loopback/link-local/unique-local IPv6, incl. IPv4-mapped forms. */
function isPrivateIPv6(host: string): boolean {
  const ip = stripBrackets(host).toLowerCase();
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  if (ip.startsWith("fe80")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local
  // IPv4-mapped, dotted form (::ffff:127.0.0.1).
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted?.[1]) return isPrivateIPv4(dotted[1]);
  // IPv4-mapped, hextet form — the WHATWG URL parser compresses the dotted
  // form into this (::ffff:7f00:1). Decode the two hextets back to a quad.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    const quad = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    return isPrivateIPv4(quad);
  }
  return false;
}

/**
 * True if `hostname` (as read from a `URL`) is a loopback/private/link-local
 * address or a conventional local name that `fetch_url` refuses unless
 * `allowPrivate` is set. The WHATWG URL parser canonicalizes IPv4 tricks
 * (hex/octal/dword forms) into dotted-quad before this sees them, so those are
 * covered too. See the file header for the DNS-rebinding caveat.
 */
export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const kind = net.isIP(stripBrackets(host));
  if (kind === 4) return isPrivateIPv4(host);
  if (kind === 6) return isPrivateIPv6(host);
  return false;
}
