import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_BULK_SELECTION } from "@/schemas/bulk-candidate-schema";
import type {
  BulkCandidateQuestionnaireResult,
  BulkCandidateUpdate,
  BulkCandidateUpdateResult,
  Candidate,
  CandidateExportRecord,
  PipelineStage,
  Position,
} from "@/types/api";
import type { CandidateExportResponse } from "@/services/candidates-service";

type MutateOptions<TData> = {
  onSuccess?: (value: TData) => void;
  onError?: (error: unknown) => void;
};

const harness = vi.hoisted(() => ({
  state: {
    position: undefined as unknown,
    positionLoading: false,
    positionError: false,
    candidates: [] as unknown,
    candidatesLoading: false,
    candidatesError: false,
  },
  refetchPosition: vi.fn(),
  refetchCandidates: vi.fn(),
  updateMutate: vi.fn(),
  bulkMutate: vi.fn(),
  bulkEmailMutate: vi.fn(),
  exportMutate: vi.fn(),
  questionnaireMutate: vi.fn(),
  messageTemplates: [] as unknown,
  questionnaires: [] as unknown,
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => harness.searchParams,
}));

vi.mock("@/hooks/use-positions", () => ({
  usePosition: () => ({
    data: harness.state.position,
    isLoading: harness.state.positionLoading,
    isError: harness.state.positionError,
    error: new Error("Position not found"),
    refetch: harness.refetchPosition,
  }),
  usePositions: () => ({ data: [] }),
}));

vi.mock("@/hooks/use-candidates", () => ({
  useCandidates: () => ({
    data: harness.state.candidates,
    isLoading: harness.state.candidatesLoading,
    isError: harness.state.candidatesError,
    error: new Error("Candidates are unavailable"),
    refetch: harness.refetchCandidates,
  }),
  useUpdateCandidate: () => ({ mutate: harness.updateMutate }),
  useBulkUpdateCandidates: () => ({ mutate: harness.bulkMutate }),
  useBulkEmailCandidates: () => ({ mutate: harness.bulkEmailMutate }),
  useBulkSendQuestionnaire: () => ({ mutate: harness.questionnaireMutate }),
  useExportCandidates: () => ({ mutate: harness.exportMutate }),
}));

vi.mock("@/hooks/use-questionnaires", () => ({
  useQuestionnaires: () => ({ data: harness.questionnaires }),
}));

vi.mock("@/hooks/use-messages", () => ({
  useCancelMessageBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: harness.messageTemplates }),
}));

