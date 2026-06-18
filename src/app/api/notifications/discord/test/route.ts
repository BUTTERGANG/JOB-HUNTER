import { NextRequest } from "next/server";
import { getSetting } from "@/lib/db/queries";
import { sendDiscordTestNotification } from "@/lib/notifications/discord";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim()
    ? body.webhookUrl
    : getSetting("discord_webhook_url");

  if (!webhookUrl) {
    return Response.json({ error: "Discord webhook URL is missing." }, { status: 400 });
  }

  const result = await sendDiscordTestNotification(webhookUrl);
  if (!result.ok) {
    return Response.json({ error: result.error ?? "Discord test failed." }, { status: 400 });
  }

  return Response.json({ success: true });
}
