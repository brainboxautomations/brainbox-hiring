#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MAPPING = {
  API_URL: "NEXT_PUBLIC_SUPABASE_URL",
  ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  DB_URL: "SUPABASE_DB_URL",
};

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function fail(message) {
  console.error(`local-supabase-env: ${message}`);
  process.exit(1);
}

function readStatus() {
  const result = spawnSync("supabase", ["status", "-o", "env", "--workdir", repoRoot], {
    encoding: "utf8",
  });
  if (result.error) {
    fail(`the Supabase CLI is not on PATH (${result.error.message}).`);
  }
  if (result.status !== 0) {
    fail(
      "the local Supabase stack is not running. Start it with `npm run db:start` from frontend/.\n" +
        (result.stderr ?? "").trim(),
    );
  }

  const values = {};
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function localEnv() {
  const status = readStatus();
  const env = {};
  for (const [from, to] of Object.entries(MAPPING)) {
    const value = status[from]?.trim();
    if (!value) fail(`\`supabase status\` did not report ${from}.`);
    env[to] = value;
  }

  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_DB_URL"]) {
    const host = new URL(env[name]).hostname;
    if (!LOOPBACK.has(host)) fail(`${name} points at ${host}, not a local stack. Refusing.`);
  }
  return env;
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");

if (separator === -1) {
  if (args.length > 0) fail("usage: local-supabase-env.mjs [-- <command> [args...]]");
  for (const [name, value] of Object.entries(localEnv())) console.log(`${name}=${value}`);
  process.exit(0);
}

const [command, ...commandArgs] = args.slice(separator + 1);
if (!command) fail("no command after --.");

const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  env: { ...process.env, ...localEnv() },
  shell: process.platform === "win32",
});
if (result.error) fail(`could not run ${command}: ${result.error.message}`);
process.exit(result.status ?? 1);
