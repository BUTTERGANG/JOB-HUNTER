/**
 * Provider-agnostic LLM access.
 *
 * This app used to talk to Anthropic directly through `@anthropic-ai/sdk` with
 * model ids baked into the call sites (`claude-sonnet-5`,
 * `claude-haiku-4-5-20251001` — the second is not a real id anywhere). Every AI
 * feature now goes through `chatComplete` here, so the provider, the key and the
 * model per role are configuration rather than code.
 *
 * Defaults to OpenRouter (OpenAI-compatible), because that key is already
 * present on this machine at `~/.hermes/.env`. Anthropic direct still works if
 * someone has an Anthropic key and no OpenRouter one.
 *
 * Key resolution order: app setting → environment variable. The key lives in the
 * (gitignored) SQLite `settings` table when configured through the UI and is
 * never returned in plaintext by the settings API.
 */

import { getSetting } from "@/lib/db/queries";

export type LlmProvider = "openrouter" | "anthropic";

/** Roles, so a cheap model can rank thousands of listings while a strong one writes resumes. */
export type LlmRole = "ranker" | "tailor" | "extract" | "ats";

export const LLM_DEFAULTS = {
  provider: "openrouter" as LlmProvider,
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  models: {
    // Bulk listing ranking: millions of tokens, needs reliable JSON, cheap.
    ranker: "anthropic/claude-haiku-5.5",
    // Resume tailoring: user-facing quality matters more than cost.
    tailor: "anthropic/claude-sonnet-5",
    // Structured extraction from a posting page.
    extract: "anthropic/claude-haiku-5.5",
    // Per-job ATS analysis against the master resume.
    ats: "anthropic/claude-sonnet-5",
  } as Record<LlmRole, string>,
};

const MODEL_SETTING_BY_ROLE: Record<LlmRole, string> = {
  ranker: "llm_model_ranker",
  tailor: "llm_model_tailor",
  extract: "llm_model_extract",
  ats: "llm_model_ats",
};

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string | null;
  baseUrl: string;
  models: Record<LlmRole, string>;
  /** Where the key came from, so the UI can say something useful. */
  keySource: "settings" | "environment" | null;
}

/**
 * Resolve the active provider, key and per-role models.
 *
 * If a configured provider has no key, fall back to the other one rather than
 * failing — a stale key in settings should not brick every AI feature.
 */
export function getLlmConfig(): LlmConfig {
  const settingProvider = (getSetting("llm_provider") || "").trim().toLowerCase();
  const orKeySetting = (getSetting("openrouter_api_key") || "").trim();
  const anKeySetting = (getSetting("anthropic_api_key") || "").trim();
  const orKeyEnv = (process.env.OPENROUTER_API_KEY || "").trim();
  const anKeyEnv = (process.env.ANTHROPIC_API_KEY || "").trim();

  let provider: LlmProvider =
    settingProvider === "anthropic" || settingProvider === "openrouter"
      ? (settingProvider as LlmProvider)
      : LLM_DEFAULTS.provider;

  // A configured key for the chosen provider wins; otherwise take whichever
  // provider actually has one.
  const hasFor = (p: LlmProvider) =>
    p === "openrouter" ? !!orKeySetting || !!orKeyEnv : !!anKeySetting || !!anKeyEnv;
  if (!hasFor(provider)) {
    if (hasFor("openrouter")) provider = "openrouter";
    else if (hasFor("anthropic")) provider = "anthropic";
  }

  let apiKey: string | null = null;
  let keySource: LlmConfig["keySource"] = null;
  if (provider === "openrouter") {
    if (orKeySetting) {
      apiKey = orKeySetting;
      keySource = "settings";
    } else if (orKeyEnv) {
      apiKey = orKeyEnv;
      keySource = "environment";
    }
  } else {
    if (anKeySetting) {
      apiKey = anKeySetting;
      keySource = "settings";
    } else if (anKeyEnv) {
      apiKey = anKeyEnv;
      keySource = "environment";
    }
  }

  const models = {} as Record<LlmRole, string>;
  for (const role of Object.keys(LLM_DEFAULTS.models) as LlmRole[]) {
    models[role] = (getSetting(MODEL_SETTING_BY_ROLE[role]) || "").trim() || LLM_DEFAULTS.models[role];
  }

  return {
    provider,
    apiKey,
    baseUrl:
      provider === "openrouter" ? LLM_DEFAULTS.openrouterBaseUrl : LLM_DEFAULTS.anthropicBaseUrl,
    models,
    keySource,
  };
}

/** Cheap check for the "is this feature runnable?" paths (API routes, runners). */
export function hasLlmKey(): boolean {
  return !!getLlmConfig().apiKey;
}

/** Human-readable reason to show the user when a feature cannot run. */
export function llmKeyHint(): string {
  const cfg = getLlmConfig();
  return cfg.provider === "openrouter"
    ? "No OpenRouter API key configured. Add one in Settings, or set OPENROUTER_API_KEY."
    : "No Anthropic API key configured. Add one in Settings, or set ANTHROPIC_API_KEY.";
}

export interface ChatOptions {
  role: LlmRole;
  /** Overrides the role's configured model. */
  model?: string;
  user: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object response; retried without it if the provider rejects it. */
  jsonObject?: boolean;
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: LlmProvider;
  usage: { inputTokens: number | null; outputTokens: number | null };
  /** Set when the response ended because it hit the token ceiling. */
  truncated: boolean;
}

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

