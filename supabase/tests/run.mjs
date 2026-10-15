#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..", "..");

const filters = process.argv.slice(2);

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.sql"))
  .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
  .sort()
  .map((name) => path.join(testsDir, name));

if (files.length === 0) {
  console.error(
    filters.length > 0
      ? `No test files in supabase/tests/ matching: ${filters.join(", ")}`
      : "No *.test.sql files found in supabase/tests/",
  );
  process.exit(1);
}

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
const mode = dbUrl ? "psql" : "supabase-cli";

function runWithPsql(file) {
  const result = spawnSync(
    "psql",
    [dbUrl, "-X", "-q", "-A", "-t", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-f", file],
    { encoding: "utf8" },
  );
  if (result.error) {
    return {
      failed: true,
      output: "",
      error: `psql could not be started: ${result.error.message}`,
    };
  }
  return {
    failed: result.status !== 0,
    output: result.stdout ?? "",
    error: result.status !== 0 ? (result.stderr ?? "").trim() : "",
  };
}

function extractJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function runWithSupabaseCli(file) {
  const result = spawnSync(
    "supabase",
    ["db", "query", "--linked", "--workdir", repoRoot, "-o", "json", "-f", file],
    { encoding: "utf8" },
  );
  if (result.error) {
    return {
      failed: true,
      output: "",
      error: `supabase CLI could not be started: ${result.error.message}`,
    };
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    return { failed: true, output: "", error: `${stdout}\n${stderr}`.trim() };
  }
  const parsed = extractJson(stdout);
  if (!parsed || !Array.isArray(parsed.rows)) {
    return {
      failed: true,
      output: "",
      error: `Could not read a result set from the Supabase CLI.\n${stdout}\n${stderr}`.trim(),
    };
  }
  const output = parsed.rows
    .map((row) => Object.values(row)[0])
    .filter((value) => typeof value === "string")
    .join("\n");
  return { failed: false, output, error: "" };
}

function parseTap(output) {
  const lines = output.split("\n");
  const topLevel = lines.filter((line) => line.length > 0 && !/^\s/.test(line));
  const passed = topLevel.filter((line) => /^ok\b/.test(line)).length;
  const failed = topLevel.filter((line) => /^not ok\b/.test(line)).length;
  const planLine = topLevel.find((line) => /^1\.\.\d+$/.test(line));
  const planned = planLine ? Number(planLine.slice(3)) : null;
  const assertions = lines.filter((line) => /^\s+(not )?ok\b/.test(line)).length;
  const assertionFailures = lines.filter((line) => /^\s+not ok\b/.test(line)).length;
  return { passed, failed, planned, assertions, assertionFailures };
}

console.log(
  mode === "psql"
    ? "L4 (pgTAP) — running via psql against SUPABASE_DB_URL"
    : "L4 (pgTAP) — running via `supabase db query --linked` (set SUPABASE_DB_URL to use psql instead)",
);
console.log("");

let anyFailure = false;
let totalAssertions = 0;
let totalAssertionFailures = 0;

for (const file of files) {
  const name = path.basename(file);
  const run = mode === "psql" ? runWithPsql(file) : runWithSupabaseCli(file);

  console.log(`# ${name}`);

  if (run.failed) {
    anyFailure = true;
    console.log(run.output.trimEnd());
    console.error(run.error || "The test file did not run.");
    console.log(`not ok — ${name} did not run to completion`);
    console.log("");
    continue;
  }

  console.log(run.output.trimEnd());

  const tap = parseTap(run.output);
  totalAssertions += tap.assertions;
  totalAssertionFailures += tap.assertionFailures;

  const problems = [];
  if (tap.failed > 0) problems.push(`${tap.failed} test function(s) failed`);
  if (tap.passed + tap.failed === 0) problems.push("no tests were executed");
  if (tap.planned === null) problems.push("no TAP plan line was emitted");
  else if (tap.planned !== tap.passed + tap.failed) {
    problems.push(`planned ${tap.planned} tests but ran ${tap.passed + tap.failed}`);
  }

  if (problems.length > 0) {
    anyFailure = true;
    console.error(`FAIL ${name}: ${problems.join("; ")}`);
  }

  console.log("");
}

console.log(
  `${files.length} file(s), ${totalAssertions} assertion(s), ${totalAssertionFailures} failure(s)`,
);

if (anyFailure) {
  console.error("L4 database tests FAILED");
  process.exit(1);
}

console.log("L4 database tests passed");
