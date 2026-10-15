"use client";

import { useEffect, useSyncExternalStore } from "react";

let activeCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return activeCount > 0;
}

export function useProgressWhile(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    activeCount += 1;
    emit();
    return () => {
      activeCount -= 1;
      emit();
    };
  }, [pending]);
}

export function useProgressActive() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
