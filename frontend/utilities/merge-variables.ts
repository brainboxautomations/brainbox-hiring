export const MERGE_GROUPS = ["candidate", "position", "company", "sender", "custom"] as const;

export type MergeGroup = (typeof MERGE_GROUPS)[number];

export type MergeVariableField = {
  field: string;
  label: string;
};

export type MergeVariableGroup = {
  group: MergeGroup;
  label: string;
  fields: MergeVariableField[];
};

export const MERGE_VARIABLE_CATALOG: MergeVariableGroup[] = [
  {
    group: "candidate",
    label: "CANDIDATE",
    fields: [
      { field: "first_name", label: "First name" },
      { field: "last_name", label: "Last name" },
      { field: "full_name", label: "Full name" },
      { field: "email", label: "Email" },
      { field: "phone", label: "Phone" },
    ],
  },
  {
    group: "position",
    label: "POSITION",
    fields: [
      { field: "title", label: "Title" },
      { field: "location", label: "Location" },
      { field: "department", label: "Department" },
      { field: "salary_range", label: "Salary range" },
    ],
  },
  {
    group: "company",
    label: "COMPANY",
    fields: [
      { field: "name", label: "Name" },
      { field: "careers_url", label: "Careers URL" },
    ],
  },
  {
    group: "sender",
    label: "SENDER",
    fields: [{ field: "name", label: "Sender name" }],
  },
];

const CATALOG_FALLBACKS: Record<string, string> = {
  "candidate.first_name": "there",
  "candidate.full_name": "there",
};

export type MergeContext = {
  candidate: Record<string, string | null | undefined>;
  position: Record<string, string | null | undefined>;
  company: Record<string, string | null | undefined>;
  sender: Record<string, string | null | undefined>;
  custom: Record<string, string | null | undefined>;
};

export const EMPTY_MERGE_CONTEXT: MergeContext = {
  candidate: {},
  position: {},
  company: {},
  sender: {},
  custom: {},
};

export type MergeCandidate = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customAttributes?: Record<string, string> | null;
};

export type MergeLocation = { country: string; detail?: string | null };

export type MergePosition = {
  title?: string | null;
  department?: string | null;
  locations?: MergeLocation[] | null;
  remoteFlag?: boolean | null;
  salaryFrom?: number | null;
  salaryTo?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
};

export type MergeCompany = {
  name?: string | null;
  careersUrl?: string | null;
};

export function formatMergeLocation(position: MergePosition): string {
  const parts = (position.locations ?? [])
    .map((location) => {
      const country = (location.country ?? "").trim();
      const detail = (location.detail ?? "").trim();
      if (country && detail) return `${detail}, ${country}`;
      return detail || country;
    })
    .filter((part) => part.length > 0);

  if (position.remoteFlag) parts.push("Remote");

  return [...new Set(parts)].join(" · ");
}

// Salaries are quoted in PKR only. Any other stored code (an older position)
// still renders, as "3,000 USD", so an email never shows a bare number.
const CURRENCY_SYMBOLS: Record<string, string> = {
  // Spaced: "Rs 150,000", not "Rs150,000".
  PKR: "Rs ",
};

function formatAmount(amount: number, currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  const rendered = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(amount);
  if (symbol) return `${symbol}${rendered}`;
  return code ? `${rendered} ${code}` : rendered;
}

export function formatMergeSalaryRange(position: MergePosition): string {
  const { salaryFrom, salaryTo, salaryCurrency, salaryPeriod } = position;
  const hasFrom = typeof salaryFrom === "number" && Number.isFinite(salaryFrom);
  const hasTo = typeof salaryTo === "number" && Number.isFinite(salaryTo);
  if (!hasFrom && !hasTo) return "";

  const period =
    salaryPeriod === "month" ? " per month" : salaryPeriod === "year" ? " per year" : "";

  if (hasFrom && hasTo) {
    if (salaryFrom === salaryTo) return `${formatAmount(salaryFrom, salaryCurrency)}${period}`;
    return `${formatAmount(salaryFrom, salaryCurrency)}–${formatAmount(salaryTo, salaryCurrency)}${period}`;
  }

  const single = hasFrom ? salaryFrom : (salaryTo as number);
  const prefix = hasFrom ? "From " : "Up to ";
  return `${prefix}${formatAmount(single, salaryCurrency)}${period}`;
}

