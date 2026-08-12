import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db/queries";
import { sendDiscordTestNotification } from "@/lib/notifications/discord";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => ({}));
  const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim()
    ? body.webhookUrl
    : getSetting("discord_webhook_url");

  if (!webhookUrl) {
    return Response.json({ error: "Discord webhook URL is missing." }, { status: 400, headers: rateLimit.headers });
  }

  const result = await sendDiscordTestNotification(webhookUrl);
  if (!result.ok) {
    return Response.json({ error: result.error ?? "Discord test failed." }, { status: 400, headers: rateLimit.headers });
  }

  return Response.json({ success: true }, { headers: rateLimit.headers });
}

export const POST = POST_handler;
