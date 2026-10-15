import { HttpClient } from "@/services/http-client";
import type { Pipeline, PipelineInput } from "@/types/api";

export const PipelinesService = {
  list: () => HttpClient.get<{ pipelines: Pipeline[] }>("/pipelines").then((r) => r.pipelines),

  create: (input: PipelineInput) =>
    HttpClient.post<{ pipeline: Pipeline }, PipelineInput>("/pipelines", input).then(
      (r) => r.pipeline,
    ),

  update: (id: string, input: PipelineInput) =>
    HttpClient.patch<{ pipeline: Pipeline }, PipelineInput>(`/pipelines/${id}`, input).then(
      (r) => r.pipeline,
    ),

  remove: (id: string) => HttpClient.delete<{ ok: boolean }>(`/pipelines/${id}`),
};
