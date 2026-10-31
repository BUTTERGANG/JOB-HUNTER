/**
 * Resolve the Python interpreter the scraper scripts run under.
 *
 * The scrape stage shells out to Python, and it used to hardcode `python3` —
 * which on macOS is the system interpreter (3.9) that has no `python-jobspy`
 * installed. The failure mode was silent: `execFile` exited non-zero, the CSV
 * was never written, and every scrape reported "Scraper produced no output file"
 * with 0 results, which looks like a blocked site rather than a missing module.
 *
 * Resolution order (first hit wins):
 *   1. `SCRAPE_PYTHON_BIN` environment variable
 *   2. the `python_bin` setting (set from Settings or the API)
 *   3. a project-local virtualenv: `.venv/bin/python3`, then `venv/bin/python3`
 *   4. `python3` on PATH
 *
 * A project-local `.venv` is the intended default: create it once with
 * `python3 -m venv --copies .venv && .venv/bin/pip install python-jobspy` and every
 * scrape picks it up with no configuration.
 *
 * NOTE the `--copies`. A default `python -m venv` creates `bin/python` as a symlink
 * to an interpreter outside the project, and Turbopack panics on it during
 * `next build` ("symlink target leaves the filesystem root"), breaking the build.
 * `--copies` puts real binaries in place. A venv kept outside the repo works too —
 * point `python_bin` (or `SCRAPE_PYTHON_BIN`) at it.
 */

import fs from "fs";
import path from "path";
import { getSetting } from "@/lib/db/queries";

const VENV_CANDIDATES = [".venv", "venv"];

export interface PythonResolution {
  /** The command to exec. */
  bin: string;
  /** Where it came from, for diagnostics. */
  source: "env" | "setting" | "venv" | "path";
  /** True when the interpreter can import the scraper's dependencies. */
  hasJobspy: boolean | null;
}

/** Cheap synchronous check that a candidate path is an executable file. */
function isExecutable(p: string): boolean {
  // Every caller passes a resolved interpreter path, not a bundled asset.
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolvePythonBin(): PythonResolution {
  const fromEnv = (process.env.SCRAPE_PYTHON_BIN || "").trim();
  if (fromEnv && isExecutable(fromEnv)) {
    return { bin: fromEnv, source: "env", hasJobspy: null };
  }

  const fromSetting = (getSetting("python_bin") || "").trim();
  if (fromSetting && isExecutable(fromSetting)) {
    return { bin: fromSetting, source: "setting", hasJobspy: null };
  }

  for (const dir of VENV_CANDIDATES) {
    for (const rel of [path.join("bin", "python3"), path.join("bin", "python")]) {
      // turbopackIgnore: `dir` is dynamic, and without this the bundler cannot see where
      // the read lands, so it traces the ENTIRE project (public folder included) into the
      // server output. This is a local filesystem lookup for an interpreter, nothing to do
      // with the bundle.
      const candidate = path.resolve(/* turbopackIgnore: true */ process.cwd(), dir, rel);
      if (isExecutable(candidate)) {
        return { bin: candidate, source: "venv", hasJobspy: null };
      }
    }
  }

  return { bin: "python3", source: "path", hasJobspy: null };
}

/**
 * Verify the resolved interpreter can actually import what the scrapers need.
 * Returns a human-readable problem, or null when everything is importable.
 *
 * Callers use this to turn "0 results" into an actionable message.
 */
export async function checkPythonDependencies(
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
  needs: ("jobspy" | "playwright")[] = ["jobspy"]
): Promise<string | null> {
  const { bin, source } = resolvePythonBin();
  const modules = needs.map((m) => (m === "jobspy" ? "jobspy" : "playwright")).join(", ");
  const where = `${bin}${source === "path" ? ", from PATH" : `, from ${source}`}`;

  // Check the interpreter RUNS before checking what it can import.
  //
  // A virtualenv built from a Homebrew Python links the framework by FULL version path
  // (/opt/homebrew/Cellar/python@3.11/3.11.17_1/...). When `brew upgrade` moves python to
  // 3.11.18 that path disappears, the binary aborts with "Library not loaded", and the only
  // symptom is a failed import — so the old message said "install jobspy" and sent you to
  // reinstall a package that was never the problem. Distinguishing the two cases matters
  // because this recurs on every Homebrew Python upgrade.
  try {
    await exec(bin, ["-c", "pass"]);
  } catch (e) {
    const detail = e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ").trim() : "unknown error";
    return (
      `The scraper's Python interpreter will not even run (${where}).\n` +
      `This usually means Homebrew upgraded Python and the virtualenv still points at the old\n` +
      `framework path, so the binary aborts with "Library not loaded". Rebuild it against the\n` +
      `current interpreter:\n` +
      `  rm -rf .venv && /opt/homebrew/opt/python@3.11/bin/python3.11 -m venv --copies .venv\n` +
      `  .venv/bin/pip install python-jobspy` +
      (needs.includes("playwright") ? " playwright && .venv/bin/playwright install chromium" : "") +
      `\n(${detail})`
    );
  }

  try {
    await exec(bin, ["-c", `import ${needs.join(", ")}`]);
    return null;
  } catch (e) {
    const detail = e instanceof Error ? e.message.split("\n")[0] : "unknown error";
    return (
      `The scraper's Python interpreter (${where}) cannot import ${modules}. ` +
      `The interpreter runs, so this is a missing package rather than a broken virtualenv:\n` +
      `  python3 -m venv --copies .venv && .venv/bin/pip install python-jobspy` +
      (needs.includes("playwright") ? " playwright && .venv/bin/playwright install chromium" : "") +
      `\n(${detail})`
    );
  }
}
