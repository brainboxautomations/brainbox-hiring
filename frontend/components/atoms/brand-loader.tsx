"use client";

import { Logo } from "@/components/atoms/logo";

export function BrandLoader() {
  return (
    <div
      className="fixed inset-0 z-999 flex items-center justify-center overflow-hidden"
      style={{
        backdropFilter: "blur(12px) saturate(1.1)",
        WebkitBackdropFilter: "blur(12px) saturate(1.1)",
      }}
    >
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 480,
          height: 480,
          background: "radial-gradient(circle, rgba(61, 99, 221, 0.18) 0%, transparent 65%)",
          animation: "bb-breathe 3.2s ease-in-out infinite",
        }}
      />

      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 260,
          height: 260,
          background: "radial-gradient(circle, rgba(255, 255, 255, 0.72) 0%, transparent 68%)",
        }}
      />

      <div
        className="relative flex flex-col items-center"
        style={{
          gap: 28,
          animation: "bb-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        <Logo size={32} showTag />

        <svg
          width="44"
          height="44"
          viewBox="0 0 48 48"
          style={{ display: "block", overflow: "visible" }}
        >
          <circle
            cx="24"
            cy="24"
            r="23"
            stroke="#cbd5e1"
            strokeWidth="1"
            fill="none"
            strokeDasharray="2 11.4"
          />
          <circle cx="24" cy="24" r="17" stroke="#e2e8f0" strokeWidth="1.5" fill="none" />
          <circle
            cx="24"
            cy="24"
            r="17"
            stroke="var(--color-accent-9)"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            strokeDasharray="26 81"
            style={{
              transformOrigin: "24px 24px",
              animation: "ds-spin 1.05s linear infinite",
              filter: "drop-shadow(0 0 4px rgba(61, 99, 221, 0.45))",
            }}
          />
        </svg>
      </div>

      <style>{`
        @keyframes bb-enter {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)  scale(1);    }
        }
        @keyframes bb-breathe {
          0%, 100% { opacity: 0.5; transform: scale(1);    }
          50%       { opacity: 1;   transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}
