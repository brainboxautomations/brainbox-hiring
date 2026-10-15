import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MessageTemplate, PipelineStage, QuestionnaireTemplate } from "@/types/api";
import type { BulkActionOutcome } from "@/utilities/bulk-action-outcome";
import { BulkActionBar, type BulkActionBarProps } from "./bulk-action-bar";

const STAGES: PipelineStage[] = [
  { id: "stage-1", name: "Applied", sortOrder: 1 },
  { id: "stage-2", name: "Shortlist", sortOrder: 2 },
  { id: "stage-3", name: "Rejected", sortOrder: 3 },
];

const TEMPLATES: MessageTemplate[] = [
  {
    id: "template-1",
    name: "Interview invite",
    subject: "You are invited to interview",
    body: "Hi {{candidate.first_name}}",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  },
];

const QUESTIONNAIRES: QuestionnaireTemplate[] = [
  {
    id: "questionnaire-1",
    name: "Video screening",
    questionCount: 4,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    questions: [],
    onCompletionTemplateStageId: null,

    inviteEmail: { mode: "default", subject: null, body: null },

    reminderEmail: { mode: "default", subject: null, body: null },
  },
];

function renderBar(overrides: Partial<BulkActionBarProps> = {}) {
  const props: BulkActionBarProps = {
    selectedCount: 3,
    stages: STAGES,
    messageTemplates: TEMPLATES,
    questionnaires: QUESTIONNAIRES,
    pendingAction: null,
    outcome: null,
    notice: null,
    onMoveToStage: vi.fn(),
    onSendEmail: vi.fn(),
    onSendQuestionnaire: vi.fn(),
    onArchive: vi.fn(),
    onExport: vi.fn(),
    onClearSelection: vi.fn(),
    onDismissOutcome: vi.fn(),
    ...overrides,
  };
  render(<BulkActionBar {...props} />);
  return props;
}

describe("BulkActionBar selection summary", () => {
  it("names how many candidates the action will cover", () => {
    renderBar({ selectedCount: 12 });
    expect(screen.getByText("12 selected")).toBeInTheDocument();
  });

  it("clears the selection", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });
});

describe("BulkActionBar move to stage", () => {
  it("offers every stage on the position, terminal ones included", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Move stage" }));

    expect(screen.getByRole("button", { name: "Applied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shortlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeInTheDocument();
  });

  it("moves the selection to the chosen stage and closes the picker", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Move stage" }));
    await user.click(screen.getByRole("button", { name: "Shortlist" }));

    expect(props.onMoveToStage).toHaveBeenCalledWith("stage-2");
    expect(screen.queryByRole("button", { name: "Shortlist" })).toBeNull();
  });

  it("withholds the move control when the position has no stages", () => {
    renderBar({ stages: [] });
    expect(screen.getByRole("button", { name: "Move stage" })).toBeDisabled();
  });
});

describe("BulkActionBar archive", () => {
  it("asks for confirmation before archiving anything", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.getByText("Archive 3 candidates?")).toBeInTheDocument();
    expect(props.onArchive).not.toHaveBeenCalled();
  });

  it("archives once the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive 3" }));

    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it("archives nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onArchive).not.toHaveBeenCalled();
    expect(screen.queryByText("Archive 3 candidates?")).toBeNull();
  });

  it("uses the singular when only one candidate is selected", async () => {
    const user = userEvent.setup();
    renderBar({ selectedCount: 1 });

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(screen.getByText("Archive 1 candidate?")).toBeInTheDocument();
  });
});

describe("BulkActionBar export", () => {
  it("exports without a confirmation step", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(props.onExport).toHaveBeenCalledTimes(1);
  });
});

describe("BulkActionBar bulk email", () => {
  it("offers the message templates rather than a free-text compose", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(screen.getByRole("button", { name: /Interview invite/ })).toBeInTheDocument();
  });

  it("sends the chosen template and closes the panel", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Send email" }));
    await user.click(screen.getByRole("button", { name: /Interview invite/ }));

    expect(props.onSendEmail).toHaveBeenCalledWith("template-1");
    expect(screen.queryByRole("button", { name: /Interview invite/ })).not.toBeInTheDocument();
  });

  it("says so rather than offering an empty list when there are no templates", async () => {
    const user = userEvent.setup();
    renderBar({ messageTemplates: [] });

    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(screen.getByText(/no message templates yet/i)).toBeInTheDocument();
  });

  it("promises each candidate their own message", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(screen.getByText(/Nobody is CC/)).toBeInTheDocument();
  });
});

