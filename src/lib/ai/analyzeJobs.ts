import Anthropic from "@anthropic-ai/sdk";

export interface JobSchedule {
  days: string[];
  hasOvertime: boolean;
  isRemote: boolean;
  hoursPerWeek: number | null;
  shiftType: string | null;
}

export interface JobRequirements {
  degreeRequired: string | null;
  yearsExperience: number | null;
  certificationsRequired: string[];
  backgroundCheckRequired: boolean | null;
  locationArea: string;
}

export interface JobAnalysisResult {
  rankScore: number;
  scorePay: number;
  scoreFlexibility: number;
  scoreLocation: number;
  scoreResponsibilities: number;
  scoreHours: number;
  scoreRequirements: number;
  schedule: JobSchedule;
  requirements: JobRequirements;
  benefits: string[];
  notes: string;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: "high" | "medium" | "low" | null;
  socCode: string | null;
  adjustedSalaryMin: number | null;
  adjustedSalaryMax: number | null;
  colIndex: number | null;
}

export interface JobInput {
  role: string;
  company: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  jobType: string | null;
  description: string | null;
}

const CHUNK_SIZE = 40;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function formatSalaryForPrompt(min: number | null, max: number | null): string {
  if (!min && !max) return "Not listed";
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  if (min && max) return `${fmt(min)}–${fmt(max)}/year`;
  return min ? `${fmt(min)}+/year` : `up to ${fmt(max!)}/year`;
}

