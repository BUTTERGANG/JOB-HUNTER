import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import Papa from "papaparse";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { saveGovScrapeRun } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";

const exec = promisify(execFile);

export const maxDuration = 300;

interface GovJob {
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  url: string | null;
  description: string | null;
}

async function POST_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();

  // Validate inputs
  const rawKeyword = body.keyword;
  const rawLocation = body.location;
  if (typeof rawKeyword !== "string" || typeof rawLocation !== "string") {
    return Response.json(
      { error: "keyword and location must be strings" },
      { status: 400 }
    );
  }

  const keyword = rawKeyword.trim().slice(0, 200);
  const location = rawLocation.trim().slice(0, 200);

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outPath = join(tmpdir(), `indiana_jobs_${id}.csv`);
  const scriptPath = resolve(process.cwd(), "scripts/scrape_indiana.py");

  let stderr = "";
  try {
    const r = await exec(
      "python3",
      [
        scriptPath,
        "--keyword", keyword || "",
        "--location", location || "",
        "--out", outPath,
      ],
      {
        timeout: 240_000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    stderr = r.stderr ?? "";
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    stderr = e.stderr ?? "";
    const msg = err instanceof Error ? err.message : String(err);

    // Check if it's a Playwright not installed error
    if (msg.includes("playwright not installed") || stderr.includes("playwright not installed")) {
      return Response.json(
        { error: "Playwright is not installed. Run: pip install playwright && playwright install chromium" },
        { status: 500 }
      );
    }

    return Response.json(
      { error: `Scrape failed: ${msg}` },
      { status: 500 }
    );
  }

  // Parse CSV output
  let csv: string;
  try {
    csv = await readFile(outPath, "utf-8");
    await unlink(outPath).catch(() => {});
  } catch {
    return Response.json(
      { error: "Scraper produced no output file" },
      { status: 500 }
    );
  }

  const { data } = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  const jobs: GovJob[] = data.map((row) => ({
    title: row["Title"] || "",
    company: row["Company"] || "State of Indiana",
    location: row["Location"] || null,
    salary: row["Salary"] || null,
    datePosted: row["Date Posted"] || null,
    url: row["Job URL"] || null,
    description: row["Description"] || null,
  })).filter((j) => j.title);

  // Save to DB
  let saveWarning: string | undefined;
  try {
    saveGovScrapeRun(
      keyword || "",
      location || "",
      jobs.map((j) => ({
        title: j.title,
        company: j.company,
        location: j.location,
        salary: j.salary,
        datePosted: j.datePosted,
        url: j.url,
        description: j.description,
      }))
    );
  } catch (e) {
    // The scrape succeeded but persistence failed — surface it instead of
    // reporting a clean success while silently dropping the run.
    console.error("saveGovScrapeRun failed:", e);
    saveWarning =
      "Postings were scraped but could not be saved — this run won't appear in history.";
  }

  return Response.json({ jobs, count: jobs.length, saveWarning }, { headers: rateLimit.headers });
}

export const POST = POST_handler;
