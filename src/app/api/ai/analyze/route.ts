import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSetting, getMasterResume, saveAnalysis, updateJob, getJobById } from "@/lib/db/queries";
import { analyzeJobsBatch, type JobAnalysisResult } from "@/lib/ai/analyzeJobs";
import { validateAnalyzeRequest } from "@/lib/validation";
import { aiRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

interface JobInput {
  role: string;
  company: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  jobType: string | null;
  description: string | null;
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
  const validation = validateAnalyzeRequest(body);
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

  // Run the full ranking analysis (includes estimated salary) if we have a jobId
  let rankAnalysis: JobAnalysisResult | null = null;
  let blsWage = null;
  
  if (validation.data!.jobId) {
    const job = getJobById(validation.data!.jobId);
    if (job) {
      const jobInput: JobInput = {
        role: job.role,
        company: job.company,
        location: job.location,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        jobType: null,
        description: job.description,
      };
      
      try {
        const analyses = await analyzeJobsBatch([jobInput], apiKey);
        rankAnalysis = analyses[0] ?? null;
        if (rankAnalysis?.socCode) {
          const { getBLSWage } = await import("@/lib/db/queries");
          blsWage = getBLSWage(rankAnalysis.socCode);
        }
      } catch {
        // Non-fatal - continue with just the ATS analysis
      }
    }
  }

  // Run the ATS keyword analysis
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
${validation.data!.description}

Respond with ONLY the JSON object, no markdown formatting, no explanation.`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
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

  let parsed;
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return Response.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }

  // Save analysis and auto-update salary/score from rank analysis
  if (validation.data!.jobId) {
    saveAnalysis(validation.data!.jobId, {
      keywords: parsed.keywords || [],
      fitScore: parsed.fitScore || 0,
      redFlags: parsed.redFlags || [],
      mustHave: parsed.mustHave || [],
      niceToHave: parsed.niceToHave || [],
      questions: parsed.questions || [],
      rawResponse: text,
    });

    // Auto-update salary and score from rank analysis if available
    if (rankAnalysis && validation.data!.jobId) {
      const updates: Record<string, unknown> = {};
      
      // Get current job to check existing values
      const currentJob = getJobById(validation.data!.jobId);
      
      // Only set salary if the job doesn't already have one
      if (!body.keepExistingSalary) {
        if (currentJob?.salaryMin == null && rankAnalysis.estimatedSalaryMin != null) {
          updates.salaryMin = rankAnalysis.estimatedSalaryMin;
        }
        if (currentJob?.salaryMax == null && rankAnalysis.estimatedSalaryMax != null) {
          updates.salaryMax = rankAnalysis.estimatedSalaryMax;
        }
      }
      
      // Only set scores if they're null/unset (preserve user adjustments)
      if (currentJob) {
        if (currentJob.scoreRole == null) updates.scoreRole = 5;
        if (currentJob.scoreSkills == null) updates.scoreSkills = Math.round(rankAnalysis.scoreRequirements / 2);
        if (currentJob.scoreCompany == null) updates.scoreCompany = 3;
        if (currentJob.scoreComp == null) updates.scoreComp = Math.round(rankAnalysis.scorePay / 2);
        if (currentJob.scoreGrowth == null) updates.scoreGrowth = Math.round(rankAnalysis.scoreFlexibility / 2);
      }
      
      if (Object.keys(updates).length > 0) {
        updateJob(validation.data!.jobId, updates);
      }
    }
  }

  return Response.json({
    ...parsed,
    rankAnalysis: rankAnalysis ? {
      rankScore: rankAnalysis.rankScore,
      scorePay: rankAnalysis.scorePay,
      scoreFlexibility: rankAnalysis.scoreFlexibility,
      scoreLocation: rankAnalysis.scoreLocation,
      scoreRequirements: rankAnalysis.scoreRequirements,
      scoreHours: rankAnalysis.scoreHours,
      scoreResponsibilities: rankAnalysis.scoreResponsibilities,
      estimatedSalaryMin: rankAnalysis.estimatedSalaryMin,
      estimatedSalaryMax: rankAnalysis.estimatedSalaryMax,
      salaryConfidence: rankAnalysis.salaryConfidence,
      socCode: rankAnalysis.socCode,
      blsWage,
    } : null,
  }, { headers: rateLimit.headers });
}

export const POST = POST_handler;