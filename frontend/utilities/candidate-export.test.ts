import { describe, expect, it } from "vitest";

import type { CandidateExportRecord } from "@/types/api";
import {
  candidateExportCsv,
  candidateExportFilename,
  candidateExportTable,
  candidateFullName,
  escapeCsvCell,
  formAnswerKeys,
  formAnswerLabel,
  toCsv,
} from "./candidate-export";

function makeRecord(overrides: Partial<CandidateExportRecord> = {}): CandidateExportRecord {
  return {
    applicationId: "application-1",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@example.com",
    phone: "+44 20 7946 0821",
    headline: "Senior Frontend Engineer",
    positionTitle: "Senior Frontend Engineer",
    stageName: "Shortlist",
    archived: false,
    starred: true,
    seen: true,
    questionnaire: "complete",
    appliedAt: "2026-07-01T09:00:00.000Z",
    lastActivityAt: "2026-08-01T09:00:00.000Z",
    formAnswers: {},
    ...overrides,
  };
}

describe("escapeCsvCell", () => {
  it("leaves an ordinary value untouched", () => {
    expect(escapeCsvCell("Amara Okafor")).toBe("Amara Okafor");
  });

  it("quotes a value containing a comma", () => {
    expect(escapeCsvCell("London, United Kingdom")).toBe('"London, United Kingdom"');
  });

  it("quotes and doubles an embedded quote", () => {
    expect(escapeCsvCell('She said "yes"')).toBe('"She said ""yes"""');
  });

  it("quotes a value containing a newline so the row cannot break apart", () => {
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a value containing a carriage return", () => {
    expect(escapeCsvCell("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("quotes a value with surrounding whitespace so it survives a round trip", () => {
    expect(escapeCsvCell("  padded  ")).toBe('"  padded  "');
  });

  it("neutralises a leading equals so a spreadsheet cannot execute it", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
  });

  it("neutralises every formula-triggering prefix", () => {
    expect(escapeCsvCell("+44 20 7946 0821")).toBe("'+44 20 7946 0821");
    expect(escapeCsvCell("-1")).toBe("'-1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("neutralises a formula before quoting a value that also needs quotes", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
  });

  it("leaves an equals sign that is not in the first position alone", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
  });

  it("handles an empty value", () => {
    expect(escapeCsvCell("")).toBe("");
  });
});

describe("toCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    expect(
      toCsv([
        ["Name", "Email"],
        ["Amara", "amara@example.com"],
      ]),
    ).toBe("Name,Email\r\nAmara,amara@example.com");
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("candidateFullName", () => {
  it("joins first and last name", () => {
    expect(candidateFullName(makeRecord())).toBe("Amara Okafor");
  });

  it("uses the first name alone when there is no last name", () => {
    expect(candidateFullName(makeRecord({ lastName: null }))).toBe("Amara");
  });
});

describe("formAnswerLabel", () => {
  it("uses the application form's own label for a known field", () => {
    expect(formAnswerLabel("desired_salary")).toBe("Desired salary");
  });

  it("falls back to the raw key for a field the form does not define", () => {
    expect(formAnswerLabel("referred_by")).toBe("referred_by");
  });
});

describe("formAnswerKeys", () => {
  it("returns no keys when no candidate answered anything", () => {
    expect(formAnswerKeys([makeRecord()])).toEqual([]);
  });

  it("collects the union of keys across every record", () => {
    const keys = formAnswerKeys([
      makeRecord({ formAnswers: { phone: "1" } }),
      makeRecord({ formAnswers: { education: "BSc" } }),
    ]);
    expect(keys).toEqual(["phone", "education"]);
  });

  it("orders known fields as the application form does, not alphabetically", () => {
    const keys = formAnswerKeys([
      makeRecord({ formAnswers: { cover_letter: "…", phone: "1", education: "BSc" } }),
    ]);
    expect(keys).toEqual(["phone", "education", "cover_letter"]);
  });

  it("puts unknown keys after the known ones, sorted, so column order is stable", () => {
    const keys = formAnswerKeys([
      makeRecord({ formAnswers: { zeta: "z", phone: "1", alpha: "a" } }),
    ]);
    expect(keys).toEqual(["phone", "alpha", "zeta"]);
  });
});

describe("candidateExportTable", () => {
  it("puts the fixed columns first, in a fixed order", () => {
    const [header] = candidateExportTable([makeRecord()]);
    expect(header).toEqual([
      "Name",
      "Email",
      "Phone",
      "Headline",
      "Position",
      "Stage",
      "Status",
      "Starred",
      "Seen",
      "Questionnaire",
      "Added",
      "Last activity",
    ]);
  });

  it("appends one column per answered application form field", () => {
    const [header = []] = candidateExportTable([
      makeRecord({ formAnswers: { phone: "1", cover_letter: "Hello" } }),
    ]);
    expect(header.slice(-2)).toEqual(["Phone", "Cover letter"]);
  });

  it("renders a row with every fixed value in place", () => {
    const [, row] = candidateExportTable([makeRecord()]);
    expect(row).toEqual([
      "Amara Okafor",
      "amara.okafor@example.com",
      "+44 20 7946 0821",
      "Senior Frontend Engineer",
      "Senior Frontend Engineer",
      "Shortlist",
      "Active",
      "Yes",
      "Yes",
      "complete",
      "2026-07-01T09:00:00.000Z",
      "2026-08-01T09:00:00.000Z",
    ]);
  });

  it("writes an empty cell where a record has no answer for a column another record has", () => {
    const table = candidateExportTable([
      makeRecord({ formAnswers: { education: "BSc" } }),
      makeRecord({ formAnswers: {} }),
    ]);
    expect(table[1]!.at(-1)).toBe("BSc");
    expect(table[2]!.at(-1)).toBe("");
  });

  it("renders missing optional values as empty cells rather than the word null", () => {
    const [, row] = candidateExportTable([
      makeRecord({ phone: null, headline: null, stageName: null }),
    ]);
    expect(row!.slice(2, 6)).toEqual(["", "", "Senior Frontend Engineer", ""]);
  });

  it("marks an archived candidate as archived", () => {
    const [, row] = candidateExportTable([makeRecord({ archived: true })]);
    expect(row![6]).toBe("Archived");
  });

  it("returns a header row on its own when there is nothing to export", () => {
    const table = candidateExportTable([]);
    expect(table).toHaveLength(1);
    expect(table[0]![0]).toBe("Name");
  });
});

describe("candidateExportCsv", () => {
  it("escapes a candidate-supplied value that would otherwise break the file", () => {
    const csv = candidateExportCsv([makeRecord({ firstName: "Amara", lastName: 'O"Kafor, Jr' })]);
    expect(csv).toContain('"Amara O""Kafor, Jr"');
  });

  it("produces one header line plus one line per record", () => {
    const csv = candidateExportCsv([makeRecord(), makeRecord({ applicationId: "application-2" })]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});

describe("candidateExportFilename", () => {
  it("slugs the position title and stamps the day", () => {
    expect(
      candidateExportFilename("Senior Frontend Engineer", new Date("2026-08-05T12:00:00Z")),
    ).toBe("senior-frontend-engineer-candidates-2026-08-05.csv");
  });

  it("collapses punctuation rather than emitting it into a filename", () => {
    expect(
      candidateExportFilename("Head of People & Culture", new Date("2026-08-05T12:00:00Z")),
    ).toBe("head-of-people-culture-candidates-2026-08-05.csv");
  });

  it("falls back to a usable name when the title slugs to nothing", () => {
    expect(candidateExportFilename("———", new Date("2026-08-05T12:00:00Z"))).toBe(
      "candidates-candidates-2026-08-05.csv",
    );
  });
});
