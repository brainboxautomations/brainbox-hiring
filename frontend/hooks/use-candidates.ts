"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { CandidatesService } from "@/services/candidates-service";
import { candidateSearchWords } from "@/utilities/candidate-search";
import type {
  BulkCandidateEmail,
  BulkCandidateQuestionnaire,
  BulkCandidateUpdate,
  Candidate,
  CandidateProfile,
  CandidateUpdate,
  Note,
} from "@/types/api";

const candidatesKey = (positionId: string | null) => ["candidates", positionId] as const;
const profileKey = (applicationId: string | null) => ["candidate-profile", applicationId] as const;
const notesKey = (applicationId: string | null) => ["candidate-notes", applicationId] as const;

/** Candidates matching what was typed, for choosing who an email goes to. */
export function useCandidateSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["candidate-search", trimmed],
    queryFn: () => CandidatesService.search(trimmed),
    enabled: candidateSearchWords(trimmed) !== null,
    staleTime: 30_000,
    // Keep the last results on screen while the next query loads, so the list
    // does not blank out on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useCandidates(positionId: string | null, options: { paused?: boolean } = {}) {
  return useQuery({
    queryKey: candidatesKey(positionId),
    queryFn: () => CandidatesService.listByPosition(positionId as string),
    enabled: Boolean(positionId),
    // The board showed whatever was true when it was opened. Stage actions move
    // candidates on their own schedule and colleagues move them by hand, so
    // without polling a recruiter could work a board that had been wrong for
    // hours — and the global default turns window-focus refetching off, so even
    // switching tabs did not help.
    //
    // `paused` stops the poll mid-drag: a refetch landing then would overwrite
    // the optimistic move with the server's pre-move answer, snapping the card
    // back under the pointer.
    refetchInterval: options.paused ? false : 30_000,
    refetchOnWindowFocus: !options.paused,
  });
}

function applyPatch(c: Candidate, patch: CandidateUpdate): Candidate {
  return {
    ...c,
    ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
    ...(patch.seen !== undefined ? { seen: patch.seen } : {}),
    // A move restarts the stage clock at once, rather than after the refetch.
    ...(patch.stageId !== undefined && patch.stageId !== c.stageId
      ? { stageId: patch.stageId, stageEnteredAt: new Date().toISOString() }
      : {}),
    ...(patch.status !== undefined ? { archived: patch.status === "archived" } : {}),
  };
}

function applyProfilePatch(profile: CandidateProfile, patch: CandidateUpdate): CandidateProfile {
  return {
    ...profile,
    application: {
      ...profile.application,
      ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
      ...(patch.seen !== undefined ? { seen: patch.seen } : {}),
      ...(patch.stageId !== undefined ? { stageId: patch.stageId } : {}),
      ...(patch.status !== undefined ? { archived: patch.status === "archived" } : {}),
    },
  };
}

export function useUpdateCandidate(positionId: string | null) {
  const qc = useQueryClient();
  const key = candidatesKey(positionId);

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CandidateUpdate }) =>
      CandidatesService.update(id, patch),
    onMutate: async ({ id, patch }) => {
      const profile = profileKey(id);
      await qc.cancelQueries({ queryKey: key });
      await qc.cancelQueries({ queryKey: profile });

      const previousList = qc.getQueryData<Candidate[]>(key);
      if (previousList) {
        qc.setQueryData<Candidate[]>(
          key,
          previousList.map((c) => (c.id === id ? applyPatch(c, patch) : c)),
        );
      }

      const previousProfile = qc.getQueryData<CandidateProfile>(profile);
      if (previousProfile) {
        qc.setQueryData<CandidateProfile>(profile, applyProfilePatch(previousProfile, patch));
      }

      return { previousList, previousProfile };
    },
    onError: (_err, vars, context) => {
      if (context?.previousList) qc.setQueryData(key, context.previousList);
      if (context?.previousProfile) {
        qc.setQueryData(profileKey(vars.id), context.previousProfile);
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: profileKey(vars.id) });
    },
  });
}

export function useBulkUpdateCandidates(positionId: string | null) {
  const qc = useQueryClient();
  const key = candidatesKey(positionId);

  return useMutation({
    mutationFn: (input: BulkCandidateUpdate) => CandidatesService.bulkUpdate(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      // An open profile shows the stage and archived state this just changed.
      qc.invalidateQueries({ queryKey: ["candidate-profile"] });
    },
  });
}

export function useBulkEmailCandidates(positionId: string | null) {
  const qc = useQueryClient();
  const key = candidatesKey(positionId);

  return useMutation({
    mutationFn: (input: BulkCandidateEmail) => CandidatesService.bulkEmail(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      // Every recipient got a new message, so the inbox, their threads and any
      // open profile are out of date too.
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["candidate-profile"] });
    },
  });
}

export function useBulkSendQuestionnaire(positionId: string | null) {
  const qc = useQueryClient();
  const key = candidatesKey(positionId);

  return useMutation({
    mutationFn: (input: BulkCandidateQuestionnaire) => CandidatesService.bulkQuestionnaire(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      // Every recipient got a new message, so the inbox, their threads and any
      // open profile are out of date too.
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["candidate-profile"] });
    },
  });
}

export function useExportCandidates() {
  return useMutation({
    mutationFn: (applicationIds: string[]) => CandidatesService.exportRecords(applicationIds),
  });
}

export function useCandidateProfile(applicationId: string | null) {
  return useQuery({
    queryKey: profileKey(applicationId),
    queryFn: () => CandidatesService.getProfile(applicationId as string),
    enabled: Boolean(applicationId),
  });
}

export function useNotes(applicationId: string | null) {
  return useQuery({
    queryKey: notesKey(applicationId),
    queryFn: () => CandidatesService.listNotes(applicationId as string),
    enabled: Boolean(applicationId),
  });
}

export function useAddNote(applicationId: string | null) {
  const qc = useQueryClient();
  const key = notesKey(applicationId);
  return useMutation({
    mutationFn: (body: string) => CandidatesService.addNote(applicationId as string, body),
    onSuccess: (note) => {
      qc.setQueryData<Note[]>(key, (prev) => [note, ...(prev ?? [])]);
    },
  });
}
