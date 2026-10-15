import { NextResponse } from "next/server";

import { requireUser } from "@/app/api/_helpers";
import { companyEnv, serverEnv } from "@/configurations/env-configuration";

export async function GET() {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;

  const { EMAIL_RELAY_ADDRESS } = serverEnv();
  const { COMPANY_NAME, COMPANY_CAREERS_URL } = companyEnv();

  return NextResponse.json({
    email: {
      relayAddress: EMAIL_RELAY_ADDRESS,
      companyName: COMPANY_NAME,
      careersUrl: COMPANY_CAREERS_URL,
    },
  });
}
