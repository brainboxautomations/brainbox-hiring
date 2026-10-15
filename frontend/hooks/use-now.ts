import { useEffect, useState } from "react";

/**
 * A clock that re-renders on an interval, for labels derived from the current
 * time.
 *
 * "12m in stage" was computed with `Date.now()` during render and then never
 * recomputed, because nothing told React the time had moved. The number sat
 * frozen until some unrelated change re-rendered the card, so the board had to
 * be reloaded to show the truth.
 *
 * Call this once at the screen that owns the list and pass the value down,
 * rather than per row: one interval for a board of two hundred cards, not two
 * hundred intervals.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
