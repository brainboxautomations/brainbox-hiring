import type { BulkCandidateSendResult } from "@/types/api";

/**
 * Candidates per request. Each send is a handful of database calls plus a call
 * to the mail relay, so ten stay well inside the browser's 30-second request
 * timeout even when the relay is slow.
 */
export const BULK_SEND_CHUNK_SIZE = 10;

export const BULK_SEND_UNCERTAIN =
  "The request for this candidate failed, so the email may or may not have gone out. Check their email thread before sending again.";

export const BULK_SEND_NOT_SENT = "Not sent: the server turned this request down.";

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export type ChunkedSendOptions = {
  chunkSize?: number;
  /**
   * True when the server turned the request down before sending anything (a
   * 4xx: the template was deleted, the selection was invalid). Such a request
   * sent nothing, unlike one that timed out or failed part-way.
   */
  isRejection?: (error: unknown) => boolean;
};

/**
 * Sends a bulk email or questionnaire a few candidates per request.
 *
 * One request for the whole selection ran past the browser's timeout at around
 * a hundred candidates: the page reported a failure while the server carried on
 * sending, and the obvious retry sent everything twice. In small requests
 * nothing times out, and if one request does fail, only its candidates are
 * reported, as possibly sent, rather than the whole selection looking unsent.
 */
export async function sendInChunks(
  applicationIds: string[],
  send: (chunkIds: string[]) => Promise<BulkCandidateSendResult>,
  { chunkSize = BULK_SEND_CHUNK_SIZE, isRejection = () => false }: ChunkedSendOptions = {},
): Promise<BulkCandidateSendResult> {
  const result: BulkCandidateSendResult = { sent: [], failures: [] };
  const chunks = chunk(applicationIds, chunkSize);

  for (const [index, ids] of chunks.entries()) {
    try {
      const partial = await send(ids);
      result.sent.push(...partial.sent);
      result.failures.push(...partial.failures);
      if (partial.scheduled?.length) {
        result.scheduled = [...(result.scheduled ?? []), ...partial.scheduled];
        result.scheduledMessageIds = [
          ...(result.scheduledMessageIds ?? []),
          ...(partial.scheduledMessageIds ?? []),
        ];
        // The latest time any part of the batch goes out.
        if (
          partial.scheduledFor &&
          (!result.scheduledFor || partial.scheduledFor > result.scheduledFor)
        ) {
          result.scheduledFor = partial.scheduledFor;
        }
        // A batch held for the undo window that later hit the limit is still undoable.
        result.scheduledReason =
          result.scheduledReason === "undo" || partial.scheduledReason === "undo"
            ? "undo"
            : partial.scheduledReason;
      }
    } catch (error) {
      const rejected = isRejection(error);
      // Turned down before anything went out: report it as one error, exactly
      // as a single request would have.
      if (rejected && index === 0) throw error;
      const reason = rejected ? BULK_SEND_NOT_SENT : BULK_SEND_UNCERTAIN;
      result.failures.push(...ids.map((applicationId) => ({ applicationId, reason })));
    }
  }

  return result;
}
