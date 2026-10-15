import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pipeline, Position, PositionStatus } from "@/types/api";

type MutateOptions = {
  onSuccess?: (value: unknown) => void;
  onError?: (error: unknown) => void;
};

type UpdateVariables = { id: string; input: Record<string, unknown> };
type StatusVariables = { id: string; status: PositionStatus };

const harness = vi.hoisted(() => ({
  state: {
    position: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    pipelines: [] as unknown,
  },
  push: vi.fn(),
  refetch: vi.fn(),
  updateMutate: vi.fn(),
  setStatusMutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: harness.push }),
  useParams: () => ({ positionId: "position-1" }),
}));

vi.mock("@/hooks/use-positions", () => ({
  usePosition: () => ({
    data: harness.state.position,
    isLoading: harness.state.isLoading,
    isError: harness.state.isError,
    error: harness.state.error,
    refetch: harness.refetch,
  }),
  useUpdatePosition: () => ({ mutate: harness.updateMutate, isPending: false }),
  useSetPositionStatus: () => ({ mutate: harness.setStatusMutate, isPending: false }),
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
  usePipelines: () => ({ data: harness.state.pipelines }),
}));

vi.mock("@/hooks/use-questionnaires", () => ({
  useQuestionnaires: () => ({ data: [] }),
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

const { EditPositionScreen } = await import("./edit-position-screen");

const PIPELINES: Pipeline[] = [
  {
    id: "pipeline-1",
    name: "Standard hiring",
    isTemplate: true,
    usageCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    stages: [
      { id: "stage-1", name: "Applied", sortOrder: 1 },
      { id: "stage-2", name: "Hired", sortOrder: 2 },
      { id: "stage-3", name: "Rejected", sortOrder: 3 },
    ],
  },
  {
    id: "pipeline-2",
    name: "Design hiring",
    isTemplate: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    stages: [{ id: "stage-4", name: "Portfolio review", sortOrder: 1 }],
  },
];

function makePosition(status: PositionStatus): Position {
  return {
    id: "position-1",
    title: "Growth Engineer",
    slug: "growth-engineer",
    department: "Engineering",
    positionType: "Full-time",
    locations: [{ country: "United Kingdom", detail: "London" }],
    remoteFlag: true,
    status,
    publishMode: "listed",
    candidateCount: 3,
    createdAt: "2026-02-01T00:00:00.000Z",
    educationLevel: "Bachelor's degree",
    educationLevelRequired: true,
    experienceLevel: "Senior (5+ years)",
    salaryFrom: 90000,
    salaryTo: 120000,
    salaryPeriod: "year",
    salaryCurrency: "GBP",
    description: "Own the growth surface end to end.",
    applicationFormConfig: { resume: "required", phone: "optional" },
    applicationQuestionnaireId: null,
    assignedPipelineId: "pipeline-1",
    emailSenderName: "Acme Talent",
    hiringTeam: [],
    // Position-owned stage ids are deliberately different from
    // PIPELINES[0]'s template stage ids (stage-1/2/3) — snapshotting a
    // pipeline onto a position copies its stages into new rows with their
    // own ids (see snapshot_pipeline_to_position), so a real position never
    // shares stage ids with the template it was assigned from.
    stages: [
      { id: "position-stage-1", name: "Applied", sortOrder: 1 },
      { id: "position-stage-2", name: "Hired", sortOrder: 2 },
      { id: "position-stage-3", name: "Rejected", sortOrder: 3 },
    ],
  };
}

function renderScreen(status: PositionStatus) {
  harness.state.position = makePosition(status);
  return render(<EditPositionScreen positionId="position-1" />);
}

function lastUpdateInput(): Record<string, unknown> {
  const call = harness.updateMutate.mock.calls[0];
  expect(call).toBeDefined();
  return (call![0] as UpdateVariables).input;
}

beforeEach(() => {
  harness.state.position = undefined;
  harness.state.isLoading = false;
  harness.state.isError = false;
  harness.state.error = null;
  harness.state.pipelines = PIPELINES;
  harness.push.mockReset();
  harness.refetch.mockReset();
  harness.updateMutate.mockReset();
  harness.setStatusMutate.mockReset();
});

describe("EditPositionScreen loading and error states", () => {
  it("renders a loading state while the position is being fetched", () => {
    harness.state.isLoading = true;

    render(<EditPositionScreen positionId="position-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading position");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("renders an error state with a retry when the position cannot be loaded", async () => {
    const user = userEvent.setup();
    harness.state.isError = true;
    harness.state.error = new Error("Position not found");

    render(<EditPositionScreen positionId="position-1" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load this position");
    expect(alert).toHaveTextContent("Position not found");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(harness.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("EditPositionScreen pipeline freeze rule", () => {
  it("offers the pipeline control while the position is still a draft", async () => {
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));

    expect(screen.getByRole("combobox", { name: "Pipeline template" })).toBeInTheDocument();
    expect(screen.queryByText(/Stage order is frozen/)).toBeNull();
  });

  it("withholds the pipeline control and explains the freeze once the position is live", async () => {
    const user = userEvent.setup();
    renderScreen("open");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));

    expect(screen.queryByRole("combobox", { name: "Pipeline template" })).toBeNull();
    expect(
      screen.getByText(/Stage order is frozen once a position leaves draft/),
    ).toBeInTheDocument();
    expect(screen.getByText("Standard hiring")).toBeInTheDocument();
  });

  it("leaves the pipeline out of the patch on a live position so the 409 cannot happen", async () => {
    const user = userEvent.setup();
    renderScreen("open");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(harness.updateMutate).toHaveBeenCalledTimes(1);
    const input = lastUpdateInput();
    expect(input).not.toHaveProperty("assignedPipelineId");
    expect(input.title).toBe("Growth Engineer");
  });

  it("includes the pipeline in the patch on a draft position", async () => {
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(lastUpdateInput().assignedPipelineId).toBe("pipeline-1");
  });

  it("shows an empty state when no pipeline templates exist", async () => {
    const user = userEvent.setup();
    harness.state.pipelines = [];
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));

    expect(screen.getByText(/No pipeline templates exist yet/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Pipeline template" })).toBeNull();
  });
});

describe("EditPositionScreen stage actions panel", () => {
  it("opens the stage actions panel in place, without navigating away", async () => {
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));
    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[0]!);

    expect(screen.getByText("No actions yet")).toBeInTheDocument();
    expect(harness.push).not.toHaveBeenCalled();
  });

  it("resolves the position's own stage, not the pipeline template's, on a draft with an unchanged pipeline", async () => {
    // Regression: PositionPipelineStep used to be handed the pipeline
    // TEMPLATE's stages whenever the position was a draft, even when the
    // assigned pipeline had not been changed. Clicking "Add stage actions"
    // then passed a template stage id that does not exist on the position,
    // landing on "Stage not found" instead of the real panel.
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));
    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[0]!);

    expect(screen.queryByText("Stage not found")).toBeNull();
    expect(screen.getAllByText("Applied").length).toBeGreaterThan(0);
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });

  it("keeps unsaved edits intact after closing the stage actions panel", async () => {
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Details" }));
    const titleInput = screen.getByLabelText(/Position title/) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title while editing");

    await user.click(screen.getByRole("button", { name: "Pipeline" }));
    await user.click(screen.getAllByRole("button", { name: "Add stage actions" })[0]!);
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText(/Position title/)).toHaveValue("Updated title while editing");
  });
});

