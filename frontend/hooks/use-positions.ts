"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PositionsService } from "@/services/positions-service";
import type { PositionInput, PositionStatus } from "@/types/api";

const KEY = ["positions"] as const;

export function usePositions() {
  return useQuery({
    queryKey: KEY,
    queryFn: PositionsService.list,
  });
}

export function usePosition(id: string | null) {
  return useQuery({
    queryKey: ["positions", id],
    queryFn: () => PositionsService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PositionInput) => PositionsService.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PositionInput> }) =>
      PositionsService.update(id, input),
    onSuccess: (position) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["positions", position.id] });
    },
  });
}

export function useSetPositionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PositionStatus }) =>
      PositionsService.setStatus(id, status),
    onSuccess: (position) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["positions", position.id] });
    },
  });
}
