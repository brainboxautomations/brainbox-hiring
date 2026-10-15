import { companyEnv, serverEnv } from "@/configurations/env-configuration";

import { listPublicPositions } from "./_data";
import { CareersList } from "./careers-list";

export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const positions = await listPublicPositions();
  // The relay address is the one candidates already reply to, so a note sent
  // from the empty careers page lands in the shared Inbox.
  return (
    <CareersList
      positions={positions}
      companyName={companyEnv().COMPANY_NAME}
      contactEmail={serverEnv().EMAIL_RELAY_ADDRESS}
    />
  );
}
