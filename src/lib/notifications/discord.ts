export interface NotificationResult {
  ok: boolean;
  error?: string;
}

export interface DiscordJobSummary {
  role: string;
  company: string;
  location: string | null;
  url: string | null;
  source: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  analysis: {
    rankScore: number;
    notes?: string | null;
  } | null;
}

export function isValidDiscordWebhookUrl(webhookUrl: string): boolean {
  try {
    const url = new URL(webhookUrl.trim());
    const allowedHost = url.hostname === "discord.com" || url.hostname === "discordapp.com";
    return allowedHost && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

export async function sendDiscordTestNotification(webhookUrl: string): Promise<NotificationResult> {
  return postDiscordWebhook(webhookUrl, {
    content: "✅ Job Hunt alerts are connected. You’ll get a message here when scheduled scrapes find high-scoring jobs.",
    allowed_mentions: { parse: [] },
  });
}

export async function sendDiscordHighScoreJobsNotification(args: {
  webhookUrl: string;
  jobs: DiscordJobSummary[];
  minScore: number;
  runAt: string;
  totalFound: number;
  totalHighScoring: number;
}): Promise<NotificationResult> {
  const fields = args.jobs.slice(0, 10).map((job) => {
    const score = job.analysis?.rankScore ?? 0;
    const title = truncate(`${score} · ${job.company || "Unknown company"}`, 256);
    const valueParts = [
      job.url ? `[${truncate(job.role, 80)}](${job.url})` : truncate(job.role, 100),
      job.location ? `📍 ${truncate(job.location, 80)}` : null,
      formatSalary(job.salaryMin, job.salaryMax),
      job.source ? `Source: ${job.source}` : null,
    ].filter(Boolean);

    return {
      name: title,
      value: truncate(valueParts.join("\n"), 1024),
      inline: false,
    };
  });

  const extraCount = Math.max(0, args.totalHighScoring - args.jobs.length);
  if (extraCount > 0) {
    fields.push({
      name: "More matches",
      value: `${extraCount} additional high-scoring job${extraCount === 1 ? "" : "s"} matched the threshold.`,
      inline: false,
    });
  }

  return postDiscordWebhook(args.webhookUrl, {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "🔥 High-scoring jobs found",
        description: `Scheduled scrape found **${args.totalHighScoring}** job${args.totalHighScoring === 1 ? "" : "s"} scoring **${args.minScore}+** out of ${args.totalFound} new result${args.totalFound === 1 ? "" : "s"}.`,
        color: 0x22c55e,
        fields,
        timestamp: args.runAt,
        footer: { text: "Job Hunt App" },
      },
    ],
  });
}

async function postDiscordWebhook(webhookUrl: string, payload: unknown): Promise<NotificationResult> {
  const trimmed = webhookUrl.trim();
  if (!trimmed) return { ok: false, error: "Discord webhook URL is missing." };
  if (!isValidDiscordWebhookUrl(trimmed)) {
    return { ok: false, error: "Discord webhook URL must be a Discord webhook URL." };
  }

  try {
    const res = await fetch(trimmed, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) return { ok: true };

    const statusText = res.statusText ? ` ${res.statusText}` : "";
    return { ok: false, error: `Discord returned ${res.status}${statusText}.` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Discord request failed.",
    };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min != null && max != null) return `💵 ${fmt(min)}–${fmt(max)}`;
  if (min != null) return `💵 ${fmt(min)}+`;
  return `💵 ≤${fmt(max!)}`;
}
