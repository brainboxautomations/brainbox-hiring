import { HttpClient } from "@/services/http-client";
import type { PersonUpdate } from "@/types/api";

export const PeopleService = {
  update: (id: string, patch: PersonUpdate) =>
    HttpClient.patch<{ ok: boolean }, PersonUpdate>(`/people/${id}`, patch),
};
