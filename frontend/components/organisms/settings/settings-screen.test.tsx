import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailSettings, SlackSettings, TeamMember } from "@/types/api";

const useTeamMembers = vi.fn();
const useSlackSettings = vi.fn();
const useEmailSettings = vi.fn();
const saveSlackSettings = vi.fn();
const saveSlackToken = vi.fn();
const createTeamMember = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useTeamMembers: () => useTeamMembers(),
  useSlackSettings: () => useSlackSettings(),
  useEmailSettings: () => useEmailSettings(),
  useSaveSlackSettings: () => ({ mutate: saveSlackSettings, isPending: false, isError: false }),
  useSaveSlackToken: () => ({ mutate: saveSlackToken, isPending: false, isError: false }),
  useCreateTeamMember: () => ({ mutate: createTeamMember, isPending: false }),
}));

import { SettingsScreen } from "./settings-screen";
import { SHARED_ACCESS_NOTE } from "./users-section";

function pending() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() };
}

function failed(message: string) {
  return {
    data: undefined,
    isPending: false,
    isError: true,
    error: new Error(message),
    refetch: vi.fn(),
  };
}

function loaded<T>(data: T) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() };
}

const MEMBERS: TeamMember[] = [
  {
    id: "user-1",
    fullName: "Rowan Mills",
    email: "rowan@example.com",
    createdAt: "2026-08-01T09:00:00.000Z",
  },
];

const SLACK_CONFIGURED: SlackSettings = {
  channelId: "C0123ABCD",
  channelName: "candidate-inbox",
  enabled: true,
  tokenConfigured: true,
  tokenSetAt: "2026-08-01T09:00:00.000Z",
};

const EMAIL: EmailSettings = {
  relayAddress: "talent@hiring.example.com",
  companyName: "Acme Inc.",
  careersUrl: "https://hiring.example.com/careers",
};

async function openSection(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  useTeamMembers.mockReturnValue(loaded(MEMBERS));
  useSlackSettings.mockReturnValue(loaded(SLACK_CONFIGURED));
  useEmailSettings.mockReturnValue(loaded(EMAIL));
});