function buildPrompt(jobs: JobInput[]): string {
  const jobList = jobs
    .map(
      (j, i) => `
JOB ${i + 1}
Title: ${j.role}
Company: ${j.company}
Location: ${j.location || "Not specified"}
Salary: ${formatSalaryForPrompt(j.salaryMin, j.salaryMax)}
Job Type: ${j.jobType || "Not specified"}
Description:
${(j.description || "No description available.").substring(0, 1200)}
`
    )
    .join("\n---\n");

  return `You are a job fit analyst for a specific job seeker:
- NO college degree (hard constraint — any listing requiring bachelor's or higher is a serious negative)
- Lives in Indianapolis/Fishers area of Indiana
- Wants: good pay (adjusted for cost of living), flexible work, minimal commute, manageable responsibilities
- Remote work is excellent (eliminates commute — top location tier)
- Open to out-of-state roles IF the salary compensates for cost of living differences

COST OF LIVING INDEX (national average = 100, Indianapolis = 91):
  ~85-90: AL, AR, ID, IN, KS, KY, LA, MO, MS, MT, NE, NM, OH, OK, SC, SD, TN, WV, WY
  ~91-100: FL, GA, IA, MI, NC, PA, TX, UT, VA, WI
  ~101-115: AZ, CO, DE, IL, ME, MN, NV, OR, RI
  ~116-130: CT, MD, MA, NH, NJ, WA
  ~131-150: CA, DC, HI, NY, VT
  For out-of-state jobs: adjust salary to Indianapolis-equivalent before scoring pay.
  Formula: adjusted_salary = listed_salary × (91 / state_COL_index)
  Example: $120k in California (COL 142) → $120k × (91/142) = $77k Indy-equivalent
  Example: $60k in Alabama (COL 87) → $60k × (91/87) = $63k Indy-equivalent

For each job below, return a JSON array. Each element must have exactly these fields:

rankScore: integer 0–100. Formula: round((scorePay*0.25 + scoreFlexibility*0.20 + scoreLocation*0.20 + scoreRequirements*0.20 + scoreHours*0.15) * 10)

scorePay: 0–10 — ALWAYS score based on cost-of-living-adjusted salary vs Indianapolis market
  First compute adjusted salary: listed_salary × (91 / state_COL_index). If salary not listed, estimate for Indianapolis market (COL 91) directly.
  10=adjusted salary $90k+ (excellent purchasing power anywhere)
  8=adjusted salary $70-90k (strong purchasing power)
  6=adjusted salary $55-70k (good, above Indianapolis median ~$58k)
  5=adjusted salary $45-55k (market rate for Indianapolis)
  4=adjusted salary $35-45k (below market)
  3=adjusted salary $25-35k (low pay)
  0=adjusted salary under $25k or explicitly exploitative
  KEY: A $100k job in San Francisco (COL 142) → $64k adjusted → score ~6. A $60k job in Alabama (COL 87) → $63k adjusted → score ~6. These should score similarly.

scoreFlexibility: 0–10
  10=fully remote; 7=hybrid 2-3 days remote; 4=on-site flexible hours; 0=strict on-site fixed schedule

scoreLocation: 0–10 (desirability of location, NOT a binary in/out penalty)
  10=Indianapolis, Fishers, Carmel, Noblesville, Westfield, Avon, Greenwood (ideal — no relocation)
  9=Remote/Anywhere (no commute, live anywhere — best of both worlds)
  7=Hamilton/Johnson/Marion County suburbs within 35 min of Indianapolis
  5=Central Indiana within 45 miles of Indianapolis (Shelbyville, Greenfield, Brownsburg)
  3=Indiana 45+ miles from Indianapolis (Bloomington, Columbus, Anderson, Muncie)
  1=Far Indiana (Fort Wayne, South Bend, Evansville, Gary)
  OUT OF STATE scoring (based on desirability + feasibility of relocation):
    8=Desirable low/moderate-COL states where adjusted salary goes far: AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, TX
    6=Moderate-COL states with good quality of life: AZ, CO, IA, KS, MI, MN, MO, NE, NM, OH, OK, PA, UT, VA, WI
    4=Higher-COL states where salary must be strong to justify: CT, DE, IL, MD, ME, NV, OR, RI, WA
    2=Very high-COL states — only score high if adjusted salary is excellent ($80k+): CA, DC, HI, MA, NJ, NY, VT
    1=Extreme hardship/remote locations: Alaska, Hawaii (unless remote), territories
  RULE: if job_type contains "remote" OR location contains "Remote"/"Anywhere"/"Work from home" → scoreLocation=9

scoreRequirements: 0–10 — CRITICAL, job seeker has NO college degree
  10=no degree required, skills/experience preferred or "will train"
  8=experience preferred not required, no degree mentioned
  6=high school diploma or GED only required
  4=associate's degree OR 1-2 years experience required
  2=bachelor's degree required OR 3+ years strict experience required
  0=master's/PhD required OR bachelor's + extensive experience
  RULE: if listing says "bachelor's degree required" or "BS/BA required" → scoreRequirements MUST be ≤2
  RULE: if listing says "master's required" or "PhD" or "advanced degree" → scoreRequirements MUST be 0 or 1

scoreResponsibilities: 0–10
  10=simple light duties; 5=moderate complexity; 0=highly complex multi-discipline role

scoreHours: 0–10
  10=standard 40h/wk Monday-Friday no OT; 7=some flexibility or set schedule; 4=some OT or rotating; 0=heavy OT or unusual hours

schedule: {
  days: string[] (e.g. ["Monday-Friday"] or ["Weekends","Evenings"]),
  hasOvertime: boolean,
  isRemote: boolean (true if any remote option available),
  hoursPerWeek: number|null,
  shiftType: "day"|"evening"|"night"|"rotating"|null
}

requirements: {
  degreeRequired: "none"|"high_school"|"associate"|"bachelor"|"master"|"phd"|null (null=not mentioned, "none"=explicitly not required),
  yearsExperience: number|null (minimum years explicitly required; null if not stated),
  certificationsRequired: string[] (REQUIRED certs only, not preferred; [] if none),
  backgroundCheckRequired: boolean|null (true/false if mentioned, null if not stated),
  locationArea: classify as one of exactly: "Indianapolis/Fishers"|"Indianapolis metro"|"Central Indiana"|"Remote"|"Far Indiana"|"Out of state"|"Unspecified"
}

benefits: string[] (explicitly mentioned benefits, e.g. ["Health Insurance","401(k)","PTO","Dental","Vision"])
notes: string (exactly 1 sentence highlighting the biggest positive and biggest negative for this job seeker)

estimatedSalaryMin: integer | null — estimated annual salary minimum in USD for this role in the Indianapolis, IN area (what this role would pay in Indy). Provide an estimate even when salary is not listed; null only if the listing is completely uninformative. Indianapolis-area wages are typically 85-95% of national median. Round to nearest $1,000.
estimatedSalaryMax: integer | null — estimated annual salary maximum in USD for Indianapolis area. Should be 10-30% above estimatedSalaryMin for a realistic range.
salaryConfidence: "high" | "medium" | "low" — "high" if salary was explicitly listed in the posting; "medium" if role title and responsibilities give strong signals (common job with known pay bands); "low" if minimal info and estimate is a rough guess.
	adjustedSalaryMin: integer | null — cost-of-living-adjusted salary minimum in Indianapolis-equivalent dollars. Formula: listed_or_estimated_salary_min x (91 / state_COL_index). Use the COL index table above. If location is unspecified, same as estimatedSalaryMin. Round to nearest $1,000.
	adjustedSalaryMax: integer | null — cost-of-living-adjusted salary maximum. Formula: listed_or_estimated_salary_max x (91 / state_COL_index). Round to nearest $1,000.
	colIndex: integer | null — the cost-of-living index number (national avg = 100, Indianapolis = 91). Use the COL index table (e.g., CA=142, AL=87, FL=103, TX=93, NY=136). null if location is unspecified.

socCode: string | null — the best matching BLS Standard Occupational Classification (SOC) code for this role. Format "XX-XXXX" (e.g., "15-1252" for Software Developers, "43-4051" for Customer Service Representatives, "41-2031" for Retail Salespersons, "49-3023" for Automotive Service Technicians and Repairers, "53-3032" for Heavy and Tractor-Trailer Truck Drivers, "11-1021" for General and Operations Managers, "13-2011" for Accountants and Auditors, "43-3031" for Bookkeeping/Accounting Clerks, "29-1141" for Registered Nurses, "35-3023" for Fast Food and Counter Workers, "41-9099" for Sales Workers). null only if the role is truly ambiguous.

SALARY GUIDANCE: If salary IS listed in the posting, set estimatedSalaryMin/Max to those listed values and confidence "high". If not listed, estimate for Indianapolis market. Entry-level blue-collar: $30k-$45k. Skilled trades: $45k-$80k. Entry-level office/admin: $35k-$50k. Mid-level professional: $55k-$90k. Senior tech/engineering: $90k-$140k. CRITICAL: For out-of-state jobs, ALWAYS compute adjustedSalaryMin/Max using the COL formula. scorePay MUST be based on the ADJUSTED salary, not the raw listed salary. A $120k CA job (COL 142) adjusts to $77k Indy-equivalent = score ~6. A $60k AL job (COL 87) adjusts to $63k = score ~6.

Return ONLY a valid JSON array with exactly ${jobs.length} elements in the same order as the input jobs. No markdown, no explanation, no text outside the JSON array.

${jobList}`;
}

