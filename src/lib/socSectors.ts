// SOC 2018 Major Group → human-readable sector name
// https://www.bls.gov/soc/2018/major_groups.htm

const SOC_MAJOR_GROUPS: Record<string, string> = {
  "11": "Management",
  "13": "Business & Financial",
  "15": "Computer & Mathematical",
  "17": "Architecture & Engineering",
  "19": "Life, Physical & Social Science",
  "21": "Community & Social Service",
  "23": "Legal",
  "25": "Education & Training",
  "27": "Arts, Media & Entertainment",
  "29": "Healthcare Practitioners",
  "31": "Healthcare Support",
  "33": "Protective Service",
  "35": "Food Service",
  "37": "Building & Grounds Maintenance",
  "39": "Personal Care & Service",
  "41": "Sales",
  "43": "Office & Admin Support",
  "45": "Farming, Fishing & Forestry",
  "47": "Construction & Extraction",
  "49": "Installation, Maintenance & Repair",
  "51": "Production & Manufacturing",
  "53": "Transportation & Material Moving",
  "55": "Military",
};

export function getSocSectorName(socCode: string | null): string {
  if (!socCode) return "Unknown";
  const prefix = socCode.slice(0, 2);
  return SOC_MAJOR_GROUPS[prefix] ?? "Other";
}

export function getSocSectorPrefix(socCode: string | null): string {
  if (!socCode) return "Unknown";
  return socCode.slice(0, 2);
}

// Color palette for SOC sectors (consistent across charts)
export const SECTOR_COLORS: Record<string, string> = {
  "Management": "#6366f1",
  "Business & Financial": "#8b5cf6",
  "Computer & Mathematical": "#06b6d4",
  "Architecture & Engineering": "#14b8a6",
  "Life, Physical & Social Science": "#22c55e",
  "Community & Social Service": "#84cc16",
  "Legal": "#eab308",
  "Education & Training": "#f59e0b",
  "Arts, Media & Entertainment": "#f97316",
  "Healthcare Practitioners": "#ef4444",
  "Healthcare Support": "#ec4899",
  "Protective Service": "#f43f5e",
  "Food Service": "#d946ef",
  "Building & Grounds Maintenance": "#a855f7",
  "Personal Care & Service": "#8b5cf6",
  "Sales": "#3b82f6",
  "Office & Admin Support": "#64748b",
  "Farming, Fishing & Forestry": "#78716c",
  "Construction & Extraction": "#92400e",
  "Installation, Maintenance & Repair": "#b45309",
  "Production & Manufacturing": "#7c3aed",
  "Transportation & Material Moving": "#0ea5e9",
  "Military": "#475569",
  "Unknown": "#94a3b8",
  "Other": "#94a3b8",
};

export function getSectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? "#94a3b8";
}
