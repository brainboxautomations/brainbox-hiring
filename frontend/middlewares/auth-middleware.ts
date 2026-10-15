import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { env } from "@/configurations/env-configuration";
import type { Database } from "@/types/database.types";

// /reset-password is left out on purpose: it needs the session that
// the email link or code creates.
const PUBLIC_PREFIXES = [
  "/admin",
  "/login",
  "/forgot-password",
  "/auth",
  "/careers",
  "/q",
] as const;

/** Sign-in pages a signed-in user is sent past. */
const SIGN_IN_PATHS = new Set(["/admin", "/login"]);

const UNAUTHENTICATED_API_PREFIXES = ["/api/webhooks/", "/api/workers/"] as const;

const LOGIN_PATH = "/admin";
const AUTHENTICATED_HOME = "/positions";

function isPublicPath(pathname: string): boolean {
  // "/" only redirects to /careers; as a prefix it would match everything.
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isUnauthenticatedApiPath(pathname: string): boolean {
  return UNAUTHENTICATED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (isUnauthenticatedApiPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return response;
  }

  const publicPath = isPublicPath(pathname);

  if (!user && !publicPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = LOGIN_PATH;
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && SIGN_IN_PATHS.has(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = AUTHENTICATED_HOME;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
