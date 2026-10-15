"use client";

import { useEffect, useState } from "react";

import { CloseIcon, SearchIcon } from "@/components/atoms/icons";
import { useCandidateSearch } from "@/hooks/use-candidates";
import { useNavigate } from "@/hooks/use-navigate";
import type { CandidateSearchResult } from "@/types/api";
import { MIN_CANDIDATE_SEARCH_LENGTH } from "@/utilities/candidate-search";

type ComposeCandidatePickerProps = {
  open: boolean;
  onClose: () => void;
};

/** How long typing must pause before searching, so each keystroke is not a request. */
const SEARCH_DELAY_MS = 250;

function fullName(result: CandidateSearchResult): string {
  return [result.firstName, result.lastName].filter(Boolean).join(" ");
}

/**
 * "Who's this email to?" — opened by Compose when no conversation is selected.
 *
 * An email has to go to a candidate, so Compose on its own cannot open the
 * composer. It used to link to the positions list instead, with only a hover
 * tooltip to say why, and read as a broken button.
 */
export function ComposeCandidatePicker({ open, onClose }: ComposeCandidatePickerProps) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const search = useCandidateSearch(query);
  const results = search.data ?? [];
  const tooShort = input.trim().length < MIN_CANDIDATE_SEARCH_LENGTH;

  if (!open) return null;

  function choose(result: CandidateSearchResult) {
    setChosenId(result.applicationId);
    navigate.push(`/compose?applicationId=${result.applicationId}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose who to email"
        className="relative w-115 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-modal"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
          <SearchIcon size={15} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) choose(results[0]);
            }}
            placeholder="Who's this email to? Search by name or email…"
            aria-label="Search candidates"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="max-h-90 overflow-y-auto py-1.5">
          {tooShort ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">
              Type at least {MIN_CANDIDATE_SEARCH_LENGTH} letters of a name or email.
            </p>
          ) : search.isError ? (
            <p className="px-4 py-6 text-center text-[13px] text-red-700">
              Couldn’t search candidates. Try again.
            </p>
          ) : search.isPending ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">
              No candidates match “{input.trim()}”.
            </p>
          ) : (
            <ul>
              {results.map((result) => {
                const opening = chosenId === result.applicationId && navigate.isNavigating;
                return (
                  <li key={result.applicationId}>
                    <button
                      type="button"
                      disabled={navigate.isNavigating}
                      onClick={() => choose(result)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 disabled:cursor-default"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-slate-900">
                          {fullName(result)}
                          {result.archived && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-px text-[10px] font-normal text-slate-500">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {result.email}
                          {result.positionTitle ? ` · ${result.positionTitle}` : ""}
                        </div>
                      </div>
                      {opening && <span className="shrink-0 text-xs text-slate-400">Opening…</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
