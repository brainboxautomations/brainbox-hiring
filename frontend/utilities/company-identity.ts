export type CompanyIdentity = {
  name: string;
  websiteUrl: string;
  logoUrl: string;
};

export const POWERED_BY_URL = "https://www.brainboxautomations.com";

export function companyIdentityFrom(env: {
  COMPANY_NAME: string;
  COMPANY_WEBSITE_URL: string;
  COMPANY_LOGO_URL: string;
}): CompanyIdentity {
  return {
    name: env.COMPANY_NAME.trim(),
    websiteUrl: env.COMPANY_WEBSITE_URL.trim(),
    logoUrl: env.COMPANY_LOGO_URL.trim(),
  };
}

export function careersTitle(name: string): string {
  return name ? `Careers at ${name}` : "Careers";
}

export function publicTitleTemplate(name: string): string {
  return name ? `%s — ${name}` : "%s";
}

export function careersDescription(name: string): string {
  return name ? `Open roles at ${name}` : "Open roles";
}

export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
