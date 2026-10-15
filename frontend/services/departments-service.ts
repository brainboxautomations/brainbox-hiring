import { HttpClient } from "@/services/http-client";
import type { DepartmentInput } from "@/schemas/department-schema";
import type { Department } from "@/types/api";

export const DepartmentsService = {
  list: () =>
    HttpClient.get<{ departments: Department[] }>("/departments").then((r) => r.departments),

  create: (input: DepartmentInput) =>
    HttpClient.post<{ department: Department }, DepartmentInput>("/departments", input).then(
      (r) => r.department,
    ),

  remove: (id: string) => HttpClient.delete<{ ok: true }>(`/departments/${id}`),
};
