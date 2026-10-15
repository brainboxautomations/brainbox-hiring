import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pipeline, Position } from "@/types/api";

const harness = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: "",
  pipelines: [] as Pipeline[],
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  positionsById: new Map<string, Position>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: harness.push, replace: harness.replace }),
  // The wizard reads the current step from the URL so a refresh returns to it.
  useSearchParams: () => new URLSearchParams(harness.searchParams),
}));

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

vi.mock("@/hooks/use-pipelines", () => ({
  usePipelines: () => ({ data: harness.pipelines, isLoading: false }),
}));

vi.mock("@/hooks/use-questionnaires", () => ({
  useQuestionnaires: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/use-positions", () => ({
  usePosition: (id: string | null) => ({
    data: id ? harness.positionsById.get(id) : undefined,
    isLoading: false,
    isError: false,
  }),
  useCreatePosition: () => ({
    mutateAsync: harness.createMutate,
    mutate: harness.createMutate,
    isPending: false,
  }),
  useUpdatePosition: () => ({
    mutateAsync: harness.updateMutate,
    mutate: harness.updateMutate,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-stage-actions", () => ({
  useStageActions: () => ({ data: [], isLoading: false, isError: false }),
  useCreateStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

const { default: NewPositionPage } = await import("./page");

const PIPELINE: Pipeline = {
  id: "pipeline-1",
  name: "Standard hiring",
  isTemplate: true,
  usageCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  stages: [
    { id: "template-stage-1", name: "Applied", sortOrder: 1 },
    { id: "template-stage-2", name: "Hired", sortOrder: 2 },
  ],
};

function makeCreatedPosition(id: string): Position {
  return {
    id,
    title: "Growth Engineer",
    slug: "growth-engineer",
    department: "",
    positionType: "Full-time",
    locations: [],
    remoteFlag: false,
    status: "draft",
    publishMode: "listed",
    candidateCount: 0,
    createdAt: "2026-02-01T00:00:00.000Z",
    educationLevel: "No requirement",
    educationLevelRequired: true,
    experienceLevel: "",
    salaryFrom: null,
    salaryTo: null,
    salaryPeriod: "year",
    salaryCurrency: "USD",
    description: "",
    applicationFormConfig: {},
    applicationQuestionnaireId: null,
    assignedPipelineId: "pipeline-1",
    emailSenderName: "Acme Talent",
    hiringTeam: [],
    // Position-owned stage ids intentionally differ from the template's
    // (template-stage-1/2) — snapshotting copies stages into new rows.
    stages: [
      { id: "position-stage-1", name: "Applied", sortOrder: 1 },
      { id: "position-stage-2", name: "Hired", sortOrder: 2 },
    ],
  };
}

async function fillTitleAndGoToPipeline(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Position title/), "Growth Engineer");
  await user.click(screen.getByRole("button", { name: "Pipeline" }));
}

beforeEach(() => {
  harness.push.mockReset();
  harness.replace.mockReset();
  harness.searchParams = "";
  // The wizard persists its answers per tab, so one test's draft would
  // otherwise pre-fill the next one's form.
  sessionStorage.clear();
  harness.pipelines = [PIPELINE];
  harness.createMutate.mockReset();
  harness.updateMutate.mockReset();
  harness.positionsById.clear();
});

describe("NewPositionPage stage actions", () => {
  it("creates the draft position once and opens the panel on the position's own stage id", async () => {
    const user = userEvent.setup();
    const created = makeCreatedPosition("position-1");
    harness.createMutate.mockImplementation(async () => {
      harness.positionsById.set(created.id, created);
      return created;
    });

    render(<NewPositionPage />);
    await fillTitleAndGoToPipeline(user);

    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[0]!);

    expect(harness.createMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Stage not found")).toBeNull();
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });

  it("reuses the same draft position on a second 'Add stage actions' click instead of creating a new one", async () => {
    const user = userEvent.setup();
    const created = makeCreatedPosition("position-1");
    harness.createMutate.mockImplementation(async () => {
      harness.positionsById.set(created.id, created);
      return created;
    });
    harness.updateMutate.mockResolvedValue(created);

    render(<NewPositionPage />);
    await fillTitleAndGoToPipeline(user);

    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[0]!);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[1]!);

    expect(harness.createMutate).toHaveBeenCalledTimes(1);
    expect(harness.updateMutate).toHaveBeenCalledTimes(1);
    expect((harness.updateMutate.mock.calls[0]![0] as { id: string }).id).toBe("position-1");
  });
});

describe("NewPositionPage details", () => {
  // The Department select used to start on "" with no matching option, so the
  // browser displayed the first real option ("Engineering") while the form
  // value stayed empty. The user never touched the field, onChange never
  // fired, and the position saved with no department at all — after Review had
  // shown them a dash and the dropdown had shown them Engineering.
  it("starts Department on a placeholder rather than silently showing the first option", async () => {
    render(<NewPositionPage />);

    const department = screen.getByLabelText("Department") as HTMLSelectElement;

    expect(department.value).toBe("");
    expect(screen.getByRole("option", { name: "Select a department…" })).toBeInTheDocument();
  });

  it("keeps the chosen department on the Review step", async () => {
    const user = userEvent.setup();
    render(<NewPositionPage />);

    await user.type(screen.getByLabelText(/Position title/), "Growth Engineer");
    await user.selectOptions(screen.getByLabelText("Department"), "Design");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("starts Experience level on a placeholder too", () => {
    render(<NewPositionPage />);

    expect((screen.getByLabelText("Experience level") as HTMLSelectElement).value).toBe("");
  });
});

describe("NewPositionPage draft persistence", () => {
  it("restores the answers and the step after a refresh", async () => {
    const user = userEvent.setup();

    const first = render(<NewPositionPage />);
    await user.type(screen.getByLabelText(/Position title/), "Growth Engineer");
    await user.selectOptions(screen.getByLabelText("Department"), "Design");
    await user.click(screen.getByRole("button", { name: "Application" }));

    // What a refresh does: the tree is thrown away, and the page is re-entered
    // at whatever the URL says. sessionStorage is what survives.
    expect(harness.replace).toHaveBeenCalledWith("/positions/new?step=application", {
      scroll: false,
    });
    first.unmount();
    harness.searchParams = "step=application";

    const user2 = userEvent.setup();
    render(<NewPositionPage />);

    // Back on the step the URL named, not step 1.
    expect(screen.getByRole("heading", { name: "Application" })).toBeInTheDocument();

    // And the answers from before the refresh are still there — the title and
    // department live on the Details step, so step back to see them.
    await user2.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText(/Position title/)).toHaveValue("Growth Engineer");
    expect(screen.getByLabelText("Department")).toHaveValue("Design");
  });

  // "Create position" links to a bare /positions/new, with no ?step=. Restoring
  // there would silently refill the form with an abandoned draft — a stale
  // title and department look exactly like fields the user just filled in, so
  // they could publish someone else's half-written role without noticing.
  it("starts empty when the wizard is opened fresh, even if a draft was left behind", async () => {
    const user = userEvent.setup();

    const first = render(<NewPositionPage />);
    await user.type(screen.getByLabelText(/Position title/), "Abandoned draft");
    await user.click(screen.getByRole("button", { name: "Application" }));
    first.unmount();

    // Opening "Create position" again: no step in the URL.
    harness.searchParams = "";
    render(<NewPositionPage />);

    expect(screen.getByLabelText(/Position title/)).toHaveValue("");
    expect(screen.getByLabelText("Department")).toHaveValue("");
  });

  it("discards the draft when the wizard is cancelled", async () => {
    const user = userEvent.setup();

    const first = render(<NewPositionPage />);
    await user.type(screen.getByLabelText(/Position title/), "Abandoned");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    first.unmount();

    render(<NewPositionPage />);

    expect(screen.getByLabelText(/Position title/)).toHaveValue("");
  });
});
