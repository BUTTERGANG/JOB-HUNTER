import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, getMasterResume, saveTailoredResume, getAnalysis } from "@/lib/db/queries";
import { ResumeStructure } from "@/lib/resumeTemplate";

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.description) {
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
  if (body.jobId) {
    const analysis = getAnalysis(Number(body.jobId));
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
${body.description}${intel}`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }

  // Models with extended thinking return a leading "thinking" block, so pull the
  // first actual text block rather than assuming content[0].
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  // Parse JSON response
  let resumeJson: ResumeStructure;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    resumeJson = JSON.parse(jsonStr) as ResumeStructure;
  } catch {
    // Fallback: return raw markdown if JSON parsing fails (backward compatible)
    if (body.jobId) {
      saveTailoredResume(Number(body.jobId), text);
    }
    return Response.json({ content: text, isLegacy: true });
  }

  if (body.jobId) {
    saveTailoredResume(Number(body.jobId), JSON.stringify(resumeJson));
  }

  return Response.json({ content: resumeJson });
}
