const ADDRESS_PATTERN =
  /^[^\s@<>,;:"\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const MAX_ADDRESS_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 78;

export function isEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_LENGTH) return false;
  return ADDRESS_PATTERN.test(trimmed);
}

export function normalizeEmailAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!isEmailAddress(trimmed)) return null;
  const at = trimmed.lastIndexOf("@");
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

export function parseEmailList(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(/[,;\n]/);
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const candidate of raw) {
    const normalized = normalizeEmailAddress(candidate);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(normalized);
  }

  return addresses;
}

export function invalidEmailEntries(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(/[,;\n]/);
  return raw
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !isEmailAddress(entry));
}

export function sanitizeDisplayName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["\\<>,;:@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
}

export function formatFromHeader(displayName: string | null | undefined, address: string): string {
  const safeName = sanitizeDisplayName(displayName);
  if (!safeName) return address;
  return `${safeName} <${address}>`;
}

export function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return "?";
  if (parts.length === 1) return (first[0] ?? "?").toUpperCase();
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}
