/**
 * Verification of the SSRF guard.
 *
 *   node_modules/.bin/tsx scripts/verify-safe-fetch.ts
 *
 * /api/analyze-url has the server fetch a URL taken from the request. Unvalidated, that
 * reaches loopback, the LAN and the rest of the tailnet. This asserts what is refused and,
 * just as importantly, that ordinary public URLs are NOT refused.
 */

import { assertSafeFetchUrl, isSafeFetchUrl, UnsafeUrlError } from "../src/lib/safeFetch";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** Must be refused. */
const BLOCKED = [
  "http://localhost:3002/api/settings",
  "http://127.0.0.1:3002/",
  "http://127.1.2.3/",
  "http://0.0.0.0:3000/",
  "http://10.0.0.5/admin",
  "http://172.16.4.4/",
  "http://172.31.255.255/",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest/meta-data/", // cloud metadata
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://100.118.244.119:3002/", // this app, over the tailnet
  "http://100.64.0.1/", // CGNAT start
  "http://100.127.255.254/", // CGNAT end
  "http://[::1]:3002/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://nas.local/",
  "http://something.internal/",
  "file:///etc/passwd",
  "ftp://example.com/x",
  "gopher://example.com/",
  "not a url at all",
  "",
];

/** Must be allowed — a guard that blocks everything is a broken feature. */
const ALLOWED = [
  "https://www.indeed.com/viewjob?jk=abc123",
  "https://www.linkedin.com/jobs/view/1234567890",
  "http://example.com/job",
  "https://jobs.example.co.uk/apply?id=9",
  "https://100.example.com/", // a hostname that merely STARTS with 100
  "https://192.168.example.com/", // ditto — must not be mistaken for a private IP
];

console.log("── refused ──");
for (const url of BLOCKED) {
  let refused = false;
  let message = "";
  try {
    assertSafeFetchUrl(url);
  } catch (e) {
    refused = e instanceof UnsafeUrlError;
    message = e instanceof Error ? e.message : "";
  }
  check(`refuses ${url || "(empty)"}`, refused, message || "was allowed");
}

console.log("\n── allowed ──");
for (const url of ALLOWED) {
  let allowed = false;
  let message = "";
  try {
    assertSafeFetchUrl(url);
    allowed = true;
  } catch (e) {
    message = e instanceof Error ? e.message : "";
  }
  check(`allows ${url}`, allowed, message);
}

console.log("\n── shape ──");
check("isSafeFetchUrl agrees with the thrower", isSafeFetchUrl("https://example.com") && !isSafeFetchUrl("http://127.0.0.1"));
check("returns a parsed URL", assertSafeFetchUrl("https://example.com/job").hostname === "example.com");
check("throws the specific error type", (() => {
  try {
    assertSafeFetchUrl("http://127.0.0.1");
    return false;
  } catch (e) {
    return e instanceof UnsafeUrlError;
  }
})());

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
