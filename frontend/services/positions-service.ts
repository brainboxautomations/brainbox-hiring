import { HttpClient } from "@/services/http-client";
import type { Position, PositionInput, PositionListItem, PositionStatus } from "@/types/api";

export const PositionsService = {
  list: () =>
    HttpClient.get<{ positions: PositionListItem[] }>("/positions").then((r) => r.positions),

  get: (id: string) =>
    HttpClient.get<{ position: Position }>(`/positions/${id}`).then((r) => r.position),

  create: (input: PositionInput) =>
    HttpClient.post<{ position: Position }, PositionInput>("/positions", input).then(
      (r) => r.position,
    ),

  update: (id: string, input: Partial<PositionInput>) =>
    HttpClient.patch<{ position: Position }, Partial<PositionInput>>(
      `/positions/${id}`,
      input,
    ).then((r) => r.position),

  setStatus: (id: string, status: PositionStatus) =>
    HttpClient.patch<{ position: Position }, { status: PositionStatus }>(`/positions/${id}`, {
      status,
    }).then((r) => r.position),

  remove: (id: string) => HttpClient.delete<{ ok: boolean }>(`/positions/${id}`),
};
