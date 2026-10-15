import { HttpClient } from "@/services/http-client";
import type { StageAction, StageActionInput, StageActionUpdate } from "@/types/api";

export const StageActionsService = {
  list: (positionStageId: string) =>
    HttpClient.get<{ actions: StageAction[] }>(
      `/stage-actions?positionStageId=${encodeURIComponent(positionStageId)}`,
    ).then((r) => r.actions),

  create: (input: StageActionInput) =>
    HttpClient.post<{ action: StageAction }, StageActionInput>("/stage-actions", input).then(
      (r) => r.action,
    ),

  update: (id: string, input: StageActionUpdate) =>
    HttpClient.patch<{ action: StageAction }, StageActionUpdate>(
      `/stage-actions/${id}`,
      input,
    ).then((r) => r.action),

  remove: (id: string) => HttpClient.delete<{ ok: boolean }>(`/stage-actions/${id}`),
};