export function buildMergeContext(input: {
  candidate?: MergeCandidate | null;
  position?: MergePosition | null;
  company?: MergeCompany | null;
  senderName?: string | null;
}): MergeContext {
  const candidate = input.candidate ?? {};
  const position = input.position ?? {};
  const company = input.company ?? {};

  const firstName = (candidate.firstName ?? "").trim();
  const lastName = (candidate.lastName ?? "").trim();

  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate.customAttributes ?? {})) {
    if (typeof value === "string") custom[key.trim().toLowerCase()] = value;
  }

  return {
    candidate: {
      first_name: firstName,
      last_name: lastName,
      full_name: [firstName, lastName].filter(Boolean).join(" "),
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
    },
    position: {
      title: position.title ?? "",
      location: formatMergeLocation(position),
      department: position.department ?? "",
      salary_range: formatMergeSalaryRange(position),
    },
    company: {
      name: company.name ?? "",
      careers_url: company.careersUrl ?? "",
    },
    sender: {
      name: input.senderName ?? "",
    },
    custom,
  };
}

const TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g;

function isMergeGroup(value: string): value is MergeGroup {
  return (MERGE_GROUPS as readonly string[]).includes(value);
}

function catalogHasField(group: MergeGroup, field: string): boolean {
  if (group === "custom") return true;
  const entry = MERGE_VARIABLE_CATALOG.find((g) => g.group === group);
  return Boolean(entry?.fields.some((f) => f.field === field));
}

function lookup(context: MergeContext, group: MergeGroup, field: string): string {
  const value = context[group]?.[field];
  return typeof value === "string" ? value.trim() : "";
}

function resolveToken(inner: string, context: MergeContext): string {
  const separator = inner.indexOf("|");
  const rawPath = (separator === -1 ? inner : inner.slice(0, separator)).trim().toLowerCase();
  const inlineFallback = separator === -1 ? null : inner.slice(separator + 1).trim();

  const segments = rawPath.split(".");
  if (segments.length !== 2) return inlineFallback ?? "";

  const [group, field] = segments;
  if (!group || !field || !isMergeGroup(group)) return inlineFallback ?? "";
  if (!catalogHasField(group, field)) return inlineFallback ?? "";

  const value = lookup(context, group, field);
  if (value) return value;

  if (inlineFallback !== null) return inlineFallback;
  return CATALOG_FALLBACKS[`${group}.${field}`] ?? "";
}

export function resolveMergeVariables(template: string | null | undefined, context: MergeContext) {
  if (!template) return "";
  return template.replace(TOKEN_PATTERN, (_match, inner: string) => resolveToken(inner, context));
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function mergeTokenFor(group: MergeGroup, field: string): string {
  return `{{${group}.${field}}}`;
}

/**
 * Tokens in `template` that would resolve to nothing. Pass `groups` to judge
 * only those groups, for a caller whose context holds real values for some
 * groups but not others (the composer has the candidate, while company and
 * sender are only filled in on the server).
 */
export function unresolvableMergeTokens(
  template: string | null | undefined,
  context: MergeContext,
  groups?: readonly MergeGroup[],
): string[] {
  if (!template) return [];
  const blank = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const inner = match[1] ?? "";
    const separator = inner.indexOf("|");
    const path = (separator === -1 ? inner : inner.slice(0, separator)).trim().toLowerCase();
    const group = path.slice(0, path.indexOf("."));
    if (groups && isMergeGroup(group) && !groups.includes(group)) continue;
    if (resolveToken(inner, context) !== "") continue;
    blank.add(path || match[0]);
  }
  return [...blank];
}
