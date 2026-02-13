import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "schema.sql");

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const sql = readFileSync(SCHEMA_PATH, "utf-8");
  await pool.query(sql);
}
