import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Candidate,
  CandidateProfile,
  Note,
  PipelineStage,
  QuestionnaireResponseDetail,
} from "@/types/api";

const harness = vi.hoisted(() => ({
  profile: undefined as unknown,
  notes: [] as unknown,
  getProfile: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
  updateCandidate: vi.fn(),
  listByPosition: vi.fn(),
  updatePerson: vi.fn(),
  setRemindersStopped: vi.fn(),
  resendQuestionnaire: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ candidateId: "application-1" }),
  useRouter: () => ({ push: harness.push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/services/candidates-service", () => ({
  CandidatesService: {
    getProfile: harness.getProfile,
    listNotes: harness.listNotes,
    addNote: harness.addNote,
    update: harness.updateCandidate,
    listByPosition: harness.listByPosition,
  },
}));

vi.mock("@/services/people-service", () => ({
  PeopleService: { update: harness.updatePerson },
}));

vi.mock("@/services/questionnaires-service", () => ({
  QuestionnairesService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  QuestionnaireRemindersService: { setStopped: harness.setRemindersStopped },
  QuestionnaireResponsesService: { resend: harness.resendQuestionnaire },
}));

const CandidateProfilePage = (await import("./page")).default;

const STAGES: PipelineStage[] = [
  { id: "stage-1", name: "Applied", sortOrder: 1 },
  { id: "stage-2", name: "Shortlist", sortOrder: 2 },
];

const SERVER_REFUSED = { response: { status: 500, data: { error: "Database is down" } } };

function makeProfile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    application: {
      id: "application-1",
      positionId: "position-1",
      positionTitle: "Growth Engineer",
      stageId: "stage-1",
      starred: false,
      seen: true,
      archived: false,
      appliedAt: "2026-01-05T09:00:00.000Z",
      formAnswers: {},
      resubmissionAttempts: { count: 0, mostRecentAt: null },
    },
    person: {
      id: "person-1",
      firstName: "Amara",
      lastName: "Okafor",
      email: "amara@example.com",
      phone: null,
      headline: "Senior Frontend Engineer",
      links: [],
      customAttributes: {},
    },
    stages: STAGES,
    applications: [],
    documents: [],
    questionnaires: [],
    upcomingAutomations: [],
    ...overrides,
  };
}

function profileInStage(stageId: string): CandidateProfile {
  const base = makeProfile();
  return { ...base, application: { ...base.application, stageId } };
}

function profileStarred(starred: boolean): CandidateProfile {
  const base = makeProfile();
  return { ...base, application: { ...base.application, starred } };
}

function makeNote(body: string): Note {
  return {
    id: "note-1",
    body,
    authorName: "Priya",
    createdAt: "2026-02-01T10:00:00.000Z",
  };
}

function updatedCandidate(): Candidate {
  return {
    id: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara@example.com",
    headline: "Senior Frontend Engineer",
    stageId: "stage-2",
    starred: true,
    seen: true,
    archived: false,
    questionnaire: "none",
    appliedAt: "2026-01-05T09:00:00.000Z",
    stageEnteredAt: "2026-01-05T09:00:00.000Z",
    lastActivityAt: "2026-01-05T09:00:00.000Z",
  };
}

function acceptUpdateAndReturn(nextProfile: CandidateProfile) {
  harness.updateCandidate.mockImplementation(async () => {
    harness.profile = nextProfile;
    return updatedCandidate();
  });
}

async function renderProfile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <CandidateProfilePage />
    </QueryClientProvider>,
  );

  await screen.findAllByText("Amara Okafor");
}

function stageButton(name: string) {
  return screen.getByRole("button", { name });
}

async function moveToShortlist(user: ReturnType<typeof userEvent.setup>) {
  await user.click(stageButton("Applied"));
  await user.click(screen.getByRole("button", { name: "Shortlist" }));
}

