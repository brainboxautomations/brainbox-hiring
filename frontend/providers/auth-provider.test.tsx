import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { AuthProvider } from "@/providers/auth-provider";

const harness = vi.hoisted(() => ({
  refresh: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: harness.refresh }),
}));

vi.mock("@/configurations/supabase-browser-configuration", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { onAuthStateChange: harness.onAuthStateChange },
  }),
}));

/** The callback AuthProvider registered, so a test can fire an auth event by hand. */
function emit(event: AuthChangeEvent, session: Session | null = null) {
  const listener = harness.onAuthStateChange.mock.calls.at(-1)?.[0];
  listener(event, session);
}

describe("AuthProvider", () => {
  beforeEach(() => {
    harness.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it("does not refresh for INITIAL_SESSION, the event every subscription fires on mount", () => {
    render(
      <AuthProvider initialSession={null}>
        <div />
      </AuthProvider>,
    );

    emit("INITIAL_SESSION");

    // Regression guard: INITIAL_SESSION used to trigger router.refresh(),
    // which re-subscribes and re-fires INITIAL_SESSION — an infinite loop.
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it("still refreshes for a real sign-in", () => {
    render(
      <AuthProvider initialSession={null}>
        <div />
      </AuthProvider>,
    );

    emit("SIGNED_IN");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });
});
