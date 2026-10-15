import { describe, expect, it } from "vitest";

import { matchThreadByReferences, type ReferencedMessage } from "@/utilities/thread-matching";

const AMARA = "person-amara";
const THEO = "person-theo";

function message(
  rfcMessageId: string,
  threadId: string | null,
  personId: string,
): ReferencedMessage {
  return { rfcMessageId, threadId, personId };
}

describe("matchThreadByReferences", () => {
  it("threads a reply onto the message it answers", () => {
    const match = matchThreadByReferences(
      ["parent@relay"],
      [message("parent@relay", "thread-1", AMARA)],
      AMARA,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-1", personId: AMARA });
  });

  it("prefers the nearest ancestor when several references are known", () => {
    const match = matchThreadByReferences(
      ["parent@relay", "root@relay"],
      [message("root@relay", "thread-old", AMARA), message("parent@relay", "thread-1", AMARA)],
      AMARA,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-1", personId: AMARA });
  });

  it("falls through to an older ancestor when the direct parent is unknown to us", () => {
    const match = matchThreadByReferences(
      ["someone-elses-client@example.org", "root@relay"],
      [message("root@relay", "thread-1", AMARA)],
      AMARA,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-1", personId: AMARA });
  });

  it("reports no match when the headers reference nothing we sent", () => {
    const match = matchThreadByReferences(
      ["unknown@elsewhere"],
      [message("x@relay", "t", AMARA)],
      AMARA,
    );
    expect(match).toEqual({ kind: "none" });
  });

  it("reports no match when there are no headers at all", () => {
    expect(matchThreadByReferences([], [message("x@relay", "t", AMARA)], AMARA)).toEqual({
      kind: "none",
    });
  });

  it("refuses a header that points at another candidate's thread", () => {
    const match = matchThreadByReferences(
      ["theos-message@relay"],
      [message("theos-message@relay", "thread-theo", THEO)],
      AMARA,
    );
    expect(match).toEqual({ kind: "foreign", personId: THEO });
  });

  it("keeps scanning past a foreign reference and takes the sender's own ancestor", () => {
    const match = matchThreadByReferences(
      ["theos-message@relay", "amaras-message@relay"],
      [
        message("theos-message@relay", "thread-theo", THEO),
        message("amaras-message@relay", "thread-amara", AMARA),
      ],
      AMARA,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-amara", personId: AMARA });
  });

  it("ignores a referenced message that belongs to no thread", () => {
    const match = matchThreadByReferences(
      ["orphan@relay", "parent@relay"],
      [message("orphan@relay", null, AMARA), message("parent@relay", "thread-1", AMARA)],
      AMARA,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-1", personId: AMARA });
  });

  it("accepts any owner when no sender has been resolved", () => {
    const match = matchThreadByReferences(
      ["parent@relay"],
      [message("parent@relay", "thread-1", THEO)],
      null,
    );
    expect(match).toEqual({ kind: "matched", threadId: "thread-1", personId: THEO });
  });
});
