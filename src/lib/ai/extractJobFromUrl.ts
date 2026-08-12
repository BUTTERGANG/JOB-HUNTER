import { execFile } from "child_process";
import { promisify } from "util";
import Anthropic from "@anthropic-ai/sdk";
import type { JobInput } from "./analyzeJobs";

const exec = promisify(execFile);

const FETCH_TIMEOUT_MS = 15_000;
const CURL_TIMEOUT_S = 20;
const MAX_TEXT_CHARS = 8000;
const MIN_USABLE_CHARS = 200;

/** Browser-like UA — some boards return a stub page (or 403) for non-browser clients. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchResult {
  ok: boolean;
  text: string;
  status: number | null;
  error?: string;
}

/**
 * Convert a fetched HTML document to readable plain text. Deliberately dependency-free:
 * drops script/style/noscript, converts block tags to newlines, strips remaining tags,
 * decodes the few common entities, and collapses whitespace.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Common browser headers that get past naive UA-only blocks. */
function browserHeaders(url: string): Record<string, string> {
  let origin = "https://www.google.com/";
  try {
    origin = new URL(url).origin + "/";
  } catch {
    /* keep default referer */
  }
  return {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    Referer: origin,
  };
}

interface RawFetch {
  ok: boolean;
  status: number | null;
  html: string;
}

/** Attempt 1: Node's built-in fetch. */
async function fetchNative(url: string): Promise<RawFetch> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: browserHeaders(url),
    });
    const html = res.ok ? await res.text().catch(() => "") : "";
    return { ok: res.ok, status: res.status, html };
  } catch {
    return { ok: false, status: null, html: "" };
  }
}

/**
 * Attempt 2/3: curl, optionally through a residential proxy. curl's TLS/HTTP
 * fingerprint differs from Node's and clears some blocks Node's fetch cannot;
 * a residential proxy (the same DataImpulse credential JobSpy uses) clears geo/IP
 * blocks. Body → stdout, HTTP status appended via -w and split off the tail.
 */
