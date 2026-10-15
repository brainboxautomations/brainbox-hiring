import { HttpClient } from "@/services/http-client";
import type { MessageThread, MessageThreadDetail, UnmatchedInboundEmail } from "@/types/api";

export type ThreadListQuery = {
  positionId?: string | null;
  personId?: string | null;
  unread?: boolean;
};

function toQueryString(query: ThreadListQuery): string {
  const params = new URLSearchParams();
  if (query.positionId) params.set("positionId", query.positionId);
  if (query.personId) params.set("personId", query.personId);
  if (query.unread) params.set("unread", "true");
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

export const ThreadsService = {
  list: (query: ThreadListQuery = {}) =>
    HttpClient.get<{ threads: MessageThread[] }>(`/threads${toQueryString(query)}`).then(
      (r) => r.threads,
    ),

  get: (threadId: string) =>
    HttpClient.get<{ thread: MessageThreadDetail }>(`/threads/${threadId}`).then((r) => r.thread),

  markRead: (threadId: string, read = true) =>
    HttpClient.patch<{ thread: { id: string; readAt: string | null } }, { read: boolean }>(
      `/threads/${threadId}`,
      { read },
    ).then((r) => r.thread),

  listUnmatched: () =>
    HttpClient.get<{ emails: UnmatchedInboundEmail[] }>("/threads/unmatched").then((r) => r.emails),
};
