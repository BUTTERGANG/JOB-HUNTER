# Changelog

All notable changes to JOB-HUNTER. Newest first.

## 2026-10-23 — Security: dependency vulnerability fixes

Known advisories (OSV) in lockfiles: **8 critical, 63 high, 70 moderate, 16 low → 1 moderate**.

- **Next.js 16.2.9 → 16.4.2** (`next`, `eslint-config-next`, pinned) — fixes critical unauthenticated RCE advisories
- Non-breaking `npm audit fix` updates; production dependencies audit clean
- `pnpm-lock.yaml` had drifted from `package-lock.json` (still resolving vulnerable versions); regenerated from it with `pnpm import`
- Critical/high advisories cleared in: `dompurify`, `next`, `proxy-addr`, `@modelcontextprotocol/sdk`, `body-parser`, `brace-expansion`, `browserslist`, `fast-uri`, `ip-address`, `js-yaml`, `nanoid`, `postcss`, `sharp`, `source-map-js`, `undici`, `zod`
- Verified: `npm run build` passes
