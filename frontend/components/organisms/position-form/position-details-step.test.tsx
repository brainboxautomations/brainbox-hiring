import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SALARY_RANGE_MESSAGE } from "@/schemas/position-schema";
import { PositionDetailsStep } from "./position-details-step";
import {
  createPositionFormValues,
  departmentChoices,
  type PositionFormValues,
} from "./position-form-values";

vi.mock("@/hooks/use-departments", () => ({
  useDepartments: () => ({
    data: ["Engineering", "Sales", "Design", "Marketing", "Operations"].map((name) => ({
      id: name,
      name,
    })),
    isLoading: false,
  }),
  useCreateDepartment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderStep(overrides: Partial<PositionFormValues> = {}) {
  const values = { ...createPositionFormValues(), ...overrides };
  render(<PositionDetailsStep values={values} onChange={vi.fn()} />);
}

describe("departmentChoices", () => {
  const listed = ["Engineering", "Sales"];

  it("offers the team's list as it is", () => {
    expect(departmentChoices(listed, "")).toEqual(listed);
    expect(departmentChoices(listed, "Sales")).toEqual(listed);
  });

  it("does not add a second copy that differs only in case", () => {
    expect(departmentChoices(listed, "sales")).toEqual(listed);
  });

  // An older position whose department was later removed from the list would
  // otherwise show as unset and save as blank.
  it("keeps a position's own department after it leaves the list", () => {
    expect(departmentChoices(listed, "Success")).toEqual([...listed, "Success"]);
  });
});

describe("PositionDetailsStep department", () => {
  it("lists the team's departments, not a fixed set", () => {
    renderStep();
    expect(screen.getByRole("option", { name: "Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Success" })).not.toBeInTheDocument();
  });
});

describe("PositionDetailsStep salary range", () => {
  it("warns when the minimum is above the maximum", () => {
    renderStep({ salaryFrom: "200000", salaryTo: "50000" });

    expect(screen.getByText(SALARY_RANGE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText("Salary from")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Salary to")).toHaveAttribute("aria-invalid", "true");
  });

  it("stays quiet for a valid range", () => {
    renderStep({ salaryFrom: "50000", salaryTo: "200000" });

    expect(screen.queryByText(SALARY_RANGE_MESSAGE)).not.toBeInTheDocument();
  });

  it("stays quiet while only one bound has been typed", () => {
    renderStep({ salaryFrom: "200000", salaryTo: "" });

    expect(screen.queryByText(SALARY_RANGE_MESSAGE)).not.toBeInTheDocument();
  });
});
