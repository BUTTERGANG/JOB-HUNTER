/**
 * Tolerant JSON parsing for values read out of the database.
 *
 * Several columns hold JSON as text (`keywords`, `mustHave`, `progress`, …). Those values
 * are written by the app, but a single malformed row — an older schema, a hand edit, a
 * truncated write — used to take down whichever endpoint read it, because
 * `JSON.parse(analysis.keywords || "[]")` only guards against a NULL, not against rubbish.
 *
 * These helpers never throw. A bad value degrades to its fallback, which is the correct
 * behaviour for a display field: an unparseable keyword list should not 500 the job page.
 */

/** Parse a JSON value, returning `fallback` if it is missing or malformed. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Parse a JSON array of strings, dropping any non-string members. */
export function parseJsonStringArray(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

