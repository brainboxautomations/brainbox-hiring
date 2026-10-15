"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PeopleService } from "@/services/people-service";
import type { PersonUpdate } from "@/types/api";

export function useUpdatePerson(applicationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PersonUpdate }) =>
      PeopleService.update(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["candidate-profile", applicationId] });
      // The name and email also appear on the board, in the inbox and in search.
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["candidate-search"] });
    },
  });
}
