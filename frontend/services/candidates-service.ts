import { isAxiosError } from "axios";

import { HttpClient } from "@/services/http-client";
import { sendInChunks } from "@/utilities/chunked-bulk-send";
import type {
  BulkCandidateEmail,
  BulkCandidateEmailResult,
  BulkCandidateQuestionnaire,
  BulkCandidateQuestionnaireResult,
  BulkCandidateUpdate,
  BulkCandidateUpdateResult,
  Candidate,
  CandidateExportRecord,
  CandidateProfile,
  CandidateSearchResult,
  CandidateUpdate,
  Note,
} from "@/types/api";

/** A 4xx: the server refused the request before sending anything. */
function isClientRejection(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

export type CandidateExportResponse = {
  records: CandidateExportRecord[];
  missingIds: string[];
};

export const CandidatesService = {
  search: (query: string) =>
    HttpClient.get<{ results: CandidateSearchResult[] }>(
      `/applications/search?q=${encodeURIComponent(query)}`,
    ).then((r) => r.results),

  listByPosition: (positionId: string) =>
    HttpClient.get<{ candidates: Candidate[] }>(`/positions/${positionId}/candidates`).then(
      (r) => r.candidates,
    ),

  update: (id: string, patch: CandidateUpdate) =>
    HttpClient.patch<{ candidate: Candidate }, CandidateUpdate>(`/applications/${id}`, patch).then(
      (r) => r.candidate,
    ),

  bulkUpdate: (input: BulkCandidateUpdate) =>
    HttpClient.post<BulkCandidateUpdateResult, BulkCandidateUpdate>("/applications/bulk", input),

  // Sent a few candidates per request; see `sendInChunks` for why.
  bulkEmail: ({ applicationIds, ...rest }: BulkCandidateEmail) =>
    sendInChunks(
      applicationIds,
      (ids) =>
        HttpClient.post<BulkCandidateEmailResult, BulkCandidateEmail>("/applications/bulk-email", {
          ...rest,
          applicationIds: ids,
        }),
      { isRejection: isClientRejection },
    ),

  bulkQuestionnaire: ({ applicationIds, ...rest }: BulkCandidateQuestionnaire) =>
    sendInChunks(
      applicationIds,
      (ids) =>
        HttpClient.post<BulkCandidateQuestionnaireResult, BulkCandidateQuestionnaire>(
          "/applications/bulk-questionnaire",
          { ...rest, applicationIds: ids },
        ),
      { isRejection: isClientRejection },
    ),

  exportRecords: (applicationIds: string[]) =>
    HttpClient.post<CandidateExportResponse, { applicationIds: string[] }>("/applications/export", {
      applicationIds,
    }),

  getProfile: (id: string) =>
    HttpClient.get<{ profile: CandidateProfile }>(`/applications/${id}/profile`).then(
      (r) => r.profile,
    ),

  listNotes: (id: string) =>
    HttpClient.get<{ notes: Note[] }>(`/applications/${id}/notes`).then((r) => r.notes),

  addNote: (id: string, body: string) =>
    HttpClient.post<{ note: Note }, { body: string }>(`/applications/${id}/notes`, {
      body,
    }).then((r) => r.note),
};
