/**
 * Backfill COL-adjusted salaries for existing job_analysis records.
 *
 * Uses the state abbreviation in scrape_results.location to determine the
 * cost-of-living index, then computes:
 *   adjustedSalaryMin = estimatedSalaryMin * (91 / colIndex)
 *   adjustedSalaryMax = estimatedSalaryMax * (91 / colIndex)
 *
 * COL index reference (national avg = 100, Indianapolis = 91):
 *   ~85-90: AL(87) AR(88) ID(89) KS(87) KY(86) LA(90) MO(88) MS(85) MT(88) NE(89) NM(87) OH(88) OK(86) SC(88) SD(87) TN(87) WV(85) WY(86)
 *   ~91-100: FL(93) GA(91) IA(90) MI(89) NC(92) PA(93) TX(93) UT(94) VA(94) WI(91)
 *   ~101-115: AZ(102) CO(106) DE(108) IL(104) ME(105) MN(103) NV(107) OR(110) RI(112)
 *   ~116-130: CT(118) MD(120) MA(125) NH(117) NJ(122) WA(121)
 *   ~131-150: CA(142) DC(136) HI(145) NY(136) VT(131)
 *   Special: AK(130) HI(145)
 */

import { db } from "../src/lib/db/index";
import { scrapeResults, jobAnalysis } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";

// State-to-COL-index mapping (national avg = 100, Indianapolis = 91)
const STATE_COL: Record<string, number> = {
  AL: 87, AR: 88, AZ: 102, CA: 142, CO: 106, CT: 118, DE: 108, FL: 93, GA: 91,
  HI: 145, IA: 90, ID: 89, IL: 104, IN: 91, KS: 87, KY: 86, LA: 90, MA: 125,
  MD: 120, ME: 105, MI: 89, MN: 103, MO: 88, MS: 85, MT: 88, NC: 92, ND: 88,
  NE: 89, NH: 117, NJ: 122, NM: 87, NV: 107, NY: 136, OH: 88, OK: 86, OR: 110,
  PA: 93, RI: 112, SC: 88, SD: 87, TN: 87, TX: 93, UT: 94, VA: 94, VT: 131,
  WA: 121, WI: 91, WV: 85, WY: 86, DC: 136, AK: 130,
};

function extractState(location: string | null): string | null {
  if (!location) return null;
  // Match 2-letter state code before ", US" or at end of string
  const match = location.match(/,\s*([A-Z]{2})(?:\s*,?\s*US)?$/);
  return match ? match[1] : null;
}

async function main() {
  const d = db();

  // Get all analysis rows with their location data
  const rows = d
    .select({
      analysisId: jobAnalysis.id,
      location: scrapeResults.location,
      estimatedSalaryMin: jobAnalysis.estimatedSalaryMin,
      estimatedSalaryMax: jobAnalysis.estimatedSalaryMax,
    })
    .from(jobAnalysis)
    .innerJoin(scrapeResults, sql`${jobAnalysis.scrapeResultId} = ${scrapeResults.id}`)
    .all();

  console.log(`Found ${rows.length} analysis rows to process`);

  let updated = 0;
  let skippedNoSalary = 0;
  let skippedNoState = 0;
  let skippedAlreadySet = 0;

  for (const row of rows) {
    // Skip if already has adjusted values
    const existing = d
      .select({ adjMin: jobAnalysis.adjustedSalaryMin })
      .from(jobAnalysis)
      .where(sql`${jobAnalysis.id} = ${row.analysisId}`)
      .get();
    if (existing?.adjMin != null) {
      skippedAlreadySet++;
      continue;
    }

    // Skip if no salary to adjust
    if (row.estimatedSalaryMin == null) {
      skippedNoSalary++;
      continue;
    }

    const state = extractState(row.location);
    if (!state || !STATE_COL[state]) {
      skippedNoState++;
      // For unknown states, set adjusted = estimated (no adjustment)
      d.update(jobAnalysis)
        .set({
          adjustedSalaryMin: row.estimatedSalaryMin,
          adjustedSalaryMax: row.estimatedSalaryMax,
          colIndex: null,
        })
        .where(sql`${jobAnalysis.id} = ${row.analysisId}`)
        .run();
      updated++;
      continue;
    }

    const colIndex = STATE_COL[state];
    const factor = 91 / colIndex;
    const adjMin = Math.round((row.estimatedSalaryMin ?? 0) * factor);
    const adjMax = row.estimatedSalaryMax != null
      ? Math.round(row.estimatedSalaryMax * factor)
      : null;

    d.update(jobAnalysis)
      .set({
        adjustedSalaryMin: adjMin,
        adjustedSalaryMax: adjMax,
        colIndex,
      })
      .where(sql`${jobAnalysis.id} = ${row.analysisId}`)
      .run();
    updated++;
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (no salary): ${skippedNoSalary}`);
  console.log(`  Skipped (no state found): ${skippedNoState}`);
  console.log(`  Skipped (already set): ${skippedAlreadySet}`);

  // Show some examples
  console.log(`\nSample adjustments:`);
  const samples = d
    .select({
      role: scrapeResults.role,
      location: scrapeResults.location,
      estMin: jobAnalysis.estimatedSalaryMin,
      adjMin: jobAnalysis.adjustedSalaryMin,
      colIndex: jobAnalysis.colIndex,
    })
    .from(jobAnalysis)
    .innerJoin(scrapeResults, sql`${jobAnalysis.scrapeResultId} = ${scrapeResults.id}`)
    .where(sql`${jobAnalysis.colIndex} IS NOT NULL AND ${jobAnalysis.colIndex} != 91`)
    .limit(10)
    .all();

  for (const s of samples) {
    console.log(`  ${s.role} (${s.location}): $${s.estMin?.toLocaleString()} → $${s.adjMin?.toLocaleString()} (COL ${s.colIndex})`);
  }
}

main();
