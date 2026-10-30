import { NextRequest } from "next/server";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

/**
 * Health check.
 *
 * Replaces src/app/api/auth.ts, which was a plain `.ts` file — Next only serves `route.ts`
 * from the App Router, so that "endpoint" never existed. Nothing could call it, and it was
 * the only thing keeping src/lib/authMiddleware.ts alive.
 *
 * The client identifier is the same value rate limiting keys on, so a stuck limiter is
 * debuggable from outside.
 */
export async function GET(request: NextRequest) {
  // Every other route is limited; an unlimited endpoint is an easy way to fingerprint or
  // hammer the service, so this one is too.
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  return Response.json(
    { status: "ok", timestamp: Date.now(), client: getClientIdentifier(request) },
    { status: 200, headers: rateLimit.headers }
  );
}
