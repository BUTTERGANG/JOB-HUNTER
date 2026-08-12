import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, getMasterResume, saveTailoredResume, getAnalysis } from "@/lib/db/queries";
import { validateTailorRequest } from "@/lib/validation";
import { aiRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = aiRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  // Validate input
  const validation = validateTailorRequest(body);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  if (!validation.data!.description) {
    return Response.json({ error: "Job description is required" }, { status: 400 });
  }

  const apiKey = getSetting("anthropic_api_key");
  if (!apiKey) {
    return Response.json(
      { error: "Anthropic API key not configured. Go to Settings to add it." },
      { status: 400 }
    );
  }

  const masterResume = getMasterResume();
  // An empty/whitespace-only master résumé is as useless as none — fail loudly so
  // tailoring never runs on a blank source.
  if (!masterResume || !masterResume.content.trim()) {
    return Response.json(
      { error: "No master resume found. Go to Settings to add your resume." },
      { status: 400 }
    );
  }

  // Fold in the intel we already gathered for this job (from the JD analysis), so
  // the tailored résumé front-loads the exact ATS terms the posting calls for.
  let intel = "";
  if (validation.data!.jobId) {
    const analysis = getAnalysis(validation.data!.jobId);
    if (analysis) {
      const keywords = parseJsonArray(analysis.keywords);
      const mustHave = parseJsonArray(analysis.mustHave);
      const lines: string[] = [];
      if (keywords.length) lines.push(`ATS keywords to include where truthful: ${keywords.join(", ")}`);
      if (mustHave.length) lines.push(`Must-have requirements to address: ${mustHave.join(", ")}`);
      if (lines.length) intel = `\n\n## POSTING INTEL (prioritize these where my experience supports them):\n${lines.join("\n")}`;
    }
  }

  const client = new Anthropic({ apiKey });

  const prompt = `I will give you two documents:
1. My MASTER RESUME (contains all my experience)
2. A JOB DESCRIPTION I want to apply to

Create a tailored resume that maximizes my fit for THIS role. Output STRICT JSON matching the schema below — no other text.

Rules:
- ONLY use information from my master resume. Do NOT invent anything.
- Keep every metric and number exactly as-is.
- Reorder bullets to lead with the most relevant experience.
- Rewrite the Professional Summary to mirror the job's language.
- Categorize skills into Technical, Operations, Leadership.
- Remove bullets irrelevant to this role (keep 3-4 per role max).
- Use the job's exact terminology (if they say "Kubernetes", say "Kubernetes" not "K8s").
- Keep employment dates, job titles, and company names unchanged.
- Generate a role-specific tagline (2-4 words summarizing the role for this job).

JSON Schema:
{
  "name": "string",
  "tagline": "string (2-4 words, role-specific like 'Content Creator' or 'Ecommerce Manager')",
  "contact": {
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string (optional)",
    "portfolio": "string (optional)"
  },
  "professionalSummary": "string (3-4 concise sentences)",
  "coreCompetencies": {
    "technical": ["array of skills"],
    "operations": ["array of skills"],
    "leadership": ["array of skills"]
  },
  "professionalExperience": [
    {
      "title": "string",
      "company": "string",
      "location": "string",
      "startDate": "string (e.g. 'Jan 2022')",
      "endDate": "string (e.g. 'Present' or 'Mar 2024')",
      "bullets": ["array of 3-4 concise bullets"]
    }
  ],
  "technicalProficiencies": ["array of technical skills"],
  "certifications": ["array of certification strings"]
}

## MASTER RESUME:
${masterResume.content}

## JOB DESCRIPTION:
${validation.data!.description}${intel}`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      // A full structured résumé (summary + competencies + 3-4 roles + certs)
      // runs well past 4096 output tokens; at 4096 the JSON was getting cut off
      // mid-array, producing invalid JSON that silently degraded to "legacy
      // markdown". 8192 gives comfortable headroom.
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }

  // If the model hit the token ceiling the JSON is truncated and unparseable.
  // Fail loudly instead of persisting a broken résumé the UI can't render.
  if (response.stop_reason === "max_tokens") {
    return Response.json(
      { error: "Resume was too long and got cut off. Please try generating again." },
      { status: 502 }
    );
  }

  // Models with extended thinking return a leading "thinking" block, so pull the
  // first actual text block rather than assuming content[0].
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  // Parse JSON response. Strip a ```json ... ``` code fence if the model added
  // one, then grab the outermost {...} object.
  let resumeJson: Record<string, unknown>;
  try {
    const unfenced = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
    const jsonMatch = unfenced.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : unfenced;
    resumeJson = JSON.parse(jsonStr);
  } catch {
    // Fallback: return raw markdown if JSON parsing fails (backward compatible)
    if (validation.data!.jobId) {
      saveTailoredResume(validation.data!.jobId, text);
    }
    return Response.json({ content: text, isLegacy: true }, { headers: rateLimit.headers });
  }

  if (validation.data!.jobId) {
    saveTailoredResume(validation.data!.jobId, JSON.stringify(resumeJson));
  }

  return Response.json({ content: resumeJson }, { headers: rateLimit.headers });
}

// Export the auth-wrapped handler for Next.js
export const POST = POST_handler;
