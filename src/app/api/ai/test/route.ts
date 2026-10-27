import { NextRequest, NextResponse } from "next/server";
import { testLlm, getLlmConfig, LLM_DEFAULTS, type LlmRole } from "@/lib/ai/llm";
import { aiRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

const ROLES: LlmRole[] = ["ranker", "tailor", "extract", "ats"];

/**
 * Connectivity check for the configured LLM provider.
 *
 * Makes one tiny completion per request so the Settings UI can answer "is this
 * key/model actually working?" without the user having to run a real scrape.
 * Returns no secrets — only the provider, model, latency and any error text.
 */
async function POST_handler(request: NextRequest) {
  const rateLimit = aiRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));
  const role: LlmRole = ROLES.includes(body?.role) ? body.role : "ranker";

  const cfg = getLlmConfig();
  const result = await testLlm(role);

  return Response.json(
    {
      ...result,
      // Surfaced so the UI can show which of the two providers is in play and
      // whether the key came from settings or the environment.
      keySource: cfg.keySource,
      defaults: LLM_DEFAULTS.models[role],
      configured: cfg.models[role],
    },
    { headers: rateLimit.headers }
  );
}

export { POST_handler as POST };
