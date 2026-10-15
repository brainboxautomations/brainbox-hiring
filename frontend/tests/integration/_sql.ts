import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export function runSql(sql: string): void {
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  const file = path.join(mkdtempSync(path.join(tmpdir(), "l3-sql-")), "statement.sql");
  writeFileSync(file, sql, "utf8");

  const result = dbUrl
    ? spawnSync("psql", [dbUrl, "-X", "-q", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-f", file], {
        encoding: "utf8",
      })
    : spawnSync("supabase", ["db", "query", "--linked", "--workdir", REPO_ROOT, "-f", file], {
        encoding: "utf8",
      });

  if (result.error) {
    throw new Error(
      `L3 could not reach the database. ${
        dbUrl
          ? "psql is not on PATH."
          : "The Supabase CLI is not on PATH — set SUPABASE_DB_URL to use psql instead."
      } (${result.error.message})`,
    );
  }

  if (result.status !== 0) {
    throw new Error(`L3 database statement failed:\n${result.stdout}\n${result.stderr}`);
  }
}
