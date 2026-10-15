import type { BulkCandidateFailure } from "@/types/api";

export type BulkActionTone = "success" | "partial" | "error";

export type BulkActionOutcome = {
  tone: BulkActionTone;
  title: string;
  message: string;
  details: string[];
  /** One follow-up the outcome offers, such as "Undo all" for a held bulk email. */
  action?: { label: string; onClick: () => void; pending?: boolean };
};

export type BulkActionVerb = {
  pastTense: string;
  successMessage: string;
};

export function candidateNoun(count: number): string {
  return count === 1 ? "candidate" : "candidates";
}

export function describeBulkFailure(
  failure: BulkCandidateFailure,
  nameFor: (applicationId: string) => string | null,
): string {
  return `${nameFor(failure.applicationId) ?? failure.applicationId} — ${failure.reason}`;
}

export type BulkActionResult = {
  succeeded: number;
  failures: BulkCandidateFailure[];
  /** Held past the mail relay's daily limit, to go out after it resets. */
  deferred?: number;
};

export function buildBulkOutcome(
  result: BulkActionResult,
  requestedCount: number,
  verb: BulkActionVerb,
  nameFor: (applicationId: string) => string | null,
): BulkActionOutcome {
  const succeeded = result.succeeded;
  const details = result.failures.map((failure) => describeBulkFailure(failure, nameFor));
  const deferred = result.deferred ?? 0;

  if (deferred > 0) {
    const note = `The daily email limit was reached, so ${deferred} ${candidateNoun(deferred)} will be emailed automatically just after midnight UTC.`;
    return {
      tone: "partial",
      title:
        details.length === 0
          ? `${succeeded} ${verb.pastTense}, ${deferred} scheduled`
          : `${succeeded} of ${requestedCount} ${verb.pastTense}, ${deferred} scheduled`,
      message:
        details.length === 0
          ? note
          : `${note} ${details.length} failed and ${details.length === 1 ? "stays" : "stay"} selected.`,
      details,
    };
  }

  if (details.length === 0) {
    return {
      tone: "success",
      title: `${succeeded} ${candidateNoun(succeeded)} ${verb.pastTense}`,
      message: verb.successMessage,
      details: [],
    };
  }

  if (succeeded === 0) {
    return {
      tone: "error",
      title: `Nothing was ${verb.pastTense}`,
      message: `All ${requestedCount} failed, and they stay selected so you can try again.`,
      details,
    };
  }

  return {
    tone: "partial",
    title: `${succeeded} of ${requestedCount} ${verb.pastTense}`,
    message: `${details.length} failed and ${details.length === 1 ? "stays" : "stay"} selected. The rest went through and are unaffected.`,
    details,
  };
}

export function buildExportOutcome(
  exportedCount: number,
  missingIds: string[],
  nameFor: (applicationId: string) => string | null,
): BulkActionOutcome {
  if (missingIds.length === 0) {
    return {
      tone: "success",
      title: `${exportedCount} ${candidateNoun(exportedCount)} exported`,
      message: "The CSV has been downloaded.",
      details: [],
    };
  }

  const details = missingIds.map(
    (applicationId) => `${nameFor(applicationId) ?? applicationId} — no longer on this position`,
  );

  if (exportedCount === 0) {
    return {
      tone: "error",
      title: "Nothing was exported",
      message: `None of the ${missingIds.length} selected ${candidateNoun(missingIds.length)} could be read.`,
      details,
    };
  }

  return {
    tone: "partial",
    title: `${exportedCount} of ${exportedCount + missingIds.length} exported`,
    message: `The CSV has been downloaded without ${missingIds.length} ${candidateNoun(missingIds.length)}.`,
    details,
  };
}

export function bulkErrorOutcome(action: string, message: string): BulkActionOutcome {
  return {
    tone: "error",
    title: `Couldn’t ${action}`,
    message,
    details: [],
  };
}

/**
 * A bulk email held for the undo window: nothing has gone out yet, so the
 * banner says when it will and offers Undo all (attached by the caller).
 */
export function buildHeldSendOutcome(
  input: {
    held: number;
    failures: BulkCandidateFailure[];
    requestedCount: number;
    sendAtLabel: string;
  },
  nameFor: (applicationId: string) => string | null,
): BulkActionOutcome {
  const details = input.failures.map((failure) => describeBulkFailure(failure, nameFor));
  const when = `They go out at ${input.sendAtLabel}. Undo all stops the whole batch; any single one can also be undone from its email thread.`;

  return {
    tone: details.length === 0 ? "success" : "partial",
    title:
      details.length === 0
        ? `${input.held} ${input.held === 1 ? "email" : "emails"} scheduled`
        : `${input.held} of ${input.requestedCount} scheduled`,
    message:
      details.length === 0
        ? when
        : `${when} ${details.length} failed and ${details.length === 1 ? "stays" : "stay"} selected.`,
    details,
  };
}

export function buildUndoneOutcome(cancelled: number, alreadyGone: number): BulkActionOutcome {
  return {
    tone: alreadyGone === 0 ? "success" : "partial",
    title: "Bulk email undone",
    message:
      alreadyGone === 0
        ? `${cancelled} ${cancelled === 1 ? "email was" : "emails were"} stopped. Nothing was sent.`
        : `${cancelled} stopped. ${alreadyGone} had already started sending or been undone, so ${alreadyGone === 1 ? "it was" : "they were"} left as they are.`,
    details: [],
  };
}
