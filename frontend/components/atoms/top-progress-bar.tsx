"use client";

import { useEffect, useState } from "react";

export function TopProgressBar({ done = false }: { done?: boolean }) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 10);
    return () => clearTimeout(t);
  }, []);

  const width = done ? 100 : started ? 90 : 0;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 1000,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${width}%`,
          background:
            "linear-gradient(90deg, var(--color-accent-9) 0%, var(--color-accent-8) 100%)",
          boxShadow: "0 0 10px rgba(61, 99, 221, 0.75), 0 0 3px var(--color-accent-9)",
          borderRadius: "0 2px 2px 0",
          opacity: done ? 0 : 1,
          transition: done
            ? "width 180ms ease-out, opacity 160ms ease-out 140ms"
            : "width 9s cubic-bezier(0.05, 0.85, 0.25, 1)",
        }}
      />
    </div>
  );
}
