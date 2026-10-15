"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/atoms/button";
import { Card } from "@/components/atoms/card";
import { CloseIcon, PlusIcon } from "@/components/atoms/icons";
import { Input } from "@/components/atoms/input";
import { ErrorAlert } from "@/components/molecules/error-alert";
import {
  EmptyState,
  InfoNote,
  LoadingBlock,
  SectionHeading,
} from "@/components/organisms/settings/section-parts";
import { useCreateDepartment, useDeleteDepartment, useDepartments } from "@/hooks/use-departments";
import { departmentInputSchema } from "@/schemas/department-schema";
import { apiErrorMessage } from "@/utilities/api-error";
import type { Department } from "@/types/api";

function DepartmentRow({ department }: { department: Department }) {
  const deleteDepartment = useDeleteDepartment();

  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0">
      <span className="truncate text-[13px] font-medium text-slate-900">{department.name}</span>
      <button
        type="button"
        aria-label={`Remove ${department.name}`}
        disabled={deleteDepartment.isPending}
        onClick={() => deleteDepartment.mutate(department.id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

export function DepartmentsSection() {
  const { data, isPending, isError, error, refetch, isFetching } = useDepartments();
  const createDepartment = useCreateDepartment();
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = departmentInputSchema.safeParse({ name });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Enter a department name");
      return;
    }
    try {
      await createDepartment.mutateAsync(parsed.data);
      setName("");
      setFormError(null);
    } catch (err) {
      setFormError(apiErrorMessage(err, "Could not add the department."));
    }
  }

  return (
    <>
      <SectionHeading
        title="Departments"
        description="The departments you can pick when creating or editing a position."
      />

      <InfoNote className="mb-3.5">
        Removing a department only takes it out of this list. Positions that already use it keep it.
      </InfoNote>

      <form onSubmit={onSubmit} noValidate className="mb-3.5 flex items-start gap-2">
        <div className="flex-1">
          <Input
            aria-label="Department name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
            placeholder="e.g. Finance"
            invalid={Boolean(formError)}
          />
          {formError && <p className="mt-1.5 text-[11px] text-red-700">{formError}</p>}
        </div>
        <Button
          type="submit"
          variant="primary"
          leadingIcon={<PlusIcon size={14} />}
          loading={createDepartment.isPending}
        >
          Add department
        </Button>
      </form>

      {isPending && <LoadingBlock rows={4} />}

      {isError && (
        <ErrorAlert
          title="Could not load departments"
          message={apiErrorMessage(error, "Something went wrong reading the department list.")}
        />
      )}

      {isError && (
        <Button className="mt-3" loading={isFetching} onClick={() => refetch()}>
          Try again
        </Button>
      )}

      {!isPending && !isError && data.length === 0 && (
        <EmptyState
          title="No departments yet"
          message="Add the first one above. It will appear in the position form straight away."
        />
      )}

      {!isPending && !isError && data.length > 0 && (
        <Card className="overflow-hidden">
          {data.map((department) => (
            <DepartmentRow key={department.id} department={department} />
          ))}
        </Card>
      )}
    </>
  );
}
