// Prints a password-reset link for testing, without sending an email (so the
// Supabase email rate limit does not apply). Uses the service role key from
// frontend/.env; the key itself is never printed.
//
//   node scripts/recovery-link.mjs you@example.com [http://localhost:3000]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, base = "http://localhost:3000"] = process.argv.slice(2);
if (!email) {
  console.error("Usage: node scripts/recovery-link.mjs <email> [base url]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email });
if (error) {
  console.error(error.message);
  process.exit(1);
}

const params = new URLSearchParams({
  token_hash: data.properties.hashed_token,
  type: "recovery",
  next: "/reset-password",
});
console.log(`${base}/auth/confirm?${params}`);
