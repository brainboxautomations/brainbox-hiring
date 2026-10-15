"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PipelinesService } from "@/services/pipelines-service";
import type { PipelineInput } from "@/types/api";

const KEY = ["pipelines"] as const;

export function usePipelines() {
  return useQuery({
    queryKey: KEY,
    queryFn: PipelinesService.list,
  });
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PipelineInput) => PipelinesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PipelineInput }) =>
      PipelinesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => PipelinesService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