describe("BulkActionBar send questionnaire", () => {
  it("offers every questionnaire template, with its question count", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));

    expect(screen.getByRole("button", { name: /Video screening/ })).toBeInTheDocument();
    expect(screen.getByText("4 questions")).toBeInTheDocument();
  });

  it("sends the chosen questionnaire, chasing with reminders by default", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await user.click(screen.getByRole("button", { name: /Video screening/ }));

    expect(props.onSendQuestionnaire).toHaveBeenCalledWith("questionnaire-1", true);
  });

  it("sends without reminders once the chase is turned off", async () => {
    const user = userEvent.setup();
    const props = renderBar();

    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));
    await user.click(screen.getByRole("checkbox", { name: "Send reminders" }));
    await user.click(screen.getByRole("button", { name: /Video screening/ }));

    expect(props.onSendQuestionnaire).toHaveBeenCalledWith("questionnaire-1", false);
  });

  it("says every candidate gets their own link, and what a repeat send does", async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));

    expect(screen.getByText(/their own link, which only they can open/)).toBeInTheDocument();
    expect(screen.getByText(/already completed it is skipped/)).toBeInTheDocument();
  });

  it("explains itself rather than offering an empty picker when there are no questionnaires", async () => {
    const user = userEvent.setup();
    renderBar({ questionnaires: [] });

    await user.click(screen.getByRole("button", { name: "Send questionnaire" }));

    expect(screen.getByText(/no questionnaires yet/)).toBeInTheDocument();
  });
});

describe("BulkActionBar selection limit", () => {
  it("says the selection was capped rather than silently shortening it", () => {
    renderBar({
      selectedCount: 500,
      notice: "A bulk action covers at most 500 candidates at a time.",
    });

    expect(screen.getByRole("status")).toHaveTextContent("at most 500 candidates");
  });

  it("shows no limit notice when the selection is within the cap", () => {
    renderBar({ selectedCount: 3 });

    expect(screen.queryByText(/at most 500 candidates/)).not.toBeInTheDocument();
  });
});

describe("BulkActionBar loading state", () => {
  it("disables every runnable action while one is in flight", () => {
    renderBar({ pendingAction: "move" });

    expect(screen.getByRole("button", { name: "Move stage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("still lets the selection be cleared while an action is in flight", async () => {
    const user = userEvent.setup();
    const props = renderBar({ pendingAction: "export" });

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });
});

describe("BulkActionBar outcome reporting", () => {
  const partial: BulkActionOutcome = {
    tone: "partial",
    title: "17 of 20 moved",
    message: "3 failed and stay selected. The rest went through and are unaffected.",
    details: [
      "Amara Okafor — Candidate not found",
      "Bilal Haddad — That stage belongs to a different position",
      "Chen Wei — permission denied",
    ],
  };

  it("announces a clean run without raising an alert", () => {
    renderBar({
      outcome: {
        tone: "success",
        title: "3 candidates moved",
        message: "Now in Shortlist.",
        details: [],
      },
    });

    expect(screen.getByRole("status")).toHaveTextContent("3 candidates moved");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names every candidate that failed in a partial run", () => {
    renderBar({ outcome: partial });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("17 of 20 moved");
    expect(alert).toHaveTextContent("Amara Okafor — Candidate not found");
    expect(alert).toHaveTextContent("Bilal Haddad — That stage belongs to a different position");
    expect(alert).toHaveTextContent("Chen Wei — permission denied");
  });

  it("says the successful ones went through, so a partial run is not read as a rollback", () => {
    renderBar({ outcome: partial });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The rest went through and are unaffected.",
    );
  });

  it("raises an alert when nothing succeeded", () => {
    renderBar({
      outcome: {
        tone: "error",
        title: "Couldn’t archive",
        message: "The server refused this bulk action.",
        details: [],
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("The server refused this bulk action.");
  });

  it("dismisses the outcome on request", async () => {
    const user = userEvent.setup();
    const props = renderBar({ outcome: partial });

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(props.onDismissOutcome).toHaveBeenCalledTimes(1);
  });

  it("shows nothing at all when there is no outcome to report", () => {
    renderBar();

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
