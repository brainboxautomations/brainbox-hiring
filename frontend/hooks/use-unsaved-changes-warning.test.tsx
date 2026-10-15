import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChangesWarning(dirty, "Leave and lose them?");
  return (
    <div>
      <a href="/positions">Positions</a>
      <a href="#section">Same page</a>
    </div>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useUnsavedChangesWarning", () => {
  // The bug this guards: an email template lived in React state with no guard,
  // so a click on the top nav discarded ten minutes of work with no prompt.
  it("asks before following a link when there are unsaved changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<Harness dirty />);
    await user.click(document.querySelector('a[href="/positions"]')!);

    expect(confirm).toHaveBeenCalledWith("Leave and lose them?");
  });

  it("lets the navigation through once the user confirms", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Harness dirty />);
    const link = document.querySelector('a[href="/positions"]')! as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);

    expect(confirm).toHaveBeenCalled();
    // Not cancelled, so the router still gets the click.
    expect(event.defaultPrevented).toBe(false);
  });

  it("blocks the navigation when the user declines", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<Harness dirty />);
    const link = document.querySelector('a[href="/positions"]')! as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("stays out of the way when nothing is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<Harness dirty={false} />);
    await user.click(document.querySelector('a[href="/positions"]')!);

    expect(confirm).not.toHaveBeenCalled();
  });

  // A jump to an anchor on the same page unmounts nothing, so prompting there
  // would be pure noise.
  it("ignores same-page anchors", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<Harness dirty />);
    await user.click(document.querySelector('a[href="#section"]')!);

    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("useUnsavedChangesWarning and the browser Back button", () => {
  // Back does not unload a client-rendered page, so neither the unload prompt
  // nor the link guard saw it: a template's unsaved edits were discarded by a
  // single press of the browser's back arrow.
  function BackHarness({ dirty }: { dirty: boolean }) {
    useUnsavedChangesWarning(dirty, "Leave and lose them?");
    return null;
  }

  const onGuardEntry = () =>
    Boolean((window.history.state as Record<string, unknown> | null)?.__unsavedChangesGuard);

  // What one press of Back does: step off the extra entry onto the page's real
  // one — same URL, no guard mark — and fire popstate.
  function pressBack() {
    window.history.replaceState({}, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  // History outlives each test in jsdom; start every one from a clean entry.
  beforeEach(() => window.history.replaceState(null, "", "/templates"));

  it("adds a history entry for Back to land on while there are unsaved changes", () => {
    render(<BackHarness dirty />);

    expect(onGuardEntry()).toBe(true);
  });

  it("asks on Back and keeps the user on the page when they decline", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    render(<BackHarness dirty />);
    pressBack();

    expect(confirm).toHaveBeenCalledWith("Leave and lose them?");
    expect(back).not.toHaveBeenCalled();
    // Re-armed, so the next Back asks again.
    expect(onGuardEntry()).toBe(true);
  });

  it("goes back for real when the user agrees to leave", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    render(<BackHarness dirty />);
    pressBack();

    expect(back).toHaveBeenCalledTimes(1);
  });

  // After a save, one Back press should leave the page, not land on a copy.
  it("removes its history entry once the changes are saved", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

    const { rerender } = render(<BackHarness dirty />);
    rerender(<BackHarness dirty={false} />);

    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("useUnsavedChangesWarning leaves other history steps alone", () => {
  function BackHarness() {
    useUnsavedChangesWarning(true, "Leave and lose them?");
    return null;
  }

  beforeEach(() => window.history.replaceState(null, "", "/templates"));

  // A `#section` jump fires popstate too. It changes the URL and unmounts
  // nothing, so asking there would be pure noise.
  it("does not ask when the step lands on a different URL", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<BackHarness />);
    window.history.replaceState({}, "", "/templates#section");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(confirm).not.toHaveBeenCalled();
  });

  // Forward from the real entry returns to the guard entry: the user coming
  // back to the page, not leaving it.
  it("does not ask when the step lands back on its own history entry", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<BackHarness />);
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(confirm).not.toHaveBeenCalled();
  });
});
