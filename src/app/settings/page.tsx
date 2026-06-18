"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SearchConfig {
  term: string;
  location: string;
}

const SITES = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "indeed", label: "Indeed" },
  { id: "glassdoor", label: "Glassdoor" },
  { id: "zip_recruiter", label: "ZipRecruiter" },
  { id: "google", label: "Google" },
];

const HOURS_OPTIONS = [
  { value: "24", label: "Last 24 hours" },
  { value: "48", label: "Last 48 hours" },
  { value: "72", label: "Last 3 days" },
  { value: "168", label: "Last 7 days" },
  { value: "336", label: "Last 2 weeks" },
  { value: "720", label: "Last 30 days" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    anthropic_api_key: "",
    user_name: "",
    target_salary_floor: "",
    target_salary_target: "",
    target_salary_stretch: "",
    masterResume: "",
    discord_notifications_enabled: "false",
    discord_webhook_url: "",
    discord_min_score: "70",
    discord_max_jobs: "10",
    scrape_dedupe_enabled: "true",
  });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasDiscordWebhook, setHasDiscordWebhook] = useState(false);
  const [discordWebhookTouched, setDiscordWebhookTouched] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // BLS state
  const [blsStatus, setBlsStatus] = useState<{ count: number; year: number | null } | null>(null);
  const [blsImporting, setBlsImporting] = useState(false);
  const [blsResult, setBlsResult] = useState<string | null>(null);

  // Scheduled scrape state
  const [scheduleSearches, setScheduleSearches] = useState<SearchConfig[]>([
    { term: "", location: "Indiana" },
  ]);
  const [scheduleSites, setScheduleSites] = useState<string[]>(["linkedin", "indeed"]);
  const [scheduleResults, setScheduleResults] = useState("25");
  const [scheduleHours, setScheduleHours] = useState("24");
  const [scheduleRunning, setScheduleRunning] = useState(false);
  const [scheduleRunResult, setScheduleRunResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/import-bls")
      .then((r) => r.json())
      .then((data) => setBlsStatus(data))
      .catch(() => setBlsStatus({ count: 0, year: null }));

    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load settings");
        return r.json();
      })
      .then((data) => {
        setHasApiKey(!!data.hasApiKey);
        setHasDiscordWebhook(!!data.hasDiscordWebhook);
        setSettings((prev) => ({
          ...prev,
          ...data,
          anthropic_api_key: "",
          discord_webhook_url: "",
          discord_notifications_enabled: data.discord_notifications_enabled ?? "false",
          discord_min_score: data.discord_min_score ?? "70",
          discord_max_jobs: data.discord_max_jobs ?? "10",
          scrape_dedupe_enabled: data.scrape_dedupe_enabled ?? "true",
        }));
        // Load schedule config if present
        if (data.schedule_searches) {
          try {
            const parsed = JSON.parse(data.schedule_searches);
            if (Array.isArray(parsed) && parsed.length > 0) setScheduleSearches(parsed);
          } catch {}
        }
        if (data.schedule_sites) {
          try {
            const parsed = JSON.parse(data.schedule_sites);
            if (Array.isArray(parsed)) setScheduleSites(parsed);
          } catch {}
        }
        if (data.schedule_results) setScheduleResults(data.schedule_results);
        if (data.schedule_hours) setScheduleHours(data.schedule_hours);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const payload: Record<string, string> = {
      user_name: settings.user_name,
      target_salary_floor: settings.target_salary_floor,
      target_salary_target: settings.target_salary_target,
      target_salary_stretch: settings.target_salary_stretch,
      masterResume: settings.masterResume,
      schedule_searches: JSON.stringify(scheduleSearches.filter((s) => s.term.trim())),
      schedule_sites: JSON.stringify(scheduleSites),
      schedule_results: scheduleResults,
      schedule_hours: scheduleHours,
      discord_notifications_enabled: settings.discord_notifications_enabled,
      discord_min_score: settings.discord_min_score,
      discord_max_jobs: settings.discord_max_jobs,
      scrape_dedupe_enabled: settings.scrape_dedupe_enabled,
    };

    if (apiKeyTouched) {
      payload.anthropic_api_key = settings.anthropic_api_key;
    }
    if (discordWebhookTouched) {
      payload.discord_webhook_url = settings.discord_webhook_url;
    }

    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    setSaved(true);
    if (apiKeyTouched && settings.anthropic_api_key) {
      setHasApiKey(true);
      setApiKeyTouched(false);
      setSettings((prev) => ({ ...prev, anthropic_api_key: "" }));
    }
    if (discordWebhookTouched && settings.discord_webhook_url) {
      setHasDiscordWebhook(true);
      setDiscordWebhookTouched(false);
      setSettings((prev) => ({ ...prev, discord_webhook_url: "" }));
    }
    setTimeout(() => setSaved(false), 3000);
  }

  async function runBLSImport() {
    setBlsImporting(true);
    setBlsResult(null);
    try {
      const res = await fetch("/api/admin/import-bls", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setBlsStatus({ count: data.count, year: data.year });
        setBlsResult(`Imported ${data.count} Indiana occupations (${data.year} BLS data).`);
      } else {
        setBlsResult(`Error: ${data.error}`);
      }
    } catch {
      setBlsResult("Error: Network request failed");
    }
    setBlsImporting(false);
  }

  async function testDiscordWebhook() {
    setDiscordTesting(true);
    setDiscordTestResult(null);
    try {
      const res = await fetch("/api/notifications/discord/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: discordWebhookTouched ? settings.discord_webhook_url : undefined,
        }),
      });
      const data = await res.json();
      setDiscordTestResult(res.ok ? "Discord test sent." : `Error: ${data.error}`);
    } catch {
      setDiscordTestResult("Error: Network request failed");
    }
    setDiscordTesting(false);
  }

  function buildNotificationPayload() {
    const payload: Record<string, string> = {
      discord_notifications_enabled: settings.discord_notifications_enabled,
      discord_min_score: settings.discord_min_score,
      discord_max_jobs: settings.discord_max_jobs,
      scrape_dedupe_enabled: settings.scrape_dedupe_enabled,
    };
    if (discordWebhookTouched) payload.discord_webhook_url = settings.discord_webhook_url;
    return payload;
  }

  async function runScheduledNow() {
    setScheduleRunning(true);
    setScheduleRunResult(null);
    // Save current schedule config first
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schedule_searches: JSON.stringify(scheduleSearches.filter((s) => s.term.trim())),
        schedule_sites: JSON.stringify(scheduleSites),
        schedule_results: scheduleResults,
        schedule_hours: scheduleHours,
        ...buildNotificationPayload(),
      }),
    });
    const res = await fetch("/api/scrape/scheduled", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      const dedupeText = data.dedupe && data.dedupe.inputCount !== data.dedupe.outputCount
        ? ` ${data.dedupe.inputCount - data.dedupe.outputCount} duplicates skipped.`
        : "";
      const notificationText = data.notification?.sent
        ? ` Discord sent for ${data.notification.highScoringCount} high-scoring jobs.`
        : data.notification?.error
        ? ` Discord not sent: ${data.notification.error}`
        : data.notification?.highScoringCount === 0
        ? " No jobs met the Discord threshold."
        : "";
      setScheduleRunResult(`Done — ${data.count} new jobs found and saved.${dedupeText}${notificationText}`);
    } else {
      setScheduleRunResult(`Error: ${data.error}`);
    }
    setScheduleRunning(false);
  }

  function updateField(key: string, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function addScheduleSearch() {
    setScheduleSearches((prev) => [...prev, { term: "", location: "Indiana" }]);
  }

  function removeScheduleSearch(i: number) {
    setScheduleSearches((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateScheduleSearch(i: number, field: "term" | "location", value: string) {
    setScheduleSearches((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );
  }

  function toggleScheduleSite(id: string) {
    setScheduleSites((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  const cronCommand = `0 8 * * * curl -s -X POST http://localhost:3000/api/scrape/scheduled >> ~/job-scrape.log 2>&1`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>API Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="apiKey">Anthropic API Key</Label>
              <div className="relative mt-1">
                <Input
                  id="apiKey"
                  type={showApiKey ? "text" : "password"}
                  value={settings.anthropic_api_key}
                  onChange={(e) => {
                    updateField("anthropic_api_key", e.target.value);
                    setApiKeyTouched(true);
                  }}
                  placeholder={hasApiKey ? "Key saved — enter new value to replace" : "sk-ant-..."}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showApiKey ? "Hide key" : "Show key"}
                >
                  {showApiKey ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {hasApiKey
                  ? "API key is saved. Leave blank to keep current key, or enter a new value to replace it."
                  : "Required for AI ranking and analysis. Get one at console.anthropic.com."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="userName">Your Name</Label>
              <Input
                id="userName"
                value={settings.user_name}
                onChange={(e) => updateField("user_name", e.target.value)}
                placeholder="Used in PDF file names"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Salary Targets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="floor">Floor ($)</Label>
                <Input
                  id="floor"
                  type="number"
                  value={settings.target_salary_floor}
                  onChange={(e) => updateField("target_salary_floor", e.target.value)}
                  placeholder="100000"
                />
                <p className="text-xs text-muted-foreground mt-1">Minimum you&apos;ll accept</p>
              </div>
              <div>
                <Label htmlFor="target">Target ($)</Label>
                <Input
                  id="target"
                  type="number"
                  value={settings.target_salary_target}
                  onChange={(e) => updateField("target_salary_target", e.target.value)}
                  placeholder="130000"
                />
                <p className="text-xs text-muted-foreground mt-1">What you&apos;d be happy with</p>
              </div>
              <div>
                <Label htmlFor="stretch">Stretch ($)</Label>
                <Input
                  id="stretch"
                  type="number"
                  value={settings.target_salary_stretch}
                  onChange={(e) => updateField("target_salary_stretch", e.target.value)}
                  placeholder="160000"
                />
                <p className="text-xs text-muted-foreground mt-1">Anchor number for negotiation</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* BLS Wage Data Card */}
        <Card>
          <CardHeader>
            <CardTitle>BLS Wage Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Download Indiana occupational wage data from the Bureau of Labor Statistics. Provides real government wage benchmarks (median, 25th/75th percentile) for ~800 occupations, shown alongside AI estimates in the scrape results.
            </p>
            {blsStatus && (
              <p className="text-sm">
                {blsStatus.count > 0 ? (
                  <span className="text-green-700 dark:text-green-400">
                    {blsStatus.count} Indiana occupations loaded ({blsStatus.year} BLS data)
                  </span>
                ) : (
                  <span className="text-muted-foreground">No BLS data loaded yet.</span>
                )}
              </p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" onClick={runBLSImport} disabled={blsImporting}>
                {blsImporting
                  ? "Downloading…"
                  : blsStatus?.count
                  ? "Re-import BLS Data"
                  : "Import BLS Data"}
              </Button>
              {blsResult && (
                <span className={`text-sm ${blsResult.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {blsResult}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Downloads ~25 MB from BLS.gov. Requires{" "}
              <code className="bg-muted px-1 rounded">openpyxl</code>: run{" "}
              <code className="bg-muted px-1 rounded">pip install openpyxl</code> first.
              Takes 30–90 seconds.
            </p>
          </CardContent>
        </Card>

        {/* Scheduled Scrape Card */}
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Scrape</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Configure the daily automated scrape. Use the crontab command below to run it on a schedule, or click &quot;Run Now&quot; to trigger it immediately.
            </p>

            {/* Search rows */}
            <div>
              <Label className="mb-2 block">Searches</Label>
              <div className="space-y-2">
                {scheduleSearches.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      placeholder="Search term (e.g. photographer)"
                      value={s.term}
                      onChange={(e) => updateScheduleSearch(i, "term", e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Location (e.g. Indiana)"
                      value={s.location}
                      onChange={(e) => updateScheduleSearch(i, "location", e.target.value)}
                      className="flex-1"
                    />
                    {scheduleSearches.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeScheduleSearch(i)}
                        className="shrink-0 px-2"
                        aria-label="Remove"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addScheduleSearch} className="mt-2">
                + Add Search
              </Button>
            </div>

            {/* Sites + Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">Job Boards</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SITES.map((site) => (
                    <label key={site.id} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={scheduleSites.includes(site.id)}
                        onChange={() => toggleScheduleSite(site.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">{site.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="schedResults" className="text-xs text-muted-foreground">Results per site</Label>
                  <Input
                    id="schedResults"
                    type="number"
                    min={5}
                    max={200}
                    value={scheduleResults}
                    onChange={(e) => setScheduleResults(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground block mb-1">Posted within</Label>
                  <Select value={scheduleHours} onValueChange={(v) => v && setScheduleHours(v)}>
                    <SelectTrigger>
                      <SelectValue>
                        {HOURS_OPTIONS.find((o) => o.value === scheduleHours)?.label ?? "Last 24 hours"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Run Now */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={runScheduledNow}
                disabled={scheduleRunning || scheduleSearches.every((s) => !s.term.trim())}
                variant="outline"
              >
                {scheduleRunning ? "Running…" : "Run Now"}
              </Button>
              {scheduleRunResult && (
                <span className={`text-sm ${scheduleRunResult.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {scheduleRunResult}
                </span>
              )}
            </div>

            {/* Crontab section */}
            <div className="border rounded-md p-4 bg-muted/40 space-y-2">
              <p className="text-xs font-medium">Automate with crontab (Mac/Linux)</p>
              <p className="text-xs text-muted-foreground">
                Run <code className="bg-muted px-1 rounded">crontab -e</code> in your terminal and add the line below to trigger at 8:00 AM daily. The app must be running.
              </p>
              <div className="relative">
                <code className="block text-xs font-mono bg-background border rounded px-3 py-2 pr-20 break-all">
                  {cronCommand}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(cronCommand)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 bg-background"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                View logs: <code className="bg-muted px-1 rounded">tail -f ~/job-scrape.log</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discord Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Send a Discord alert when scheduled scrapes find high-scoring jobs. Manual scrapes will not notify.
            </p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.discord_notifications_enabled === "true"}
                onChange={(e) => updateField("discord_notifications_enabled", e.target.checked ? "true" : "false")}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Enable Discord notifications</span>
            </label>
            <div>
              <Label htmlFor="discordWebhook">Discord Webhook URL</Label>
              <Input
                id="discordWebhook"
                type="password"
                value={settings.discord_webhook_url}
                onChange={(e) => {
                  updateField("discord_webhook_url", e.target.value);
                  setDiscordWebhookTouched(true);
                }}
                placeholder={hasDiscordWebhook ? "Webhook saved — enter new URL to replace" : "https://discord.com/api/webhooks/..."}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Create a webhook in your Discord channel settings. The saved URL is not shown again after saving.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="discordMinScore">Minimum score</Label>
                <Input
                  id="discordMinScore"
                  type="number"
                  min={0}
                  max={100}
                  value={settings.discord_min_score}
                  onChange={(e) => updateField("discord_min_score", e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Default 70. Higher means fewer alerts.</p>
              </div>
              <div>
                <Label htmlFor="discordMaxJobs">Max jobs per alert</Label>
                <Input
                  id="discordMaxJobs"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.discord_max_jobs}
                  onChange={(e) => updateField("discord_max_jobs", e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Discord messages stay readable at 10 or fewer.</p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.scrape_dedupe_enabled !== "false"}
                onChange={(e) => updateField("scrape_dedupe_enabled", e.target.checked ? "true" : "false")}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Skip jobs already seen in previous scrape runs</span>
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={testDiscordWebhook}
                disabled={discordTesting || (!hasDiscordWebhook && !settings.discord_webhook_url.trim())}
              >
                {discordTesting ? "Sending…" : "Send Test"}
              </Button>
              {discordTestResult && (
                <span className={`text-sm ${discordTestResult.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {discordTestResult}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Master Resume</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={settings.masterResume}
              onChange={(e) => updateField("masterResume", e.target.value)}
              placeholder="Paste your master resume here (markdown format). This is the source of truth for AI resume tailoring. Include ALL experience, 4-6 bullets per role, fully quantified."
              rows={20}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              This is your 3-5 page private master resume. The AI will select and tailor content from this for each application.
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
          {saved && <span className="text-sm text-green-600">Settings saved.</span>}
        </div>
      </div>
    </div>
  );
}
