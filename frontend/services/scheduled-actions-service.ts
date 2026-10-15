import { HttpClient } from "@/services/http-client";

export const ScheduledActionsService = {
  cancel: (id: string) => HttpClient.post<{ ok: true }>(`/scheduled-actions/${id}/cancel`),
  sendNow: (id: string) => HttpClient.post<{ ok: true }>(`/scheduled-actions/${id}/send-now`),
};
