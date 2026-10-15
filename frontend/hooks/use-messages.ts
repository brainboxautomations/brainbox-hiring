"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MessagesService, type SendMessageRequest } from "@/services/messages-service";
import { pendingSendRefetchInterval } from "@/utilities/scheduled-send";

export function usePersonMessages(personId: string | null) {
  return useQuery({
    queryKey: ["messages", "person", personId],
    queryFn: () => MessagesService.listForPerson(personId as string),
    enabled: Boolean(personId),
    // A held email is sent by the worker; look again until it shows as sent.
    refetchInterval: (query) => pendingSendRefetchInterval(query.state.data, Date.now()),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageRequest) => MessagesService.send(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useSendMessageNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => MessagesService.sendNow(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

/** "Undo all" for a bulk email still inside its undo window. */
export function useCancelMessageBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: string[]) => MessagesService.cancelBatch(messageIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}

export function useCancelScheduledMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => MessagesService.cancelScheduled(messageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
  });
}