interface OpenRouterResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

/** Anthropic's /v1/messages shape, for the direct-provider fallback. */
interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  // Some providers return an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/** Turn an HTTP failure into something the user can act on. */
function describeHttpError(status: number, body: string, provider: LlmProvider): string {
  let detail = body.slice(0, 400);
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || detail;
  } catch {
    /* keep the raw snippet */
  }
  const keyName = provider === "openrouter" ? "OpenRouter" : "Anthropic";
  if (status === 401) return `${keyName} rejected the API key (401). ${detail}`;
  if (status === 402) return `${keyName} says the account is out of credit (402): ${detail}`;
  if (status === 403) return `${keyName} refused the request (403): ${detail}`;
  if (status === 404) return `${keyName} could not find that model (404): ${detail}`;
  if (status === 429) return `${keyName} rate-limited the request (429). Try again shortly. ${detail}`;
  return `${keyName} request failed (${status}): ${detail}`;
}

/**
 * One chat completion. Provider-agnostic; callers only care about the text.
 *
 * Errors are thrown as LlmError with a readable message and an HTTP-ish status
 * so routes can surface them to the user instead of a generic 500.
 */
export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  const cfg = getLlmConfig();
  if (!cfg.apiKey) throw new LlmError(llmKeyHint(), 400);

  const model = opts.model || cfg.models[opts.role];
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (cfg.provider === "anthropic") {
      return await anthropicChat(opts, model, cfg, controller.signal);
    }
    return await openRouterChat(opts, model, cfg, controller.signal);
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new LlmError(`The model request timed out after ${Math.round(timeoutMs / 1000)}s.`, 504);
    }
    throw new LlmError(e instanceof Error ? e.message : "Unknown AI request failure", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function openRouterChat(
  opts: ChatOptions,
  model: string,
  cfg: LlmConfig,
  signal: AbortSignal
): Promise<ChatResult> {
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.jsonObject) body.response_format = { type: "json_object" };

  const send = async (payload: Record<string, unknown>) =>
    fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution only; harmless and helpful.
        "HTTP-Referer": "http://localhost:3002",
        "X-Title": "JobHunt",
      },
      body: JSON.stringify(payload),
      signal,
    });

  let res = await send(body);

  // Not every model accepts response_format. Retry once without it rather than
  // failing a whole ranking run over a formatting preference.
  if (!res.ok && opts.jsonObject && res.status === 400) {
    const text = await res.text();
    if (/response_format|json_object|unsupported/i.test(text)) {
      delete body.response_format;
      res = await send(body);
    } else {
      throw new LlmError(describeHttpError(res.status, text, "openrouter"), res.status);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(describeHttpError(res.status, text, "openrouter"), res.status);
  }

  const data = (await res.json()) as OpenRouterResponse;
  if (data.error) {
    throw new LlmError(`OpenRouter error: ${data.error.message ?? "unknown"}`, 502);
  }
  const choice = data.choices?.[0];
  const text = textFromContent(choice?.message?.content);
  if (!text.trim()) {
    throw new LlmError("The model returned an empty response.", 502);
  }

  return {
    text,
    model,
    provider: "openrouter",
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    },
    truncated: choice?.finish_reason === "length",
  };
}

async function anthropicChat(
  opts: ChatOptions,
  model: string,
  cfg: LlmConfig,
  signal: AbortSignal
): Promise<ChatResult> {
  const res = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.user }],
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(describeHttpError(res.status, text, "anthropic"), res.status);
  }

  const data = (await res.json()) as AnthropicResponse;
  // Extended thinking returns a leading thinking block — take the first text block.
  const text = (data.content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");
  if (!text.trim()) throw new LlmError("The model returned an empty response.", 502);

  return {
    text,
    model,
    provider: "anthropic",
    usage: {
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    },
    truncated: data.stop_reason === "max_tokens",
  };
}

/** Pull the first JSON value out of a model response (fences and prose tolerated). */
export function extractJson<T = unknown>(text: string, expect: "array" | "object"): T {
  const unfenced = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const pattern = expect === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = unfenced.match(pattern);
  if (!match) {
    throw new LlmError(
      `The model did not return ${expect === "array" ? "a JSON array" : "a JSON object"}. First 200 chars: ${text.slice(0, 200)}`,
      502
    );
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (e) {
    throw new LlmError(
      `Could not parse the model's JSON: ${e instanceof Error ? e.message : "invalid JSON"}`,
      502
    );
  }
}

/** Cheap connectivity/model check for the Settings UI. */
export async function testLlm(role: LlmRole = "ranker"): Promise<{
  ok: boolean;
  provider: LlmProvider;
  model: string;
  ms: number;
  reply?: string;
  error?: string;
  usage?: ChatResult["usage"];
}> {
  const cfg = getLlmConfig();
  const model = cfg.models[role];
  const started = Date.now();
  try {
    const res = await chatComplete({
      role,
      user: "Reply with exactly the word: ok",
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 30_000,
    });
    return {
      ok: true,
      provider: res.provider,
      model: res.model,
      ms: Date.now() - started,
      reply: res.text.trim().slice(0, 40),
      usage: res.usage,
    };
  } catch (e) {
    return {
      ok: false,
      provider: cfg.provider,
      model,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}