function normalizeResult(r: JobAnalysisResult): JobAnalysisResult {
  const clamp = (v: unknown, max: number) =>
    Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  return {
    rankScore: clamp(r.rankScore, 100),
    scorePay: clamp(r.scorePay, 10),
    scoreFlexibility: clamp(r.scoreFlexibility, 10),
    scoreLocation: clamp(r.scoreLocation, 10),
    scoreResponsibilities: clamp(r.scoreResponsibilities, 10),
    scoreHours: clamp(r.scoreHours, 10),
    scoreRequirements: clamp(r.scoreRequirements, 10),
    schedule: {
      days: Array.isArray(r.schedule?.days) ? r.schedule.days : [],
      hasOvertime: Boolean(r.schedule?.hasOvertime),
      isRemote: Boolean(r.schedule?.isRemote),
      hoursPerWeek: r.schedule?.hoursPerWeek ?? null,
      shiftType: r.schedule?.shiftType ?? null,
    },
    requirements: {
      degreeRequired:
        typeof r.requirements?.degreeRequired === "string"
          ? r.requirements.degreeRequired
          : null,
      yearsExperience:
        typeof r.requirements?.yearsExperience === "number"
          ? r.requirements.yearsExperience
          : null,
      certificationsRequired: Array.isArray(r.requirements?.certificationsRequired)
        ? r.requirements.certificationsRequired
        : [],
      backgroundCheckRequired:
        r.requirements?.backgroundCheckRequired != null
          ? Boolean(r.requirements.backgroundCheckRequired)
          : null,
      locationArea:
        typeof r.requirements?.locationArea === "string"
          ? r.requirements.locationArea
          : "Unspecified",
    },
    benefits: Array.isArray(r.benefits) ? r.benefits : [],
    notes: typeof r.notes === "string" ? r.notes : "",
    estimatedSalaryMin:
      typeof r.estimatedSalaryMin === "number" ? Math.round(r.estimatedSalaryMin) : null,
    estimatedSalaryMax:
      typeof r.estimatedSalaryMax === "number" ? Math.round(r.estimatedSalaryMax) : null,
    salaryConfidence:
      r.salaryConfidence === "high" || r.salaryConfidence === "medium" || r.salaryConfidence === "low"
        ? r.salaryConfidence
        : null,
    socCode:
      typeof r.socCode === "string" && /^\d{2}-\d{4}$/.test(r.socCode) ? r.socCode : null,
    adjustedSalaryMin:
      typeof r.adjustedSalaryMin === "number" ? Math.round(r.adjustedSalaryMin) : null,
    adjustedSalaryMax:
      typeof r.adjustedSalaryMax === "number" ? Math.round(r.adjustedSalaryMax) : null,
    colIndex:
      typeof r.colIndex === "number" && r.colIndex > 0 ? Math.round(r.colIndex) : null,
  };
}

async function analyzeChunk(
  client: Anthropic,
  jobs: JobInput[]
): Promise<JobAnalysisResult[]> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 12000,
    messages: [{ role: "user", content: buildPrompt(jobs) }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : "";
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`analyzeJobs: no JSON array in response for chunk of ${jobs.length}`);
  }

  const parsed: JobAnalysisResult[] = JSON.parse(match[0]);
  if (!Array.isArray(parsed) || parsed.length !== jobs.length) {
    throw new Error(
      `analyzeJobs: expected ${jobs.length} results, got ${parsed?.length ?? 0}`
    );
  }

  return parsed.map(normalizeResult);
}

export async function analyzeJobsBatch(
  jobs: JobInput[],
  apiKey: string
): Promise<JobAnalysisResult[]> {
  const client = new Anthropic({ apiKey });
  const chunks = chunkArray(jobs, CHUNK_SIZE);
  const allResults: JobAnalysisResult[] = [];

  for (const chunk of chunks) {
    const results = await analyzeChunk(client, chunk);
    allResults.push(...results);
  }

  return allResults;
}