describe("the Users section", () => {
  it("lists the real team", () => {
    render(<SettingsScreen />);
    expect(screen.getByText("Rowan Mills")).toBeInTheDocument();
    expect(screen.getByText("rowan@example.com")).toBeInTheDocument();
  });

  // Phase 1 has no roles, so the page says plainly what adding someone gives
  // them, rather than leaving it to a tooltip.
  it("offers Add user and says that everyone added gets full access", () => {
    render(<SettingsScreen />);
    expect(screen.getByRole("button", { name: /add user/i })).toBeEnabled();
    expect(screen.getByText(SHARED_ACCESS_NOTE)).toBeInTheDocument();
  });

  it("adds a user with a generated password and shows the details to share", async () => {
    createTeamMember.mockImplementation((_input, options) => options.onSuccess());
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /add user/i }));
    await user.type(screen.getByLabelText("Name"), "Hamna Bakhsh");
    await user.type(screen.getByLabelText("Email"), "hamna@example.com");
    await user.click(screen.getByRole("button", { name: "Generate" }));
    const password = (screen.getByLabelText("Password") as HTMLInputElement).value;
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add user" }));

    expect(createTeamMember).toHaveBeenCalledWith(
      { fullName: "Hamna Bakhsh", email: "hamna@example.com", password },
      expect.anything(),
    );
    expect(password).toHaveLength(16);
    expect(screen.getByText("User added")).toBeInTheDocument();
    expect(screen.getByText(password)).toBeInTheDocument();
  });

  it("takes a custom password, and refuses one that is too short", async () => {
    createTeamMember.mockReset();
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /add user/i }));
    await user.type(screen.getByLabelText("Name"), "Hamna Bakhsh");
    await user.type(screen.getByLabelText("Email"), "hamna@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add user" }));

    expect(screen.getByText(/at least 8 characters/)).toBeInTheDocument();
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it("shows why the server refused, such as an email already in use", async () => {
    createTeamMember.mockImplementation((_input, options) =>
      options.onError(new Error("Someone with this email already has an account.")),
    );
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /add user/i }));
    await user.type(screen.getByLabelText("Name"), "Hamna Bakhsh");
    await user.type(screen.getByLabelText("Email"), "hamna@example.com");
    await user.type(screen.getByLabelText("Password"), "a-custom-password");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add user" }));

    expect(screen.getByText("Someone with this email already has an account.")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    useTeamMembers.mockReturnValue(pending());
    render(<SettingsScreen />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("shows an error state with a way to retry", () => {
    useTeamMembers.mockReturnValue(failed("network down"));
    render(<SettingsScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the team/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("shows an empty state when nobody has signed in yet", () => {
    useTeamMembers.mockReturnValue(loaded([]));
    render(<SettingsScreen />);
    expect(screen.getByText(/no users yet/i)).toBeInTheDocument();
  });
});

describe("the Slack section", () => {
  it("never renders the bot token, only whether one is stored", async () => {
    render(<SettingsScreen />);
    await openSection(/^slack$/i);

    expect(screen.getByText(/bot token stored on/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/xoxb-/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("xoxb-1");
  });

  it("offers replace and remove rather than an editable token field once one is stored", async () => {
    render(<SettingsScreen />);
    await openSection(/^slack$/i);

    expect(screen.getByRole("button", { name: /replace token/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove token/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/paste the bot user oauth token/i)).not.toBeInTheDocument();
  });

  it("asks for a token when none is stored", async () => {
    useSlackSettings.mockReturnValue(
      loaded({ ...SLACK_CONFIGURED, tokenConfigured: false, tokenSetAt: null, enabled: false }),
    );
    render(<SettingsScreen />);
    await openSection(/^slack$/i);

    expect(screen.getByLabelText(/paste the bot user oauth token/i)).toBeInTheDocument();
  });

  it("will not let notifications be switched on without a token, and says so", async () => {
    useSlackSettings.mockReturnValue(
      loaded({ ...SLACK_CONFIGURED, tokenConfigured: false, tokenSetAt: null, enabled: false }),
    );
    render(<SettingsScreen />);
    await openSection(/^slack$/i);

    const toggle = screen.getByRole("switch");
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/add a bot token before turning notifications on/i),
    ).toBeInTheDocument();
  });

  it("rejects a channel name pasted into the channel id field before it reaches the API", async () => {
    render(<SettingsScreen />);
    await openSection(/^slack$/i);

    const field = screen.getByLabelText(/channel id/i);
    await userEvent.clear(field);
    await userEvent.type(field, "candidate-inbox");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(saveSlackSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/C0123ABCD/)).toBeInTheDocument();
  });

  it("shows a loading state", async () => {
    useSlackSettings.mockReturnValue(pending());
    render(<SettingsScreen />);
    await openSection(/^slack$/i);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("shows an error state with a way to retry", async () => {
    useSlackSettings.mockReturnValue(failed("nope"));
    render(<SettingsScreen />);
    await openSection(/^slack$/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the slack settings/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("the Email section", () => {
  it("reports the real configuration and renders no editable field at all", async () => {
    render(<SettingsScreen />);
    await openSection(/^email$/i);

    expect(screen.getByText("talent@hiring.example.com")).toBeInTheDocument();
    expect(screen.getByText("https://hiring.example.com/careers")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says read-only in the heading, so nothing looks like a form that discards", async () => {
    render(<SettingsScreen />);
    await openSection(/^email$/i);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("shows a loading state", async () => {
    useEmailSettings.mockReturnValue(pending());
    render(<SettingsScreen />);
    await openSection(/^email$/i);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("shows an error state with a way to retry", async () => {
    useEmailSettings.mockReturnValue(failed("nope"));
    render(<SettingsScreen />);
    await openSection(/^email$/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the email settings/i);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
