"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { MessageTemplatesService } from "@/services/message-templates-service";
import type { MessageTemplateInput } from "@/types/api";

const KEY = ["message-templates"] as const;

export function useMessageTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: MessageTemplatesService.list,
  });
}

export function useCreateMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MessageTemplateInput) => MessageTemplatesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MessageTemplateInput }) =>
      MessageTemplatesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteMessageTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => MessageTemplatesService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