async function fetchCurl(url: string, proxy: string | null): Promise<RawFetch> {
  const STATUS_MARK = "\n__HTTP_STATUS__:";
  const args = [
    "-sL",
    "--compressed",
    "--max-time",
    String(CURL_TIMEOUT_S),
    "-A",
    BROWSER_UA,
    ...Object.entries(browserHeaders(url))
      .filter(([k]) => k !== "User-Agent")
      .flatMap(([k, v]) => ["-H", `${k}: ${v}`]),
    "-w",
    `${STATUS_MARK}%{http_code}`,
    ...(proxy ? ["-x", proxy.startsWith("http") ? proxy : `http://${proxy}`] : []),
    url,
  ];
  try {
    const { stdout } = await exec("curl", args, {
      timeout: (CURL_TIMEOUT_S + 5) * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const idx = stdout.lastIndexOf(STATUS_MARK);
    if (idx === -1) return { ok: false, status: null, html: stdout };
    const status = Number(stdout.slice(idx + STATUS_MARK.length).trim()) || null;
    const html = stdout.slice(0, idx);
    return { ok: status != null && status >= 200 && status < 300, status, html };
  } catch {
    return { ok: false, status: null, html: "" };
  }
}

function toResult(raw: RawFetch): FetchResult | null {
  if (!raw.ok) return null;
  const text = htmlToText(raw.html).slice(0, MAX_TEXT_CHARS);
  if (text.length < MIN_USABLE_CHARS) return null;
  return { ok: true, text, status: raw.status };
}

/**
 * LinkedIn's normal job pages return HTTP 999 to non-browser clients, but its
 * unauthenticated guest endpoint (the one JobSpy uses) serves the description
 * HTML. Rewrite `/jobs/view/…<id>` or `?currentJobId=<id>` links to that endpoint.
 */
function resolveFetchUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes("linkedin.com")) return url;
    const param = u.searchParams.get("currentJobId");
    let id = param && /^\d{6,}$/.test(param) ? param : null;
    if (!id) {
      const runs = u.pathname.match(/\d{6,}/g);
      if (runs) id = runs[runs.length - 1]; // job id is the last long digit run
    }
    return id ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}` : url;
  } catch {
    return url;
  }
}

/**
 * Fetch a job posting URL and return its readable text. Tries, in order:
 * native fetch → curl (direct) → curl (via residential proxy, if configured).
 * Sites that block all three (notably Indeed/Glassdoor) return `ok:false` and the
 * caller falls back to manual paste.
 */
export async function fetchJobPageText(
  url: string,
  opts?: { proxy?: string | null }
): Promise<FetchResult> {
  const proxy = opts?.proxy ?? null;
  const target = resolveFetchUrl(url);
  let lastStatus: number | null = null;

  for (const attempt of [
    () => fetchNative(target),
    () => fetchCurl(target, null),
    ...(proxy ? [() => fetchCurl(target, proxy)] : []),
  ]) {
    const raw = await attempt();
    if (raw.status != null) lastStatus = raw.status;
    const result = toResult(raw);
    if (result) return result;
  }

  const error =
    lastStatus === 403 || lastStatus === 401 || lastStatus === 429 || lastStatus === 999
      ? `The site blocked the fetch (HTTP ${lastStatus}) — Indeed and Glassdoor do this even through a proxy.`
      : lastStatus && lastStatus >= 400
      ? `The site returned HTTP ${lastStatus}.`
      : "Couldn't read a usable job description from that page (it may be JavaScript-rendered or gated).";
  return { ok: false, text: "", status: lastStatus, error };
}

/** Infer a job-board source label from a URL's hostname. */
export function sourceFromUrl(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host.includes("linkedin")) return "linkedin";
  if (host.includes("indeed")) return "indeed";
  if (host.includes("glassdoor")) return "glassdoor";
  if (host.includes("ziprecruiter")) return "ziprecruiter";
  if (host.includes("google")) return "google";
  if (host.includes("greenhouse")) return "greenhouse";
  if (host.includes("lever")) return "lever";
  if (host.includes("workday") || host.includes("myworkdayjobs")) return "workday";
  // Fall back to the registrable-ish name (first label of the host).
  return host.split(".")[0] || host;
}

const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

function buildExtractionPrompt(content: string): string {
  return `You are given the raw text of a single job posting (scraped from a web page or pasted by a user). Extract the structured fields below and return ONLY a JSON object — no markdown, no commentary.

{
  "role": string,               // the job title, e.g. "Senior Accountant". Empty string if genuinely absent.
  "company": string,            // hiring company/organization name. Empty string if absent.
  "location": string | null,    // city/state or "Remote"; null if not stated
  "salaryMin": number | null,   // annual USD minimum if a salary is explicitly stated; convert hourly to annual (hourly*2080); null if not stated
  "salaryMax": number | null,   // annual USD maximum if explicitly stated; null if not stated
  "jobType": string | null,     // e.g. "Full-time", "Part-time", "Contract", "Internship"; null if not stated
  "description": string         // the core job description: responsibilities, requirements, qualifications, benefits. Clean it up but keep the substance. Cap around 1500 characters.
}

Rules:
- Only put a salary number if the posting actually states pay. Do NOT invent or estimate here.
- Strip navigation, cookie banners, "apply now", and other boilerplate from the description.
- If the content is clearly NOT a job posting, set role and company to "" and put a short note in description.

JOB POSTING CONTENT:
${content}`;
}

/**
 * Use Haiku to turn raw page/pasted text into a structured JobInput. Mirrors the
 * JSON-guard style of analyzeChunk() in analyzeJobs.ts.
 */
export async function extractJobInput(content: string, apiKey: string): Promise<JobInput> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: buildExtractionPrompt(content.slice(0, MAX_TEXT_CHARS)) }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("extractJobInput: no JSON object in model response");
  }

  const parsed = JSON.parse(match[0]) as Partial<JobInput>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && isFinite(v) ? Math.round(v) : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  return {
    role: str(parsed.role) ?? "",
    company: str(parsed.company) ?? "",
    location: str(parsed.location),
    salaryMin: num(parsed.salaryMin),
    salaryMax: num(parsed.salaryMax),
    jobType: str(parsed.jobType),
    description: str(parsed.description),
  };
}
