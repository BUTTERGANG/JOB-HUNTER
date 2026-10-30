# Security

An honest assessment of what protects this app and what does not, with the evidence for each
claim. Re-check the "Residual risk" sections before changing the deployment.

## Verdict

**Adequate for how it is deployed today — a single-user tool reachable only over the tailnet.
It would NOT be safe to expose publicly as it stands, because it has no application
authentication at all.**

## What actually protects it

| layer | state | evidence |
|---|---|---|
| **Network binding** | Bound to the Tailscale address only (`100.118.244.119:3002`), not `0.0.0.0` | `lsof -nP -iTCP:3002` shows the tailnet IP; `localhost:3002` does not answer |
| **Transport** | WireGuard-encrypted by Tailscale, device-authenticated | inherent to Tailscale |
| **LAN exposure** | none from the app; the macOS firewall happens to be off, which does not matter because the socket is not on the LAN interface | binding above |
| **CORS** | no `Access-Control-Allow-*` headers, so another origin cannot read responses | `curl -H "Origin: https://evil.example" -D -` returns no CORS headers |
| **Rate limiting** | 32 of 32 routes | `generalRateLimiter`/endpoint limiters on every handler |
| **API key** | never returned by the API; not in git history | `/api/settings` blanks it (`openrouter_api_key: ""`); `git log --all -S "sk-or-v1"` matches only a UI placeholder string |
| **Secrets in the repo** | none — `data/` is gitignored, and no key/connection-string shapes exist anywhere in history | pattern sweep over full history: 0 matches for OpenRouter/Anthropic/AWS/GitHub token and Postgres URI shapes |
| **Dependencies** | 0 known vulnerabilities | `npm audit --omit=dev` → `found 0 vulnerabilities` |
| **Error responses** | no stack traces or raw driver messages in API responses | grep across `src/app/api` for `e.message`/`JSON.stringify(e)` patterns found none |

## The central fact: there is no authentication

Every one of the 32 routes is open to anything that can reach the port. The tailnet **is** the
access-control layer — that was a deliberate decision (see `docs/decisions.md`), and the
vestigial `withAuth` middleware was removed because it was wired to two routes the browser
could not satisfy, and its `getClientIdentifier` was a byte-identical copy of the one in
`rateLimit.ts`.

Consequences to be clear-eyed about:

- **Any device on the tailnet has full access** — read and write. That includes the iPhone, the
  MacBook, the NAS, the Raspberry Pi, `buttergang-dev` and `n8n-montreal`. A compromised or
  untrusted device on the tailnet is inside this app.
- **Tailscale ACLs are the real control.** The default tailnet ACL is allow-all. If yours is
  default, every peer can reach this app. Narrowing the ACL to just the devices that need it
  is the single highest-value hardening step available.
- **The API key cannot be *read* through the app but can be *spent* through it.** It is masked
  in `/api/settings`, but `/api/ai/*` uses it server-side, so anyone with access can burn the
  credit. Treat app access as equivalent to holding a spending-capable key.

## Fixed during the 2026-10-30 audit

- **Server-Side Request Forgery (confirmed exploitable).** `/api/analyze-url` took a URL from
  the request and fetched it with no validation, so the server could be pointed at loopback,
  the LAN, or the rest of the tailnet. Proven by aiming it at the app's own `/api/health`: the
  request went out and the failure was about job-description extraction, not about reaching
  the host. Both the native fetch and the curl fallbacks followed redirects (`-sL`), so a
  public URL could bounce into an internal one. Now all three paths validate the URL first,
  redirects are followed manually with every hop checked, and curl no longer follows them at
  all. `scripts/verify-safe-fetch.ts` asserts 22 refused targets and 6 that must still work.
- **The database file was world-readable** (`-rw-r--r--`) while holding the OpenRouter key and
  personal data. `ensureDb()` now chmods the database, WAL and SHM to `0600`.
- **`/api/health` had no rate limiter** — the only route without one.
- **`shadcn` was a runtime dependency** and carried the project's only three (low) audit
  findings. Moved to `devDependencies`; `npm audit` is now clean.

## Residual risk, stated plainly

1. **The SSRF guard validates the hostname, not the resolved IP.** A hostname an attacker
   controls that resolves to a private address (DNS rebinding) is not caught. Closing it needs
   resolve-then-pin. Not worth the complexity for a tailnet-only single-user tool.
2. **Data at rest is unencrypted.** SQLite sits on an unencrypted external SSD and contains the
   API key plus PII (the master resume carries a name, email and phone number). File
   permissions stop other *users*; they do not stop anyone with physical access or an unlocked
   session. FileVault on the SSD, or moving the key to the `~/.secrets` vault, would.
3. **No audit trail.** Nothing records who changed a status, added a job or spent a model call.
4. **No CSRF protection.** Not currently exploitable — JSON POSTs trigger a CORS preflight and
   no `Access-Control-Allow-*` headers are returned — but it must be revisited the moment any
   cookie-based auth is added.
5. **The curl fallback no longer follows redirects**, so a posting that redirects *and* blocks
   Node's fetch will fall back to manual paste. Accepted: correctness over a convenience path.

## Before exposing this beyond the tailnet

In order, because each step changes the threat model:

1. **Add real authentication** (session or bearer token) — nothing else matters until this is in.
2. **Add CSRF protection** for the cookie-based variant.
3. **Terminate TLS at a reverse proxy** rather than adding it to the app.
4. **Move the API key out of the DB** into the environment or the `~/.secrets` vault, so a DB
   copy is no longer a credential copy.
5. **Review rate limits per endpoint** — they are sized for one user, not for the internet.
6. **Encrypt at rest** (FileVault or similar) and consider trimming the PII the app stores.
