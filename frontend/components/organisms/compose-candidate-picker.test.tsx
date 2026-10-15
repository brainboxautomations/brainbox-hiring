import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateSearchResult } from "@/types/api";

const harness = vi.hoisted(() => ({
  push: vi.fn(),
  results: [] as CandidateSearchResult[],
  lastQuery: "",
}));

vi.mock("@/hooks/use-navigate", () => ({
  useNavigate: () => ({ push: harness.push, replace: vi.fn(), isNavigating: false }),
}));

vi.mock("@/hooks/use-candidates", () => ({
  useCandidateSearch: (query: string) => {
    harness.lastQuery = query;
    return query.trim().length >= 2
      ? { data: harness.results, isPending: false, isError: false }
      : { data: undefined, isPending: true, isError: false };
  },
}));

const { ComposeCandidatePicker } = await import("./compose-candidate-picker");

const NADIA: CandidateSearchResult = {
  applicationId: "app-1",
  firstName: "Nadia",
  lastName: "Rahman",
  email: "nadia@example.com",
  positionTitle: "Policy & Research",
  archived: false,
};

beforeEach(() => {
  harness.push.mockReset();
  harness.results = [NADIA];
  harness.lastQuery = "";
});

describe("ComposeCandidatePicker", () => {
  // Compose with no conversation selected used to jump to the positions list
  // with only a hover tooltip; it now asks who the email is for.
  it("asks for at least two letters before searching", () => {
    render(<ComposeCandidatePicker open onClose={vi.fn()} />);

    expect(screen.getByText(/Type at least 2 letters/)).toBeInTheDocument();
  });

  it("lists matches with their email and position", async () => {
    const user = userEvent.setup();
    render(<ComposeCandidatePicker open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Search candidates"), "nadia");

    expect(await screen.findByText("Nadia Rahman")).toBeInTheDocument();
    expect(screen.getByText("nadia@example.com · Policy & Research")).toBeInTheDocument();
  });

  it("opens the composer for the chosen candidate", async () => {
    const user = userEvent.setup();
    render(<ComposeCandidatePicker open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Search candidates"), "nadia");
    await user.click(await screen.findByText("Nadia Rahman"));

    expect(harness.push).toHaveBeenCalledWith("/compose?applicationId=app-1");
  });

  it("picks the top match on Enter", async () => {
    const user = userEvent.setup();
    render(<ComposeCandidatePicker open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Search candidates"), "nadia");
    await screen.findByText("Nadia Rahman");
    await user.keyboard("{Enter}");

    expect(harness.push).toHaveBeenCalledWith("/compose?applicationId=app-1");
  });

  it("says so when nothing matches", async () => {
    harness.results = [];
    const user = userEvent.setup();
    render(<ComposeCandidatePicker open onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Search candidates"), "nobody");

    expect(await screen.findByText(/No candidates match/)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ComposeCandidatePicker open onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