describe("EditPositionScreen save errors", () => {
  it("renders an error state when the update fails", async () => {
    const user = userEvent.setup();
    harness.updateMutate.mockImplementation((_variables, options?: MutateOptions) =>
      options?.onError?.(new Error("The server refused this change.")),
    );
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t save this position");
    expect(alert).toHaveTextContent("The server refused this change.");
  });

  it("translates a 409 from the API into the freeze explanation", async () => {
    const user = userEvent.setup();
    harness.updateMutate.mockImplementation((_variables, options?: MutateOptions) =>
      options?.onError?.({
        response: {
          status: 409,
          data: { error: "Stage order is frozen once a position is live" },
        },
      }),
    );
    renderScreen("open");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Stage order is frozen once a position leaves draft/,
    );
  });

  it("confirms a successful save without leaving the screen", async () => {
    const user = userEvent.setup();
    harness.updateMutate.mockImplementation((_variables, options?: MutateOptions) =>
      options?.onSuccess?.(undefined),
    );
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("status")).toHaveTextContent("Changes saved.");
    expect(harness.push).not.toHaveBeenCalled();
  });
});

describe("EditPositionScreen status transitions", () => {
  it("offers the transitions available from the current status", () => {
    renderScreen("open");

    expect(screen.getByRole("button", { name: "Close (pause)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("closes a position by changing status alone, touching nothing else", async () => {
    const user = userEvent.setup();
    renderScreen("open");

    await user.click(screen.getByRole("button", { name: "Close (pause)" }));

    expect(harness.setStatusMutate).toHaveBeenCalledTimes(1);
    const call = harness.setStatusMutate.mock.calls[0];
    expect(call![0] as StatusVariables).toEqual({ id: "position-1", status: "closed" });
    expect(harness.updateMutate).not.toHaveBeenCalled();
  });

  it("publishes a draft position", async () => {
    const user = userEvent.setup();
    renderScreen("draft");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    const call = harness.setStatusMutate.mock.calls[0];
    expect(call![0] as StatusVariables).toEqual({ id: "position-1", status: "open" });
  });
});
