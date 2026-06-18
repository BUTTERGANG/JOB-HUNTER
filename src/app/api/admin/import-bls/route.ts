import { execFile } from "child_process";
import { promisify } from "util";
import { resolve } from "path";
import { getBLSStatus } from "@/lib/db/queries";

export const maxDuration = 300;

const exec = promisify(execFile);

export async function GET() {
  const status = getBLSStatus();
  return Response.json(status);
}

export async function POST() {
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
          return Response.json({ success: true, count: result.count, year: result.year });
        }
        return Response.json({ error: result.error }, { status: 500 });
      }
    }

    return Response.json(
      { error: "Unexpected script output", log: stdout.slice(-500) },
      { status: 500 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Import failed: ${msg}` }, { status: 500 });
  }
}
