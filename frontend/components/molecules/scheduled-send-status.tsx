"use client";

import { useState } from "react";

import { useCancelScheduledMessage, useSendMessageNow } from "@/hooks/use-messages";
import type { Message } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import { messageTimestamp } from "@/utilities/relative-time";
import { scheduledSendIsCancellable } from "@/utilities/scheduled-send";

type Busy = "undo" | "send" | null;

function pillLabel(message: Message, busy: Busy): string | null {
  if (busy === "send") return "Sending…";
  if (busy === "undo") return "Undoing…";
  // Every email a person sends waits in this state for the undo window (or
  // until the time they scheduled), so it reads as a send in progress.
  if (message.status === "scheduled") return `Sending at ${messageTimestamp(message.scheduledFor)}`;
  if (message.status === "sending") return "Sending…";
  if (message.status === "cancelled") return "Not sent (undone)";
  if (message.status === "failed") return message.failureReason ?? "Failed to send";
  return null;
}

function pillTone(message: Message): string {
  if (message.status === "failed") return "bg-red-100 text-red-700";
  if (message.status === "cancelled") return "bg-slate-100 text-slate-500";
  return "bg-amber-100 text-amber-800";
}

const BUTTON =
  "inline-flex h-5 items-center whitespace-nowrap rounded-md px-1.5 text-[10px] font-semibold transition-colors";

export function ScheduledSendStatus({ message }: { message: Message }) {
  const cancelMessage = useCancelScheduledMessage();
  const sendNow = useSendMessageNow();
  const [error, setError] = useState<string | null>(null);

  const busy: Busy = cancelMessage.isPending ? "undo" : sendNow.isPending ? "send" : null;
  const label = pillLabel(message, busy);
  if (!label) return null;

  // Once the person has acted, the choice is made: the buttons go and the pill
  // says what is happening until the thread shows the result.
  const showActions = scheduledSendIsCancellable(message.status) && busy === null;

  async function undo() {
    setError(null);
    try {
      await cancelMessage.mutateAsync(message.id);
    } catch (cancelError) {
      setError(apiErrorMessage(cancelError, "Couldn’t undo that email."));
    }
  }

  async function sendImmediately() {
    setError(null);
    try {
      await sendNow.mutateAsync(message.id);
    } catch (sendError) {
      setError(apiErrorMessage(sendError, "Couldn’t send that email now."));
    }
  }

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      {/* A relay failure can be a long sentence: kept to one line, in full on hover. */}
      <span
        title={label}
        className={`max-w-56 truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${pillTone(message)}`}
      >
        {label}
      </span>
      {showActions && (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            className={`${BUTTON} border border-slate-300 bg-white text-slate-600 hover:border-red-300 hover:text-red-600`}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={sendImmediately}
            className={`${BUTTON} bg-accent-9 text-white hover:bg-accent-10`}
          >
            Send now
          </button>
        </span>
      )}
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </span>
  );
}
