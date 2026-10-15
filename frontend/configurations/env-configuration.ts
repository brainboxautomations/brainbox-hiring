import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),

  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .default("/api")
    .transform((v) => v || "/api"),

  // Cloudflare Turnstile. Blank means no captcha is shown; the server then
  // skips verification too, so both keys must be set together.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z
    .string()
    .default("")
    .transform((v) => v.trim()),
});

const parsed = schema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;

const optional = z
  .string()
  .default("")
  .transform((v) => v.trim());

const optionalEmail = (message: string) =>
  optional.pipe(z.union([z.literal(""), z.email(message)]));

const optionalWebUrl = (message: string) =>
  optional.pipe(z.union([z.literal(""), z.url({ protocol: /^https?$/, error: message })]));

const optionalWebUrlOrPath = (message: string) =>
  optional.pipe(
    z.union(
      [z.literal(""), z.url({ protocol: /^https?$/ }), z.string().regex(/^\/(?![/\\])[^\s\\]+$/)],
      { error: message },
    ),
  );

const serverSchema = z.object({
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required to send email"),
  EMAIL_RELAY_ADDRESS: optionalEmail("EMAIL_RELAY_ADDRESS must be a valid email address"),

  RESEND_WEBHOOK_SECRET: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  AUTOMATION_WORKER_SECRET: optional,
  APP_BASE_URL: optional,
  TURNSTILE_SECRET_KEY: optional,

  // Cloudflare R2 holds every uploaded file (resumes, videos, attachments).
  // Blank means file storage is unavailable; the routes that need it say so.
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let serverEnvCache: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (serverEnvCache) return serverEnvCache;

  const result = serverSchema.safeParse({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_RELAY_ADDRESS: process.env.EMAIL_RELAY_ADDRESS,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    AUTOMATION_WORKER_SECRET: process.env.AUTOMATION_WORKER_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }

  serverEnvCache = result.data;
  return serverEnvCache;
}

const companySchema = z.object({
  COMPANY_NAME: optional,
  COMPANY_WEBSITE_URL: optionalWebUrl("COMPANY_WEBSITE_URL must be an http(s) URL"),
  COMPANY_LOGO_URL: optionalWebUrlOrPath(
    "COMPANY_LOGO_URL must be an http(s) URL or a path starting with /",
  ),
  COMPANY_CAREERS_URL: optionalWebUrl("COMPANY_CAREERS_URL must be an http(s) URL"),
});

export type CompanyEnv = z.infer<typeof companySchema>;

let companyEnvCache: CompanyEnv | null = null;

export function companyEnv(): CompanyEnv {
  if (companyEnvCache) return companyEnvCache;

  const result = companySchema.safeParse({
    COMPANY_NAME: process.env.COMPANY_NAME,
    COMPANY_WEBSITE_URL: process.env.COMPANY_WEBSITE_URL,
    COMPANY_LOGO_URL: process.env.COMPANY_LOGO_URL,
    COMPANY_CAREERS_URL: process.env.COMPANY_CAREERS_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid company environment variables:\n${issues}`);
  }

  companyEnvCache = result.data;
  return companyEnvCache;
}
