import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { getBLSStatus } from "@/lib/db/queries";
import { generalRateLimiter, getClientIdentifier } from "@/lib/rateLimit";
import { withAuth } from "@/lib/authMiddleware";

export const maxDuration = 300;

const exec = promisify(execFile);

async function GET_handler(request: NextRequest) {
  // Rate limiting
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const status = getBLSStatus();
  return Response.json(status, { headers: rateLimit.headers });
}

async function POST_handler(request: NextRequest) {
  // Rate limiting - very strict for this expensive operation
  const rateLimit = generalRateLimiter(getClientIdentifier(request));
  if (!rateLimit.allowed) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...rateLimit.headers, "Content-Type": "application/json" },
    });
  }

  const scriptPath = resolve(process.cwd(), "scripts/import_bls.py");

  try {
    const { stdout } = await exec("python3", [scriptPath], { timeout: 280_000 });

    // The last JSON line is the result
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{")) {
        const result = JSON.parse(line);
        if (result.success) {
          return Response.json({ success: true, count: result.count, year: result.year }, { headers: rateLimit.headers });
        }
        return Response.json({ error: result.error }, { status: 500, headers: rateLimit.headers });
      }
    }

    return Response.json(
      { error: "Unexpected script output", log: stdout.slice(-500) },
      { status: 500, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Import failed: ${msg}` }, { status: 500, headers: rateLimit.headers });
  }
}

export const GET = withAuth(GET_handler, "admin");
export const POST = withAuth(POST_handler, "admin");
