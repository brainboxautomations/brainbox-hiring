"use client";

import { Button } from "@/components/atoms/button";
import { Card, SectionLabel } from "@/components/atoms/card";
import { ErrorAlert } from "@/components/molecules/error-alert";
import {
  InfoNote,
  LoadingBlock,
  ReadOnlyField,
  SectionHeading,
} from "@/components/organisms/settings/section-parts";
import { useEmailSettings } from "@/hooks/use-settings";
import { apiErrorMessage } from "@/utilities/api-error";

export const EMAIL_READ_ONLY_REASON =
  "These come from the deployment's environment variables (EMAIL_RELAY_ADDRESS, COMPANY_NAME, COMPANY_CAREERS_URL). They are shown here so you can check what candidates see; changing one means changing the deployment, not this page.";

const NOT_SET = "Not set";

export function EmailSection() {
  const { data, isPending, isError, error, refetch, isFetching } = useEmailSettings();

  return (
    <>
      <SectionHeading
        title="Email"
        description="Where candidate mail is sent from and replied to. Read-only."
      />

      {isPending && <LoadingBlock rows={3} />}

      {isError && (
        <>
          <ErrorAlert
            title="Could not load the email settings"
            message={apiErrorMessage(error, "Something went wrong reading the email settings.")}
          />
          <Button className="mt-3" loading={isFetching} onClick={() => refetch()}>
            Try again
          </Button>
        </>
      )}

      {!isPending && !isError && (
        <>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <SectionLabel>Current configuration</SectionLabel>
            </div>
            <ReadOnlyField label="Relay address" value={data.relayAddress || NOT_SET} />
            <ReadOnlyField label="Company name" value={data.companyName || NOT_SET} />
            <ReadOnlyField label="Careers URL" value={data.careersUrl || NOT_SET} />
          </Card>

          <InfoNote className="mt-3.5">{EMAIL_READ_ONLY_REASON}</InfoNote>

          <InfoNote className="mt-2.5">
            Outbound mail sends through the relay address above, showing the position&apos;s sender
            name rather than a personal address. Replies come back to the same address and land in
            the inbox.
          </InfoNote>
        </>
      )}
    </>
  );
}
