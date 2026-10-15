"use client";

import { useState } from "react";

import { Avatar } from "@/components/atoms/avatar";
import { Button } from "@/components/atoms/button";
import { Card } from "@/components/atoms/card";
import { PlusIcon } from "@/components/atoms/icons";
import { ErrorAlert } from "@/components/molecules/error-alert";
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  SectionHeading,
} from "@/components/organisms/settings/section-parts";
import { AddUserDialog } from "@/components/organisms/settings/add-user-dialog";
import { useTeamMembers } from "@/hooks/use-settings";
import { apiErrorMessage } from "@/utilities/api-error";
import type { TeamMember } from "@/types/api";

// Phase 1 has no roles, so adding someone is handing them everything. Said on
// the page, not buried in a tooltip.
export const SHARED_ACCESS_NOTE =
  "Everyone you add can do everything you can, including adding more users. You set their password here and share it with them directly.";

function displayName(member: TeamMember): string {
  return member.fullName?.trim() || member.email;
}

function UserRow({ member }: { member: TeamMember }) {
  return (
    <div className="grid min-h-[52px] grid-cols-[2fr_2fr] items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={displayName(member)} size={28} />
        <span className="truncate text-[13px] font-medium text-slate-900">
          {displayName(member)}
        </span>
      </div>
      <div className="truncate text-xs text-slate-600">{member.email}</div>
    </div>
  );
}

export function UsersSection() {
  const { data, isPending, isError, error, refetch, isFetching } = useTeamMembers();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <SectionHeading
        title="Users"
        description="Everyone on the team shares the same access. There are no roles in Phase 1."
        action={
          <Button
            variant="primary"
            leadingIcon={<PlusIcon size={14} />}
            className="h-[34px] rounded-lg"
            onClick={() => setAdding(true)}
          >
            Add user
          </Button>
        }
      />

      <InfoNote className="mb-3.5">{SHARED_ACCESS_NOTE}</InfoNote>

      {/* Mounted only while open, so each new user starts from an empty form. */}
      {adding && <AddUserDialog onClose={() => setAdding(false)} />}

      {isPending && <LoadingBlock rows={4} />}

      {isError && (
        <ErrorAlert
          title="Could not load the team"
          message={apiErrorMessage(error, "Something went wrong reading the user list.")}
        />
      )}

      {isError && (
        <Button className="mt-3" loading={isFetching} onClick={() => refetch()}>
          Try again
        </Button>
      )}

      {!isPending && !isError && data.length === 0 && (
        <EmptyState
          title="No users yet"
          message="Nobody has been added yet. Use Add user to create the first account."
        />
      )}

      {!isPending && !isError && data.length > 0 && (
        <Card className="overflow-hidden">
          <div className="grid h-9 grid-cols-[2fr_2fr] items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 font-mono text-[10px] uppercase tracking-[0.06em] text-slate-500">
            <div>Name</div>
            <div>Email</div>
          </div>
          {data.map((member) => (
            <UserRow key={member.id} member={member} />
          ))}
        </Card>
      )}
    </>
  );
}
