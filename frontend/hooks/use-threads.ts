"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ThreadsService, type ThreadListQuery } from "@/services/threads-service";
import { pendingSendRefetchInterval } from "@/utilities/scheduled-send";

export function useThreads(query: ThreadListQuery = {}) {
  return useQuery({
    queryKey: ["threads", "list", query.positionId ?? null, query.personId ?? null],
    queryFn: () => ThreadsService.list(query),
  });
}

export function useThread(threadId: string | null) {
  return useQuery({
    queryKey: ["threads", "detail", threadId],
    queryFn: () => ThreadsService.get(threadId as string),
    enabled: Boolean(threadId),
    // A held email is sent by the worker; look again until it shows as sent.
    refetchInterval: (query) => pendingSendRefetchInterval(query.state.data?.messages, Date.now()),
  });
}

export function useUnmatchedInbound() {
  return useQuery({
    queryKey: ["threads", "unmatched"],
    queryFn: () => ThreadsService.listUnmatched(),
  });
}

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => ThreadsService.markRead(threadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads"] }),
  });
}