vi.mock("@/hooks/use-stage-actions", () => ({
  useStageActions: () => ({ data: [], isLoading: false, isError: false }),
  useCreateStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteStageAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { PipelineBoardScreen } = await import("./pipeline-board-screen");

const STAGES: PipelineStage[] = [
  { id: "stage-1", name: "Applied", sortOrder: 1 },
  { id: "stage-2", name: "Shortlist", sortOrder: 2 },
  { id: "stage-3", name: "Rejected", sortOrder: 3 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara@example.com",
    headline: "Senior Frontend Engineer",
    stageId: "stage-1",
    starred: false,
    seen: true,
    archived: false,
    questionnaire: "none",
    appliedAt: daysAgo(1),
    stageEnteredAt: daysAgo(1),
    lastActivityAt: daysAgo(1),
    ...overrides,
  };
}

function makePosition(stages: PipelineStage[] = STAGES): Position {
  return {
    id: "position-1",
    title: "Growth Engineer",
    slug: "growth-engineer",
    department: "Engineering",
    positionType: "Full-time",
    locations: [{ country: "United Kingdom", detail: "London" }],
    remoteFlag: true,
    status: "open",
    publishMode: "listed",
    candidateCount: 3,
    createdAt: daysAgo(90),
    educationLevel: null,
    educationLevelRequired: true,
    experienceLevel: null,
    salaryFrom: null,
    salaryTo: null,
    salaryPeriod: null,
    salaryCurrency: null,
    description: null,
    applicationFormConfig: {},
    applicationQuestionnaireId: null,
    assignedPipelineId: "pipeline-1",
    emailSenderName: null,
    hiringTeam: [],
    stages,
  };
}

function makeExportRecord(overrides: Partial<CandidateExportRecord> = {}): CandidateExportRecord {
  return {
    applicationId: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara@example.com",
    phone: null,
    headline: "Senior Frontend Engineer",
    positionTitle: "Growth Engineer",
    stageName: "Applied",
    archived: false,
    starred: false,
    seen: true,
    questionnaire: "none",
    appliedAt: daysAgo(1),
    lastActivityAt: daysAgo(1),
    formAnswers: {},
    ...overrides,
  };
}

function renderBoard(candidates: Candidate[], position: Position = makePosition()) {
  harness.state.position = position;
  harness.state.candidates = candidates;
  return render(<PipelineBoardScreen positionId="position-1" />);
}

async function selectCandidates(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  await user.click(screen.getByRole("button", { name: "Select" }));
  for (const name of names) {
    await user.click(screen.getByText(name));
  }
}

function lastBulkVariables(): BulkCandidateUpdate {
  const call = harness.bulkMutate.mock.calls[0];
  expect(call).toBeDefined();
  return call![0] as BulkCandidateUpdate;
}

function resolveBulkWith(result: BulkCandidateUpdateResult) {
  harness.bulkMutate.mockImplementation(
    (_variables, options?: MutateOptions<BulkCandidateUpdateResult>) =>
      options?.onSuccess?.(result),
  );
}

function resolveExportWith(response: CandidateExportResponse) {
  harness.exportMutate.mockImplementation(
    (_variables, options?: MutateOptions<CandidateExportResponse>) =>
      options?.onSuccess?.(response),
  );
}

beforeEach(() => {
  harness.state.position = makePosition();
  harness.state.positionLoading = false;
  harness.state.positionError = false;
  harness.state.candidates = [];
  harness.state.candidatesLoading = false;
  harness.state.candidatesError = false;
  harness.refetchPosition.mockReset();
  harness.refetchCandidates.mockReset();
  harness.updateMutate.mockReset();
  harness.bulkMutate.mockReset();
  harness.bulkEmailMutate.mockReset();
  harness.questionnaireMutate.mockReset();
  harness.exportMutate.mockReset();
  harness.messageTemplates = [];
  harness.questionnaires = [];
  harness.searchParams = new URLSearchParams();
});

describe("PipelineBoardScreen loading, empty and error states", () => {
  it("renders a loading state while the position is being fetched", () => {
    harness.state.positionLoading = true;

    render(<PipelineBoardScreen positionId="position-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading pipeline");
  });

  it("renders a loading state while the candidates are being fetched", () => {
    harness.state.candidatesLoading = true;
    renderBoard([]);

    expect(screen.getByRole("status")).toHaveTextContent("Loading candidates");
  });

  it("renders an error state with a retry when the position cannot be loaded", async () => {
    const user = userEvent.setup();
    harness.state.positionError = true;
    harness.state.position = undefined;

    render(<PipelineBoardScreen positionId="position-1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load this position");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(harness.refetchPosition).toHaveBeenCalledTimes(1);
  });

  it("renders an error state with a retry when the candidates cannot be loaded", async () => {
    const user = userEvent.setup();
    harness.state.candidatesError = true;
    renderBoard([]);

    expect(screen.getByRole("alert")).toHaveTextContent("Candidates are unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(harness.refetchCandidates).toHaveBeenCalledTimes(1);
  });

  it("renders an empty column rather than a blank board when no candidate is in a stage", () => {
    renderBoard([]);
    expect(screen.getAllByText("No candidates in this stage").length).toBeGreaterThan(0);
  });

  it("explains an unassigned pipeline instead of showing an empty board", () => {
    renderBoard([], makePosition([]));
    expect(screen.getByText("No pipeline assigned")).toBeInTheDocument();
  });
});

describe("PipelineBoardScreen columns", () => {
  it("gives every stage its own column, including what used to be a rejection stage", () => {
    renderBoard([makeCandidate({ id: "one", firstName: "One", stageId: "stage-3" })]);

    for (const stage of STAGES) {
      expect(
        screen.getByRole("button", { name: `Automations for ${stage.name}` }),
      ).toBeInTheDocument();
    }
  });

  it("opens stage actions inline over the board instead of navigating to a new page", async () => {
    const user = userEvent.setup();
    renderBoard([makeCandidate({ id: "one", firstName: "One" })]);

    await user.click(screen.getByRole("button", { name: "Automations for Applied" }));

    // The panel is now rendered inline, so the board's own column headers
    // (e.g. "Applied") are still in the document underneath it — this used
    // to be a full navigation to /pipelines/stage-actions that replaced the
    // board entirely.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
    expect(screen.getAllByText("Applied").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("No actions yet")).toBeNull();
  });

  it("offers no collapsed closed-or-rejected group", () => {
    renderBoard([makeCandidate({ id: "one", firstName: "One" })]);

    expect(screen.queryByText(/closed \/ rejected/i)).not.toBeInTheDocument();
  });

  it("shows a candidate sitting in a rejection stage on the board rather than hiding them", () => {
    renderBoard([makeCandidate({ id: "gone", firstName: "Gone", stageId: "stage-3" })]);

    expect(screen.getByText("Gone Okafor")).toBeInTheDocument();
  });
});

describe("PipelineBoardScreen stage filter markup", () => {
  it("offers each stage as a checkbox rather than a button inside a button", async () => {
    const user = userEvent.setup();
    const { container } = renderBoard([makeCandidate({ id: "one", firstName: "One" })]);

    const applied = screen.getByRole("checkbox", { name: "Applied" });
    expect(applied).toHaveAttribute("aria-checked", "false");
    expect(container.querySelectorAll("button button")).toHaveLength(0);

    await user.click(applied);

    expect(screen.getByRole("checkbox", { name: "Applied" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("PipelineBoardScreen added date filter", () => {
  const candidates = [
    makeCandidate({ id: "fresh", firstName: "Fresh", appliedAt: daysAgo(2) }),
    makeCandidate({ id: "old", firstName: "Old", appliedAt: daysAgo(60) }),
  ];

  it("shows every candidate before the filter is touched", () => {
    renderBoard(candidates);

    expect(screen.getByText("Fresh Okafor")).toBeInTheDocument();
    expect(screen.getByText("Old Okafor")).toBeInTheDocument();
  });

  it("hides candidates added outside the chosen window", async () => {
    const user = userEvent.setup();
    renderBoard(candidates);

    const group = screen.getByRole("group", { name: "Added date" });
    await user.click(within(group).getByRole("radio", { name: "Last 30 days" }));

    expect(screen.getByText("Fresh Okafor")).toBeInTheDocument();
    expect(screen.queryByText("Old Okafor")).toBeNull();
  });

  it("brings them back on the wider window", async () => {
    const user = userEvent.setup();
    renderBoard(candidates);

    const group = screen.getByRole("group", { name: "Added date" });
    await user.click(within(group).getByRole("radio", { name: "Last 30 days" }));
    await user.click(within(group).getByRole("radio", { name: "Last 90 days" }));

    expect(screen.getByText("Old Okafor")).toBeInTheDocument();
  });
});

describe("PipelineBoardScreen last activity filter", () => {
  const candidates = [
    makeCandidate({ id: "active", firstName: "Active", lastActivityAt: daysAgo(3) }),
    makeCandidate({ id: "quiet", firstName: "Quiet", lastActivityAt: daysAgo(120) }),
  ];

  it("hides candidates with no activity inside the chosen window", async () => {
    const user = userEvent.setup();
    renderBoard(candidates);

    const group = screen.getByRole("group", { name: "Last activity" });
    await user.click(within(group).getByRole("radio", { name: "Last 7 days" }));

    expect(screen.getByText("Active Okafor")).toBeInTheDocument();
    expect(screen.queryByText("Quiet Okafor")).toBeNull();
  });

  it("filters on activity independently of when the candidate was added", async () => {
    const user = userEvent.setup();
    renderBoard(candidates);

    const added = screen.getByRole("group", { name: "Added date" });
    await user.click(within(added).getByRole("radio", { name: "Last 7 days" }));

    expect(screen.getByText("Quiet Okafor")).toBeInTheDocument();
  });

  it("resets both date filters with the rest", async () => {
    const user = userEvent.setup();
    renderBoard(candidates);

    const group = screen.getByRole("group", { name: "Last activity" });
    await user.click(within(group).getByRole("radio", { name: "Last 7 days" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByText("Quiet Okafor")).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "Any time" })).toBeChecked();
  });
});

describe("PipelineBoardScreen bulk move", () => {
  const candidates = [
    makeCandidate({ id: "application-1", firstName: "Amara" }),
    makeCandidate({ id: "application-2", firstName: "Bilal" }),
  ];

  it("shows no bulk bar until something is selected", () => {
    renderBoard(candidates);
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("sends every selected candidate to the chosen stage in one request", async () => {
    const user = userEvent.setup();
    resolveBulkWith({ updated: [candidates[0]!, candidates[1]!], failures: [] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor", "Bilal Okafor"]);
    await user.click(screen.getByRole("button", { name: "Move stage" }));
    await user.click(screen.getByRole("button", { name: "Shortlist" }));

    expect(lastBulkVariables()).toEqual({
      applicationIds: ["application-1", "application-2"],
      patch: { stageId: "stage-2" },
    });
  });

  it("confirms a clean run and drops the selection", async () => {
    const user = userEvent.setup();
    resolveBulkWith({ updated: [candidates[0]!, candidates[1]!], failures: [] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor", "Bilal Okafor"]);
    await user.click(screen.getByRole("button", { name: "Move stage" }));
    await user.click(screen.getByRole("button", { name: "Shortlist" }));

    expect(screen.getByRole("status")).toHaveTextContent("2 candidates moved");
    expect(screen.getByRole("status")).toHaveTextContent("Now in Shortlist.");
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("names the candidates that failed and keeps only those selected (partial failure)", async () => {
    const user = userEvent.setup();
    resolveBulkWith({
      updated: [candidates[0]!],
      failures: [{ applicationId: "application-2", reason: "Candidate not found" }],
    });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor", "Bilal Okafor"]);
    await user.click(screen.getByRole("button", { name: "Move stage" }));
    await user.click(screen.getByRole("button", { name: "Shortlist" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("1 of 2 moved");
    expect(alert).toHaveTextContent("Bilal Okafor — Candidate not found");
    expect(alert).toHaveTextContent("The rest went through and are unaffected.");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("reports a whole-request failure without claiming anything moved", async () => {
    const user = userEvent.setup();
    harness.bulkMutate.mockImplementation(
      (_variables, options?: MutateOptions<BulkCandidateUpdateResult>) =>
        options?.onError?.({ response: { status: 500, data: { error: "Database is down" } } }),
    );
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Move stage" }));
    await user.click(screen.getByRole("button", { name: "Shortlist" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Database is down");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("PipelineBoardScreen bulk archive", () => {
  const candidates = [makeCandidate({ id: "application-1", firstName: "Amara" })];

  it("archives the selection once confirmed", async () => {
    const user = userEvent.setup();
    resolveBulkWith({ updated: [{ ...candidates[0]!, archived: true }], failures: [] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive 1" }));

    expect(lastBulkVariables()).toEqual({
      applicationIds: ["application-1"],
      patch: { status: "archived" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 candidate archived");
  });
});

describe("PipelineBoardScreen bulk export", () => {
  const candidates = [
    makeCandidate({ id: "application-1", firstName: "Amara" }),
    makeCandidate({ id: "application-2", firstName: "Bilal" }),
  ];

  const createObjectURL = vi.fn(() => "blob:candidates");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("asks the server only for the selected candidates and downloads the file", async () => {
    const user = userEvent.setup();
    resolveExportWith({ records: [makeExportRecord()], missingIds: [] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(harness.exportMutate.mock.calls[0]![0]).toEqual(["application-1"]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("1 candidate exported");
  });

  it("reports the candidates it could not read rather than exporting them silently", async () => {
    const user = userEvent.setup();
    resolveExportWith({ records: [makeExportRecord()], missingIds: ["application-2"] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor", "Bilal Okafor"]);
    await user.click(screen.getByRole("button", { name: "Export" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("1 of 2 exported");
    expect(alert).toHaveTextContent("Bilal Okafor — no longer on this position");
  });

  it("downloads nothing and raises an alert when the export fails outright", async () => {
    const user = userEvent.setup();
    harness.exportMutate.mockImplementation(
      (_variables, options?: MutateOptions<CandidateExportResponse>) =>
        options?.onError?.({ response: { status: 500, data: { error: "Export failed" } } }),
    );
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Export failed");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("PipelineBoardScreen select all and the bulk limit", () => {
  it("selects every candidate the filters left on the board", async () => {
    const user = userEvent.setup();
    renderBoard([
      makeCandidate({ id: "application-1", firstName: "Amara" }),
      makeCandidate({ id: "application-2", firstName: "Bilal", stageId: "stage-2" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select all 2" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("selects only what the filters left, not the whole position", async () => {
    const user = userEvent.setup();
    renderBoard([
      makeCandidate({ id: "application-1", firstName: "Amara", starred: true }),
      makeCandidate({ id: "application-2", firstName: "Bilal", starred: false }),
    ]);

    await user.click(screen.getByRole("button", { name: "Starred only" }));
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select all 1" }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("caps the selection at the bulk limit and says so rather than truncating quietly", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: MAX_BULK_SELECTION + 3 }, (_, index) =>
      makeCandidate({ id: `application-${index}`, firstName: `Candidate${index}` }),
    );
    renderBoard(many);

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: `Select all ${MAX_BULK_SELECTION + 3}` }));

    expect(screen.getByText(`${MAX_BULK_SELECTION} selected`)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      `at most ${MAX_BULK_SELECTION} candidates at a time`,
    );
  }, 15_000); // under load even though the test passes reliably in isolation. // is genuinely slow rather than broken — the default 5s budget flakes // Renders MAX_BULK_SELECTION + 3 (503) candidate cards under jsdom, which

  it("arrives with everyone selected when the positions menu asks to email them all", () => {
    harness.searchParams = new URLSearchParams("select=all");
    renderBoard([
      makeCandidate({ id: "application-1", firstName: "Amara" }),
      makeCandidate({ id: "application-2", firstName: "Bilal" }),
    ]);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send email" })).toBeInTheDocument();
  });
});

describe("PipelineBoardScreen bulk send questionnaire", () => {
  const candidates = [
    makeCandidate({ id: "application-1", firstName: "Amara" }),
    makeCandidate({ id: "application-2", firstName: "Bilal" }),
  ];

  function resolveQuestionnaireWith(result: BulkCandidateQuestionnaireResult) {
    harness.questionnaireMutate.mockImplementation(
      (_variables, options?: MutateOptions<BulkCandidateQuestionnaireResult>) =>
        options?.onSuccess?.(result),
    );
  }

  beforeEach(() => {
    harness.questionnaires = [
      {
        id: "questionnaire-1",
        name: "Video screening",
        questionCount: 3,
        createdAt: daysAgo(10),
        updatedAt: daysAgo(10),
        questions: [],
        onCompletionTemplateStageId: null,
        inviteEmail: { mode: "default", subject: null, body: null },
        reminderEmail: { mode: "default", subject: null, body: null },
      },
    ];
  });

  it("sends the questionnaire to exactly the selected candidates", async () => {
    const user = userEvent.setup();
    resolveQuestionnaireWith({ sent: ["application-1"], failures: [] });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await user.click(screen.getByRole("button", { name: /Video screening/ }));

    expect(harness.questionnaireMutate.mock.calls[0]![0]).toEqual({
      applicationIds: ["application-1"],
      questionnaireTemplateId: "questionnaire-1",
      sendReminders: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 candidate sent the questionnaire");
  });

  it("names the candidates it could not reach and keeps only those selected", async () => {
    const user = userEvent.setup();
    resolveQuestionnaireWith({
      sent: ["application-1"],
      failures: [
        {
          applicationId: "application-2",
          reason: "They have already completed this questionnaire, so it was not sent again",
        },
      ],
    });
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor", "Bilal Okafor"]);
    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await user.click(screen.getByRole("button", { name: /Video screening/ }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("1 of 2 sent the questionnaire");
    expect(alert).toHaveTextContent(
      "Bilal Okafor — They have already completed this questionnaire",
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("raises an alert and sends nothing when the server refuses the whole request", async () => {
    const user = userEvent.setup();
    harness.questionnaireMutate.mockImplementation(
      (_variables, options?: MutateOptions<BulkCandidateQuestionnaireResult>) =>
        options?.onError?.({
          response: { status: 422, data: { error: "That questionnaire does not exist" } },
        }),
    );
    renderBoard(candidates);

    await selectCandidates(user, ["Amara Okafor"]);
    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await user.click(screen.getByRole("button", { name: /Video screening/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("That questionnaire does not exist");
  });
});
