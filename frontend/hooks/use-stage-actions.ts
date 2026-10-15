"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { StageActionsService } from "@/services/stage-actions-service";
import type { StageActionInput, StageActionUpdate } from "@/types/api";

function keyFor(positionStageId: string | null) {
  return ["stage-actions", positionStageId] as const;
}

export function useStageActions(positionStageId: string | null) {
  return useQuery({
    queryKey: keyFor(positionStageId),
    queryFn: () => StageActionsService.list(positionStageId as string),
    enabled: Boolean(positionStageId),
  });
}

export function useCreateStageAction(positionStageId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StageActionInput) => StageActionsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyFor(positionStageId) }),
  });
}

export function useUpdateStageAction(positionStageId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: StageActionUpdate }) =>
      StageActionsService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyFor(positionStageId) }),
  });
}

export function useDeleteStageAction(positionStageId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => StageActionsService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keyFor(positionStageId) }),
  });
}
