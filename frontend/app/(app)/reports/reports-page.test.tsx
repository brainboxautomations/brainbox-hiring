import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MonthlyReport } from "@/types/api";

const harness = vi.hoisted(() => ({
  state: {
    report: undefined as MonthlyReport | undefined,
    isLoading: false,
    isError: false,
  },
  requestedMonths: [] as (string | null)[],
}));

vi.mock("@/hooks/use-reports", () => ({
  useMonthlyReport: (month: string | null) => {
    harness.requestedMonths.push(month);
    return {
      data: harness.state.report,
      isLoading: harness.state.isLoading,
      isError: harness.state.isError,
      error: new Error("The report service is down"),
    };
  },
}));

import ReportsPage from "./page";

const EMPTY_REPORT: MonthlyReport = {
  month: "2026-03",
  availableMonths: ["2026-06", "2026-05", "2026-04", "2026-03"],
  totals: { applicationsReceived: 0, archived: 0 },
  weeks: [
    { weekNumber: 1, applicationsReceived: 0 },
    { weekNumber: 2, applicationsReceived: 0 },
    { weekNumber: 3, applicationsReceived: 0 },
    { weekNumber: 4, applicationsReceived: 0 },
  ],
  positions: [],
};

const BUSY_REPORT: MonthlyReport = {
  month: "2026-06",
  availableMonths: ["2026-06", "2026-05"],
  totals: { applicationsReceived: 10, archived: 1 },
  weeks: [
    { weekNumber: 1, applicationsReceived: 3 },
    { weekNumber: 2, applicationsReceived: 2 },
    { weekNumber: 3, applicationsReceived: 2 },
    { weekNumber: 4, applicationsReceived: 3 },
  ],
  positions: [
    {
      positionId: "alpha",
      title: "Senior Frontend Engineer",
      applicationsReceived: 8,
      stages: [
        { stageId: "alpha-1", name: "Applied", applications: 4 },
        { stageId: "alpha-2", name: "Rejected", applications: 1 },
        { stageId: "alpha-3", name: "Hired", applications: 2 },
        { stageId: null, name: "No stage", applications: 1 },
      ],
    },
    {
      positionId: "beta",
      title: "Sales Development Rep",
      applicationsReceived: 2,
      stages: [{ stageId: "beta-1", name: "Applied", applications: 1 }],
    },
  ],
};

const DUPLICATE_TITLE_REPORT: MonthlyReport = {
  ...BUSY_REPORT,
  positions: [
    {
      positionId: "first",
      title: "Senior Frontend Engineer",
      applicationsReceived: 3,
      stages: [{ stageId: "first-1", name: "Applied", applications: 3 }],
    },
    {
      positionId: "second",
      title: "Senior Frontend Engineer",
      applicationsReceived: 5,
      stages: [{ stageId: "second-1", name: "Applied", applications: 5 }],
    },
  ],
};

const ALL_ARCHIVED_REPORT: MonthlyReport = {
  ...BUSY_REPORT,
  totals: { applicationsReceived: 2, archived: 2 },
  positions: [
    {
      positionId: "alpha",
      title: "Senior Frontend Engineer",
      applicationsReceived: 2,
      stages: [],
    },
  ],
};

beforeEach(() => {
  harness.state.report = undefined;
  harness.state.isLoading = false;
  harness.state.isError = false;
  harness.requestedMonths = [];
});

