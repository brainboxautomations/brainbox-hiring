"use client";

import { EmailTimingCard } from "@/components/organisms/settings/email-timing-card";
import { InfoNote, SectionHeading } from "@/components/organisms/settings/section-parts";

export function EmailTimingSection() {
  return (
    <>
      <SectionHeading
        title="Email timing"
        description="Safety windows that let you catch a mistake before an email reaches a candidate."
      />

      <InfoNote className="mb-3.5">
        A held email shows its send time with Undo and Send now, in the candidate&apos;s thread and,
        for automations, under Upcoming automations on their profile.
      </InfoNote>

      <EmailTimingCard />
    </>
  );
}
