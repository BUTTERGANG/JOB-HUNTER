"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/**
 * LLM provider configuration.
 *
 * The app shipped with a hard dependency on a direct Anthropic key and model ids
 * baked into the call sites. It now routes every AI feature through one layer
 * (`src/lib/ai/llm.ts`) that defaults to OpenRouter, so the provider, the key and
 * the model per role are configuration.
 *
 * Keys are never echoed back: the API reports only whether one is stored, and a
 * new value is only sent when the field is actually touched.
 */

export type LlmRole = "ranker" | "tailor" | "extract" | "ats";

const ROLE_INFO: { role: LlmRole; label: string; hint: string }[] = [
  {
    role: "ranker",
    label: "Listing ranker",
    hint: "Scores every scraped listing. Runs over the most tokens — keep it cheap.",
  },
  {
    role: "tailor",
    label: "Resume tailoring",
    hint: "Writes job-specific resumes from your master resume. Quality matters most here.",
  },
  {
    role: "extract",
    label: "Posting extraction",
    hint: "Turns a job page or pasted text into structured fields.",
  },
  {
    role: "ats",
    label: "ATS / fit analysis",
    hint: "Per-job keyword and fit analysis against your resume.",
  },
];

export interface LlmSettingsValue {
  llm_provider: string;
  openrouter_api_key: string;
  anthropic_api_key: string;
  llm_model_ranker: string;
  llm_model_tailor: string;
  llm_model_extract: string;
  llm_model_ats: string;
}

interface LlmStatus {
  provider: string;
  keySource: string | null;
  keyAvailable: boolean;
  models: Record<string, string>;
  defaults: Record<string, string>;
}

interface Props {
  value: LlmSettingsValue;
  onChange: (patch: Partial<LlmSettingsValue>) => void;
  hasOpenRouterKey: boolean;
  hasAnthropicKey: boolean;
  orTouched: boolean;
  anTouched: boolean;
  onTouch: (which: "openrouter" | "anthropic") => void;
  status: LlmStatus | null;
}

interface TestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  ms?: number;
  reply?: string;
  error?: string;
  keySource?: string | null;
  configured?: string;
}

export function LlmConfigCard({
  value,
  onChange,
  hasOpenRouterKey,
  hasAnthropicKey,
  orTouched,
  anTouched,
  onTouch,
  status,
}: Props) {
  const [showOrKey, setShowOrKey] = useState(false);
  const [showAnKey, setShowAnKey] = useState(false);
  const [testRole, setTestRole] = useState<LlmRole>("ranker");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const provider = value.llm_provider || status?.provider || "openrouter";

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: testRole }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ ok: false, error: "Network error — could not reach the server." });
    }
    setTesting(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Every AI feature (ranking, resume tailoring, extraction) goes through this one setting.
          OpenRouter is the default and reuses the key already on this machine.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live status */}
        <div className="rounded-md border border-border p-3 text-xs">
          {status?.keyAvailable ? (
            <span className="text-muted-foreground">
              Active: <span className="font-medium text-foreground">{status.provider}</span>
              {status.keySource === "environment"
                ? " — key loaded from the environment (OPENROUTER_API_KEY / ANTHROPIC_API_KEY)"
                : " — key stored in this app's settings"}
            </span>
          ) : (
            <span className="text-destructive">
              No usable key. Add one below, or set OPENROUTER_API_KEY in the environment.
            </span>
          )}
        </div>

        {/* Provider */}
        <div className="space-y-1">
          <Label htmlFor="llmProvider">Provider</Label>
          <select
            id="llmProvider"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={provider}
            onChange={(e) => onChange({ llm_provider: e.target.value })}
          >
            <option value="openrouter">OpenRouter (recommended)</option>
            <option value="anthropic">Anthropic (direct)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            If the selected provider has no key, the other one is used automatically rather than
            failing every AI feature.
          </p>
        </div>

        {/* OpenRouter key */}
        <div className="space-y-1">
          <Label htmlFor="orKey">OpenRouter API key</Label>
          <div className="flex gap-2">
            <Input
              id="orKey"
              type={showOrKey ? "text" : "password"}
              autoComplete="off"
              placeholder={hasOpenRouterKey ? "Key saved — enter a new value to replace" : "sk-or-v1-..."}
              value={value.openrouter_api_key}
              onChange={(e) => {
                onTouch("openrouter");
                onChange({ openrouter_api_key: e.target.value });
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowOrKey((s) => !s)}
              aria-label={showOrKey ? "Hide key" : "Show key"}
            >
              {showOrKey ? "Hide" : "Show"}
            </Button>
          </div>
          {orTouched && !value.openrouter_api_key && (
            <p className="text-xs text-muted-foreground">
              Clearing this field and saving removes the stored key.
            </p>
          )}
        </div>

        {/* Anthropic key (optional fallback) */}
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Anthropic direct key (optional)
          </summary>
          <div className="mt-3 space-y-1">
            <div className="flex gap-2">
              <Input
                id="anKey"
                type={showAnKey ? "text" : "password"}
                autoComplete="off"
                placeholder={hasAnthropicKey ? "Key saved — enter a new value to replace" : "sk-ant-..."}
                value={value.anthropic_api_key}
                onChange={(e) => {
                  onTouch("anthropic");
                  onChange({ anthropic_api_key: e.target.value });
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAnKey((s) => !s)}
                aria-label={showAnKey ? "Hide key" : "Show key"}
              >
                {showAnKey ? "Hide" : "Show"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only needed if you want to call Anthropic directly instead of through OpenRouter.
            </p>
            {anTouched && !value.anthropic_api_key && (
              <p className="text-xs text-muted-foreground">
                Clearing this field and saving removes the stored key.
              </p>
            )}
          </div>
        </details>

        {/* Models */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Models</p>
          {ROLE_INFO.map(({ role, label, hint }) => {
            const fallback = status?.defaults?.[role] ?? "";
            const configured = value[`llm_model_${role}` as keyof LlmSettingsValue];
            const effective = configured || fallback;
            return (
              <div key={role} className="space-y-1">
                <Label htmlFor={`model-${role}`}>
                  {label}
                  <span className="block text-xs font-normal text-muted-foreground">{hint}</span>
                </Label>
                <Input
                  id={`model-${role}`}
                  placeholder={fallback}
                  value={configured}
                  onChange={(e) =>
                    onChange({ [`llm_model_${role}`]: e.target.value } as Partial<LlmSettingsValue>)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  In use: <code>{effective}</code>
                  {!configured && fallback ? " (default)" : ""}
                </p>
              </div>
            );
          })}
        </div>

        {/* Test */}
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="testRole">Test the connection</Label>
              <select
                id="testRole"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={testRole}
                onChange={(e) => setTestRole(e.target.value as LlmRole)}
              >
                {ROLE_INFO.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={runTest} disabled={testing}>
              {testing ? <Spinner className="mr-2 h-3 w-3" /> : null}
              {testing ? "Testing…" : "Send test request"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Save your changes first — the test uses the saved configuration.
          </p>
          {result && (
            <div
              className={`rounded-md p-2 text-xs ${
                result.ok ? "bg-muted text-foreground" : "text-destructive"
              }`}
            >
              {result.ok ? (
                <>
                  OK — {result.provider} · <code>{result.model}</code> · {result.ms}ms
                  {result.reply ? ` · replied "${result.reply}"` : ""}
                </>
              ) : (
                <>Failed — {result.error}</>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