describe("the reports screen states", () => {
  it("says it is loading before the first figures arrive", () => {
    harness.state.isLoading = true;
    render(<ReportsPage />);

    expect(screen.getByText(/Loading this month/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Candidates by stage" })).not.toBeInTheDocument();
  });

  it("shows an error alert rather than a blank page when the report cannot be read", () => {
    harness.state.isError = true;
    render(<ReportsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("The report service is down");
    expect(screen.queryByRole("region", { name: "Candidates by stage" })).not.toBeInTheDocument();
  });

  it("shows the empty state for a month with no applications, naming the month", () => {
    harness.state.report = EMPTY_REPORT;
    render(<ReportsPage />);

    expect(screen.getByText("No activity in March 2026")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Candidates by stage" })).not.toBeInTheDocument();
  });

  it("asks for the current month first, letting the server decide which that is", () => {
    harness.state.report = BUSY_REPORT;
    render(<ReportsPage />);

    expect(harness.requestedMonths[0]).toBeNull();
  });
});

describe("the reports screen figures", () => {
  beforeEach(() => {
    harness.state.report = BUSY_REPORT;
  });

  it("renders applications received as the only headline figure", () => {
    render(<ReportsPage />);
    const figures = within(screen.getByRole("region", { name: "Key figures" }));

    const card = figures.getByText("Applications received").parentElement as HTMLElement;
    expect(within(card).getByText("10")).toBeInTheDocument();

    for (const gone of ["In pipeline", "Hired", "Rejected"]) {
      expect(figures.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it("gives every position its own card, with its applications received", () => {
    render(<ReportsPage />);

    const alpha = within(
      screen.getByRole("region", { name: "Stages for Senior Frontend Engineer" }),
    );
    expect(alpha.getByText("Applied")).toBeInTheDocument();
    expect(screen.getByText("8 applied")).toBeInTheDocument();
    expect(screen.getByText("2 applied")).toBeInTheDocument();
  });

  it("keeps each position's stages in the order the API returned them", () => {
    render(<ReportsPage />);
    const alpha = screen.getByRole("region", { name: "Stages for Senior Frontend Engineer" });

    const rendered = BUSY_REPORT.positions[0]!.stages.map(
      (stage) => within(alpha).getByText(stage.name).textContent,
    );
    expect(rendered).toEqual(["Applied", "Rejected", "Hired", "No stage"]);
  });

  it("renders a No stage bucket rather than dropping candidates with no stage", () => {
    render(<ReportsPage />);
    const alpha = within(
      screen.getByRole("region", { name: "Stages for Senior Frontend Engineer" }),
    );

    expect(alpha.getByText("No stage")).toBeInTheDocument();
  });

  it("counts each position's bars against its own busiest stage, not the whole report", () => {
    render(<ReportsPage />);
    const beta = within(screen.getByRole("region", { name: "Stages for Sales Development Rep" }));

    expect(beta.getByText("1")).toBeInTheDocument();
  });

  it("explains that archived applications sit outside the stage counts", () => {
    render(<ReportsPage />);

    expect(screen.getByText(/archived/i)).toHaveTextContent(
      "1 archived application is counted in applications received but left out of the stage counts",
    );
  });

  it("hides the archived footnote when nothing was archived", () => {
    harness.state.report = { ...BUSY_REPORT, totals: { ...BUSY_REPORT.totals, archived: 0 } };
    render(<ReportsPage />);

    expect(screen.queryByText(/archived application/i)).not.toBeInTheDocument();
  });

  it("keeps two positions sharing a title apart rather than merging them", () => {
    harness.state.report = DUPLICATE_TITLE_REPORT;
    render(<ReportsPage />);

    expect(
      screen.getAllByRole("region", { name: "Stages for Senior Frontend Engineer" }),
    ).toHaveLength(2);
    expect(screen.getByText("3 applied")).toBeInTheDocument();
    expect(screen.getByText("5 applied")).toBeInTheDocument();
  });

  it("says so plainly when every applicant on a position was archived", () => {
    harness.state.report = ALL_ARCHIVED_REPORT;
    render(<ReportsPage />);

    expect(screen.getByText("Senior Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText(/every applicant this month has been archived/i)).toBeInTheDocument();
  });
});

describe("the month filter", () => {
  beforeEach(() => {
    harness.state.report = BUSY_REPORT;
  });

  it("labels the button with the month the API answered for", () => {
    render(<ReportsPage />);
    expect(screen.getByRole("button", { name: /June 2026/ })).toBeInTheDocument();
  });

  it("offers every available month and re-requests the one that is picked", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);

    await user.click(screen.getByRole("button", { name: /June 2026/ }));
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["June 2026", "May 2026"]);

    await user.click(screen.getByRole("option", { name: "May 2026" }));
    expect(harness.requestedMonths.at(-1)).toBe("2026-05");
  });
});
