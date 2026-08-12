import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db/queries";
import { getMasterResume, saveMasterResume } from "@/lib/db/queries";
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
  if (masked.anthropic_api_key) {
    const key = masked.anthropic_api_key;
    masked.anthropic_api_key = key.length > 8
      ? key.slice(0, 7) + "..." + key.slice(-4)
      : "***";
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

  return Response.json({
    ...masked,
    hasApiKey: !!s.anthropic_api_key,
    hasDiscordWebhook: !!s.discord_webhook_url,
    hasProxies: proxyCount > 0,
    proxyCount,
    masterResume: masterResume?.content || "",
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
    } else {
      setSetting(key, value);
    }
  }

  return Response.json({ success: true }, { headers: rateLimit.headers });
}

export { GET, PUT };
