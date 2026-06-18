import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, getMasterResume, saveTailoredResume } from "@/lib/db/queries";

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
  if (!masterResume) {
    return Response.json(
      { error: "No master resume found. Go to Settings to add your resume." },
      { status: 400 }
    );
  }

  const client = new Anthropic({ apiKey });

  const prompt = `I will give you two documents:
1. My MASTER RESUME (contains all my experience)
2. A JOB DESCRIPTION I want to apply to

Create a tailored 1-page resume that maximizes my fit for THIS role.

Rules:
- ONLY use information from my master resume. Do NOT invent anything.
- Keep every metric and number exactly as-is.
- Reorder bullets to lead with the most relevant experience.
- Rewrite the Professional Summary to mirror the job's language.
- Reorder Skills to front-load what this job values.
- Remove bullets irrelevant to this role (keep 3-4 per role max).
- Use the job's exact terminology (if they say "Kubernetes", say "Kubernetes" not "K8s").
- Vary sentence structure — not every bullet should follow the same pattern.
- Write in a natural, human voice — not a press release.
- Keep employment dates, job titles, and company names unchanged.

Output clean markdown. Start with the resume content directly, no preamble.

## MASTER RESUME:
${masterResume.content}

## JOB DESCRIPTION:
${body.description}`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  if (body.jobId) {
    saveTailoredResume(Number(body.jobId), text);
  }

  return Response.json({ content: text });
}