async function settled() {
  await waitFor(() => expect(harness.getProfile).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  harness.profile = makeProfile();
  harness.notes = [];
  harness.getProfile.mockImplementation(async () => harness.profile);
  harness.listNotes.mockImplementation(async () => harness.notes);
  harness.listByPosition.mockResolvedValue([]);
  harness.addNote.mockReset();
  harness.updateCandidate.mockReset();
  harness.updatePerson.mockReset();
  harness.setRemindersStopped.mockReset();
  harness.resendQuestionnaire.mockReset();
  harness.push.mockReset();
});

describe("CandidateProfilePage stage change", () => {
  it("shows the new stage when the server accepts the move", async () => {
    const user = userEvent.setup();
    acceptUpdateAndReturn(profileInStage("stage-2"));
    await renderProfile();

    await moveToShortlist(user);

    expect(await screen.findByRole("button", { name: "Shortlist" })).toBeInTheDocument();
    await waitFor(() => expect(harness.getProfile).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Shortlist" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends the chosen stage to the server", async () => {
    const user = userEvent.setup();
    acceptUpdateAndReturn(profileInStage("stage-2"));
    await renderProfile();

    await moveToShortlist(user);

    expect(harness.updateCandidate).toHaveBeenCalledWith("application-1", { stageId: "stage-2" });
  });

  it("puts the candidate back in their old stage when the move fails", async () => {
    const user = userEvent.setup();
    harness.updateCandidate.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await moveToShortlist(user);
    await settled();

    expect(stageButton("Applied")).toBeInTheDocument();
    expect(screen.queryByText("Shortlist")).toBeNull();
  });

  it("says why the move failed instead of failing quietly", async () => {
    const user = userEvent.setup();
    harness.updateCandidate.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await moveToShortlist(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t move this candidate");
    expect(screen.getByRole("alert")).toHaveTextContent("Database is down");
  });
});

describe("CandidateProfilePage star toggle", () => {
  it("stars the candidate when the server accepts it", async () => {
    const user = userEvent.setup();
    acceptUpdateAndReturn(profileStarred(true));
    await renderProfile();

    await user.click(screen.getByRole("button", { name: "Star" }));

    expect(await screen.findByRole("button", { name: "Unstar" })).toBeInTheDocument();
    expect(harness.updateCandidate).toHaveBeenCalledWith("application-1", { starred: true });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves the candidate unstarred when the server refuses", async () => {
    const user = userEvent.setup();
    harness.updateCandidate.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await user.click(screen.getByRole("button", { name: "Star" }));
    await settled();

    expect(screen.getByRole("button", { name: "Star" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unstar" })).toBeNull();
  });

  it("says why the star could not be set", async () => {
    const user = userEvent.setup();
    harness.updateCandidate.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await user.click(screen.getByRole("button", { name: "Star" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t star this candidate");
    expect(screen.getByRole("alert")).toHaveTextContent("Database is down");
  });

  it("leaves an already starred candidate starred when unstarring fails", async () => {
    const user = userEvent.setup();
    harness.profile = profileStarred(true);
    harness.updateCandidate.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await user.click(screen.getByRole("button", { name: "Unstar" }));
    await settled();

    expect(screen.getByRole("button", { name: "Unstar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Star" })).toBeNull();
  });
});

describe("CandidateProfilePage internal notes", () => {
  const NOTE = "Strong systems answer, move fast";

  it("posts the note and clears the box when the server accepts it", async () => {
    const user = userEvent.setup();
    harness.addNote.mockImplementation(async (_id: string, body: string) => makeNote(body));
    await renderProfile();

    const box = screen.getByPlaceholderText("Write a note for the team…");
    await user.type(box, NOTE);
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps what was typed when the note cannot be saved", async () => {
    const user = userEvent.setup();
    harness.addNote.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    const box = screen.getByPlaceholderText("Write a note for the team…");
    await user.type(box, NOTE);
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(harness.addNote).toHaveBeenCalledTimes(1));

    expect(box).toHaveValue(NOTE);
    expect(screen.getByText("No notes yet. Add the first one below.")).toBeInTheDocument();
  });

  it("says why the note could not be saved", async () => {
    const user = userEvent.setup();
    harness.addNote.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await user.type(screen.getByPlaceholderText("Write a note for the team…"), NOTE);
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save this note");
    expect(screen.getByRole("alert")).toHaveTextContent("Database is down");
  });
});

describe("CandidateProfilePage custom attributes", () => {
  beforeEach(() => {
    const base = makeProfile();
    harness.profile = {
      ...base,
      person: { ...base.person, customAttributes: { Seniority: "Staff" } },
    };
  });

  it("saves the edited attribute when the server accepts it", async () => {
    const user = userEvent.setup();
    harness.updatePerson.mockResolvedValue({ ok: true });
    await renderProfile();

    const value = screen.getByDisplayValue("Staff");
    await user.clear(value);
    await user.type(value, "Principal");
    await user.tab();

    await waitFor(() =>
      expect(harness.updatePerson).toHaveBeenCalledWith("person-1", {
        customAttributes: { Seniority: "Principal" },
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the attribute was not saved and keeps the edit when the server refuses", async () => {
    const user = userEvent.setup();
    harness.updatePerson.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    const value = screen.getByDisplayValue("Staff");
    await user.clear(value);
    await user.type(value, "Principal");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t save the custom attributes",
    );
    expect(screen.getByDisplayValue("Principal")).toBeInTheDocument();
  });
});

describe("CandidateProfilePage questionnaire reminders", () => {
  beforeEach(() => {
    const base = makeProfile();
    harness.profile = {
      ...base,
      questionnaires: [
        {
          id: "response-1",
          name: "Video screening",
          context: "stage_sent",
          status: "pending",
          sentAt: "2026-02-01T10:00:00.000Z",
          completedAt: null,
          remindersStoppedAt: null,
          pendingReminders: 2,
          linkExpiresAt: "2026-12-01T10:00:00.000Z",
          questionCount: 3,
          answers: [],
        },
      ],
    };
  });

  function withQuestionnaire(patch: Partial<QuestionnaireResponseDetail>) {
    const current = harness.profile as CandidateProfile;
    const [first] = current.questionnaires;
    harness.profile = { ...current, questionnaires: [{ ...first!, ...patch }] };
  }

  // A pending questionnaire has no answers yet, and the card used to count
  // answers, so it said "0 questions".
  it("shows how many questions the questionnaire has, not how many are answered", async () => {
    await renderProfile();
    await userEvent.setup().click(screen.getByRole("button", { name: /Questionnaires/ }));
    expect(screen.getByText(/· 3 questions/)).toBeInTheDocument();
  });

  // The button only appeared for stage-sent questionnaires, so reminders on a
  // bulk or manual send could not be stopped at all.
  it("offers Stop reminders on a manually sent questionnaire that is still being chased", async () => {
    withQuestionnaire({ context: "manual_sent" });
    await renderProfile();
    await userEvent.setup().click(screen.getByRole("button", { name: /Questionnaires/ }));
    expect(screen.getByRole("button", { name: "Stop reminders" })).toBeInTheDocument();
  });

  it("does not claim reminders are chasing when none are queued", async () => {
    withQuestionnaire({ context: "manual_sent", pendingReminders: 0 });
    await renderProfile();
    await userEvent.setup().click(screen.getByRole("button", { name: /Questionnaires/ }));
    expect(screen.queryByRole("button", { name: "Stop reminders" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Reminders keep chasing/)).not.toBeInTheDocument();
  });

  it("says the reminders are unchanged when the server refuses to stop them", async () => {
    const user = userEvent.setup();
    harness.setRemindersStopped.mockRejectedValue(SERVER_REFUSED);
    await renderProfile();

    await user.click(screen.getByRole("button", { name: /Questionnaires/ }));
    await user.click(screen.getByRole("button", { name: "Stop reminders" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t change the reminders");
    expect(screen.getByRole("button", { name: "Stop reminders" })).toBeInTheDocument();
  });
});

describe("CandidateProfilePage sending a questionnaire again", () => {
  function withQuestionnaire(patch: Partial<QuestionnaireResponseDetail>) {
    harness.profile = {
      ...makeProfile(),
      questionnaires: [
        {
          id: "response-1",
          name: "Video screening",
          context: "manual_sent",
          status: "pending",
          sentAt: "2026-02-01T10:00:00.000Z",
          completedAt: null,
          remindersStoppedAt: null,
          pendingReminders: 0,
          linkExpiresAt: "2026-12-01T10:00:00.000Z",
          questionCount: 3,
          answers: [],
          ...patch,
        },
      ],
    };
  }

  // The button was a permanently disabled placeholder.
  it("lets you send a questionnaire from the profile", async () => {
    withQuestionnaire({});
    await renderProfile();
    await userEvent.setup().click(screen.getByRole("button", { name: /Questionnaires/ }));
    expect(screen.getByRole("button", { name: "Send questionnaire" })).toBeEnabled();
  });

  it("resends a pending questionnaire with a fresh link at once", async () => {
    const user = userEvent.setup();
    withQuestionnaire({ status: "pending" });
    harness.resendQuestionnaire.mockResolvedValue({
      mode: "resent",
      questionnaireResponseId: "response-1",
    });
    await renderProfile();

    await user.click(screen.getByRole("button", { name: /Questionnaires/ }));
    await user.click(screen.getByRole("button", { name: "Resend" }));

    expect(harness.resendQuestionnaire).toHaveBeenCalledWith("response-1");
    expect(await screen.findByText(/Resent with a fresh link/)).toBeInTheDocument();
  });

  it("asks before sending a completed questionnaire again, and does nothing on Cancel", async () => {
    const user = userEvent.setup();
    withQuestionnaire({ status: "completed", completedAt: "2026-02-02T10:00:00.000Z" });
    await renderProfile();

    await user.click(screen.getByRole("button", { name: /Questionnaires/ }));
    await user.click(screen.getByRole("button", { name: "Send again" }));

    expect(screen.getByText(/Ask them to fill this in again/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(harness.resendQuestionnaire).not.toHaveBeenCalled();
  });

  it("sends a completed questionnaire again once confirmed", async () => {
    const user = userEvent.setup();
    withQuestionnaire({ status: "completed", completedAt: "2026-02-02T10:00:00.000Z" });
    harness.resendQuestionnaire.mockResolvedValue({
      mode: "asked_again",
      questionnaireResponseId: "response-2",
    });
    await renderProfile();

    await user.click(screen.getByRole("button", { name: /Questionnaires/ }));
    await user.click(screen.getByRole("button", { name: "Send again" }));
    const confirm = screen.getAllByRole("button", { name: "Send again" }).at(-1)!;
    await user.click(confirm);

    expect(harness.resendQuestionnaire).toHaveBeenCalledWith("response-1");
    expect(await screen.findByText(/Sent again/)).toBeInTheDocument();
  });

  it("says why when the server refuses", async () => {
    const user = userEvent.setup();
    withQuestionnaire({ status: "pending" });
    harness.resendQuestionnaire.mockRejectedValue({
      response: { status: 409, data: { error: "The questionnaire link could not be issued" } },
    });
    await renderProfile();

    await user.click(screen.getByRole("button", { name: /Questionnaires/ }));
    await user.click(screen.getByRole("button", { name: "Resend" }));

    expect(await screen.findByText(/could not be issued/)).toBeInTheDocument();
  });
});

describe("CandidateProfilePage Email button", () => {
  // It used to be a permanently disabled placeholder: it looked like the way
  // to email the candidate and did nothing.
  it("opens the composer for this candidate", async () => {
    harness.push.mockReset();
    const user = userEvent.setup();
    await renderProfile();

    await user.click(screen.getByRole("button", { name: "Email" }));

    expect(harness.push).toHaveBeenCalledWith("/compose?applicationId=application-1");
  });
});
