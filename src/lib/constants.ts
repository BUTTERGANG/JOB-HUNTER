export const JOB_STATUSES = [
  { value: "saved", label: "Saved", color: "bg-gray-100 text-gray-700" },
  { value: "applied", label: "Applied", color: "bg-yellow-100 text-yellow-800" },
  { value: "phone_screen", label: "Phone Screen", color: "bg-blue-100 text-blue-800" },
  { value: "technical", label: "Technical", color: "bg-purple-100 text-purple-800" },
  { value: "onsite", label: "Onsite", color: "bg-orange-100 text-orange-800" },
  { value: "offer", label: "Offer", color: "bg-green-100 text-green-800" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
  { value: "ghosted", label: "Ghosted", color: "bg-gray-200 text-gray-600" },
  { value: "withdrew", label: "Withdrew", color: "bg-gray-100 text-gray-500" },
] as const;

export const JOB_TIERS = [
  { value: "A", label: "Tier A", color: "bg-green-100 text-green-800" },
  { value: "B", label: "Tier B", color: "bg-blue-100 text-blue-800" },
  { value: "C", label: "Tier C", color: "bg-gray-100 text-gray-700" },
] as const;

export const JOB_SOURCES = [
  "LinkedIn",
  "Indeed",
  "Hacker News",
  "Wellfound",
  "Otta",
  "Levels.fyi",
  "BuiltIn",
  "RemoteOK",
  "Company Career Page",
  "Referral",
  "Recruiter",
  "Other",
] as const;

export const SCORE_DIMENSIONS = [
  { key: "scoreRole", label: "Role Match", description: "Title, seniority, domain fit" },
  { key: "scoreSkills", label: "Skill Overlap", description: "How many reqs do you meet?" },
  { key: "scoreCompany", label: "Company Quality", description: "Stage, funding, eng culture" },
  { key: "scoreComp", label: "Compensation", description: "Meets your floor? Range posted?" },
  { key: "scoreGrowth", label: "Growth Potential", description: "Learning, title, scope" },
] as const;

export const FOLLOW_UP_DAYS = 10;
export const SCORE_THRESHOLD_HIGH = 18;
export const SCORE_THRESHOLD_MID = 14;
export const ACTIVE_INTERVIEW_STATUSES = ["phone_screen", "technical", "onsite"] as const;
export const TERMINAL_STATUSES = ["rejected", "ghosted", "withdrew"] as const;

export function scoreColor(total: number | null): string {
  if (total == null) return "text-muted-foreground";
  if (total >= SCORE_THRESHOLD_HIGH) return "text-green-600";
  if (total >= SCORE_THRESHOLD_MID) return "text-blue-600";
  return "text-muted-foreground";
}
