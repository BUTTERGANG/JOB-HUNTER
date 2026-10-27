import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting, getTargetProfile, saveTargetProfile } from "@/lib/db/queries";
import { getMasterResume, saveMasterResume } from "@/lib/db/queries";
import { getLlmConfig, LLM_DEFAULTS } from "@/lib/ai/llm";
import { validateSettingsUpdate } from "@/lib/validation";
import { settingsRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimit = settingsRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const s = getAllSettings();
  const masterResume = getMasterResume();

  const masked = { ...s };
  // API keys are never returned in plaintext. Report presence instead; the UI
  // shows a "saved — enter a new value to replace" placeholder.
  if (masked.anthropic_api_key) {
    masked.anthropic_api_key = "";
  }
  if (masked.openrouter_api_key) {
    masked.openrouter_api_key = "";
  }
  if (masked.discord_webhook_url) {
    masked.discord_webhook_url = "";
  }
  // Proxy strings can contain credentials — never echo them back.
  const proxyCount = s.scrape_proxies
    ? s.scrape_proxies.split(/\r?\n/).filter((l) => l.trim()).length
    : 0;
  if (masked.scrape_proxies) {
    masked.scrape_proxies = "";
  }

  const llm = getLlmConfig();

  return Response.json({
    ...masked,
    hasApiKey: !!s.anthropic_api_key,
    hasOpenRouterKey: !!s.openrouter_api_key,
    // Effective LLM configuration, so the UI can say which provider is live,
    // where the key came from, and which model each feature will use.
    llm: {
      provider: llm.provider,
      keySource: llm.keySource,
      keyAvailable: !!llm.apiKey,
      models: llm.models,
      defaults: LLM_DEFAULTS.models,
    },
    hasDiscordWebhook: !!s.discord_webhook_url,
    hasProxies: proxyCount > 0,
    proxyCount,
    masterResume: masterResume?.content || "",
    // Returned fully merged with defaults so the UI can edit every knob without
    // having to know which fields this profile happens to be missing.
    targetProfile: getTargetProfile(),
  }, { headers: rateLimit.headers });
}

async function PUT(request: NextRequest) {
  // Rate limiting
  const rateLimit = settingsRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  // Validate input
  const validation = validateSettingsUpdate(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  for (const [key, value] of Object.entries(validation.data!)) {
    if (key === "masterResume") {
      saveMasterResume(value);
    } else if (key === "target_profile") {
      // Parsed onto the defaults, so a partial profile is always valid.
      saveTargetProfile(value);
    } else {
      setSetting(key, value);
    }
  }

  return Response.json({ success: true }, { headers: rateLimit.headers });
}

export { GET, PUT };
