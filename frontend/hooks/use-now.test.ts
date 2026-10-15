import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "@/hooks/use-now";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  // The bug this guards: "12m in stage" was computed with Date.now() during
  // render and never recomputed, because nothing told React the clock had
  // moved. The board had to be reloaded to see the truth.
  it("advances as time passes", () => {
    const { result } = renderHook(() => useNow(30_000));
    const first = result.current;

    act(() => void vi.advanceTimersByTime(30_000));

    expect(result.current).toBeGreaterThan(first);
  });

  it("does not change between ticks", () => {
    const { result } = renderHook(() => useNow(30_000));
    const first = result.current;

    act(() => void vi.advanceTimersByTime(29_000));

    expect(result.current).toBe(first);
  });

  it("stops ticking once unmounted", () => {
    const { unmount } = renderHook(() => useNow(30_000));
    unmount();

    // A leaked interval would keep setting state on a gone component.
    expect(vi.getTimerCount()).toBe(0);
  });
});
