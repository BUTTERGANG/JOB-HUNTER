import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, getMasterResume, saveAnalysis } from "@/lib/db/queries";

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

  const client = new Anthropic({ apiKey });

  const prompt = `Analyze this job description and return a JSON object with exactly these fields:
{
  "keywords": ["top 5-8 ATS keywords needed in a resume"],
  "fitScore": <0-100 integer estimating match with the resume provided>,
  "redFlags": ["any concerns about this posting"],
  "mustHave": ["skills/experience that are clearly required"],
  "niceToHave": ["skills/experience that are preferred but not required"],
  "questions": ["3 strong questions to ask in an interview based on gaps in the JD"]
}

${masterResume ? `\n## Candidate's Resume:\n${masterResume.content}\n` : ""}

## Job Description:
${body.description}

Respond with ONLY the JSON object, no markdown formatting, no explanation.`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `AI request failed: ${message}` }, { status: 502 });
  }

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  let parsed;
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return Response.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }

  if (body.jobId) {
    saveAnalysis(Number(body.jobId), {
      keywords: parsed.keywords || [],
      fitScore: parsed.fitScore || 0,
      redFlags: parsed.redFlags || [],
      mustHave: parsed.mustHave || [],
      niceToHave: parsed.niceToHave || [],
      questions: parsed.questions || [],
      rawResponse: text,
    });
  }

  return Response.json(parsed);
}
