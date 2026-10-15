"use client";

import { useState } from "react";

import { Button } from "@/components/atoms/button";
import { Field, Input } from "@/components/atoms/input";
import { Select } from "@/components/atoms/select";
import { PlusIcon } from "@/components/atoms/icons";
import { useCreateDepartment, useDepartments } from "@/hooks/use-departments";
import { departmentInputSchema } from "@/schemas/department-schema";
import { apiErrorMessage } from "@/utilities/api-error";

import { departmentChoices } from "./position-form-values";

type DepartmentFieldProps = {
  value: string;
  onChange: (department: string) => void;
};

/**
 * Department select backed by the team's list, with a way to add a missing
 * department without leaving the form.
 */
export function DepartmentField({ value, onChange }: DepartmentFieldProps) {
  const { data: departments = [], isLoading } = useDepartments();
  const createDepartment = useCreateDepartment();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const choices = departmentChoices(
    departments.map((department) => department.name),
    value,
  );

  function closeAdd() {
    setAdding(false);
    setDraft("");
    setError(null);
  }

  async function addDepartment() {
    const parsed = departmentInputSchema.safeParse({ name: draft });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a department name");
      return;
    }
    try {
      const created = await createDepartment.mutateAsync(parsed.data);
      onChange(created.name);
      closeAdd();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not add the department."));
    }
  }

  return (
    <Field label="Department" htmlFor="department" error={error ?? undefined}>
      <Select
        id="department"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        options={[
          { value: "", label: isLoading ? "Loading departments…" : "Select a department…" },
          ...choices.map((name) => ({ value: name, label: name })),
        ]}
      />

      {adding ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            aria-label="New department name"
            value={draft}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addDepartment();
              }
              if (e.key === "Escape") closeAdd();
            }}
            placeholder="e.g. Finance"
            invalid={Boolean(error)}
          />
          <Button
            type="button"
            variant="primary"
            loading={createDepartment.isPending}
            onClick={() => void addDepartment()}
          >
            Add
          </Button>
          <Button type="button" onClick={closeAdd}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-11 hover:underline"
        >
          <PlusIcon size={12} />
          Add department
        </button>
      )}
    </Field>
  );
}
