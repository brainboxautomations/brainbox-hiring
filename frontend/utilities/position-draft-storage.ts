import type { PositionFormValues } from "@/components/organisms/position-form/position-form-values";

/**
 * Keeps an in-progress "create position" wizard alive across a page refresh.
 *
 * The wizard holds everything in React state, so a refresh — or a stray browser
 * back — used to drop the user on step 1 with an empty form and no way back to
 * what they had typed. Five steps of work could disappear to a misplaced F5.
 *
 * sessionStorage rather than localStorage: a half-filled position is scratch
 * work, not something to resurrect in a new tab a week later. It dies with the
 * tab, which is the same lifetime the user already assumes.
 */
const DRAFT_KEY = "brainbox:position-wizard-draft";

export type PositionDraft = {
  values: PositionFormValues;
  /** The draft position id, once "Add stage actions" has created one. */
  createdPositionId: string | null;
};

/**
 * Every access is wrapped: sessionStorage throws outright in some privacy
 * modes, and a half-written or stale-shaped entry must never take the wizard
 * down with it. Losing the draft is a disappointment; a page that will not
 * load is a bug.
 */
export function readPositionDraft(): PositionDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const draft = parsed as Partial<PositionDraft>;
    if (!draft.values || typeof draft.values !== "object") return null;

    return {
      values: draft.values as PositionFormValues,
      createdPositionId:
        typeof draft.createdPositionId === "string" ? draft.createdPositionId : null,
    };
  } catch {
    return null;
  }
}

export function writePositionDraft(draft: PositionDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota or a blocked store — the wizard still works, it just will not
    // survive a refresh. Nothing to tell the user about yet.
  }
}

export function clearPositionDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clean up if the store was never reachable.
  }
}
