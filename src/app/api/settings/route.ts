import { NextRequest } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db/queries";
import { getMasterResume, saveMasterResume } from "@/lib/db/queries";

export async function GET() {
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

  return Response.json({
    ...masked,
    hasApiKey: !!s.anthropic_api_key,
    hasDiscordWebhook: !!s.discord_webhook_url,
    masterResume: masterResume?.content || "",
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();

  if (body.anthropic_api_key !== undefined) {
    setSetting("anthropic_api_key", body.anthropic_api_key);
  }
  if (body.user_name !== undefined) {
    setSetting("user_name", body.user_name);
  }
  if (body.target_salary_floor !== undefined) {
    setSetting("target_salary_floor", body.target_salary_floor);
  }
  if (body.target_salary_target !== undefined) {
    setSetting("target_salary_target", body.target_salary_target);
  }
  if (body.target_salary_stretch !== undefined) {
    setSetting("target_salary_stretch", body.target_salary_stretch);
  }
  if (body.masterResume !== undefined) {
    saveMasterResume(body.masterResume);
  }
  if (body.schedule_searches !== undefined) {
    setSetting("schedule_searches", body.schedule_searches);
  }
  if (body.schedule_sites !== undefined) {
    setSetting("schedule_sites", body.schedule_sites);
  }
  if (body.schedule_results !== undefined) {
    setSetting("schedule_results", String(body.schedule_results));
  }
  if (body.schedule_hours !== undefined) {
    setSetting("schedule_hours", String(body.schedule_hours));
  }
  if (body.discord_notifications_enabled !== undefined) {
    setSetting("discord_notifications_enabled", String(body.discord_notifications_enabled));
  }
  if (body.discord_webhook_url !== undefined) {
    setSetting("discord_webhook_url", String(body.discord_webhook_url));
  }
  if (body.discord_min_score !== undefined) {
    setSetting("discord_min_score", String(body.discord_min_score));
  }
  if (body.discord_max_jobs !== undefined) {
    setSetting("discord_max_jobs", String(body.discord_max_jobs));
  }
  if (body.scrape_dedupe_enabled !== undefined) {
    setSetting("scrape_dedupe_enabled", String(body.scrape_dedupe_enabled));
  }

  return Response.json({ success: true });
}
