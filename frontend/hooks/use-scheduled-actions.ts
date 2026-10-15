"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ScheduledActionsService } from "@/services/scheduled-actions-service";

/** Profiles list a candidate's upcoming automations, so both refresh them. */
const PROFILE_KEY = ["candidate-profile"] as const;

export function useCancelScheduledAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ScheduledActionsService.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  });
}

export function useRunScheduledActionNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ScheduledActionsService.sendNow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  });
}
