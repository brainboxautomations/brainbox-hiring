"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DepartmentsService } from "@/services/departments-service";
import type { DepartmentInput } from "@/schemas/department-schema";

const DEPARTMENTS_KEY = ["departments"] as const;

export function useDepartments() {
  return useQuery({ queryKey: DEPARTMENTS_KEY, queryFn: DepartmentsService.list });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DepartmentInput) => DepartmentsService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEPARTMENTS_KEY }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => DepartmentsService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEPARTMENTS_KEY }),
  });
}
