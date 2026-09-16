import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import { ensureDb } from "./ensure";

const DB_PATH = path.join(process.cwd(), "data", "jobhunt.db");

function getDb() {
  // Initialize the DB (create data dir + tables) on first access so a fresh
  // clone works out of the box instead of 500ing on missing tables.
  ensureDb();
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

let _db: ReturnType<typeof getDb> | null = null;

export function db() {
  if (!_db) {
    _db = getDb();
  }
  return _db;
}

export { schema };
