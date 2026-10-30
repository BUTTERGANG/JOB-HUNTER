/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 *
 * `/api/analyze-url` takes a URL from the request and has the server fetch it. Unvalidated,
 * that lets anyone who can reach the app make it request arbitrary addresses — including
 * loopback, the LAN, and the rest of the tailnet — and read back whatever the extraction
 * returns. Confirmed by pointing it at the app's own `/api/health`: the request went out and
 * the failure was about job-description extraction, not about reaching the host.
 *
 * `redirect: "follow"` also means a public URL can redirect to an internal one, so the check
 * is applied both to the URL as given and to every redirect hop after it.
 *
 * Residual risk, stated plainly: this validates the URL's HOST, not the IP it eventually
 * resolves to, so a hostname the attacker controls that resolves to a private address
 * (DNS rebinding) is not caught. Closing that needs resolve-then-pin, which is not worth the
 * complexity for a single-user tool that is already only reachable over the tailnet.
 */

/**
 * Hostnames that must never be fetched, regardless of how they resolve.
 */
const BLOCKED_HOSTNAME = [
  /^localhost$/i,
  /^metadata(\.|$)/i, // cloud metadata service aliases
  /\.local$/i, // mDNS
  /\.internal$/i,
];

/**
 * Private / special IPv4 ranges. Applied ONLY when the host is an IPv4 literal.
 *
 * The first draft applied these to any host, so `192.168.example.com` — a perfectly ordinary
 * public hostname that merely begins with a private-looking prefix — was refused. A guard
 * that blocks real URLs is a broken feature, so the range rules are gated on the host
 * actually parsing as a dotted quad.
 */
const BLOCKED_IPV4 = [
  /^127\./, // loopback
  /^0\./,
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local, incl. cloud metadata 169.254.169.254
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // Tailscale CGNAT 100.64.0.0/10
];

/** IPv6 loopback, unique-local and link-local, plus IPv4-mapped addresses. */
const BLOCKED_IPV6 = [
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7 unique-local
  /^fe80:/i, // link-local
  /^::ffff:/i, // IPv4-mapped — evaluated as IPv4 in disguise, so refuse all of them
];

const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Is this host a private or otherwise unsafe target? */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (IPV4_LITERAL.test(host)) return BLOCKED_IPV4.some((p) => p.test(host));
  if (host.includes(":")) return BLOCKED_IPV6.some((p) => p.test(host));
  return BLOCKED_HOSTNAME.some((p) => p.test(host));
}

export class UnsafeUrlError extends Error {}

/**
 * Throws `UnsafeUrlError` unless the URL is safe to fetch from the server.
 * Returns the parsed URL so callers can reuse it.
 */
export function assertSafeFetchUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https URLs can be fetched (got ${url.protocol}).`);
  }

  if (isBlockedHost(url.hostname)) {
    throw new UnsafeUrlError(
      "That address is on the local machine or a private network, so it will not be fetched."
    );
  }

  return url;
}

/** True when the given URL is safe to fetch — for callers that prefer a boolean. */
export function isSafeFetchUrl(raw: string): boolean {
  try {
    assertSafeFetchUrl(raw);
    return true;
  } catch {
    return false;
  }
}
