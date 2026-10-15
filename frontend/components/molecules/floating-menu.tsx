"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/utilities/cn";

type FloatingMenuProps = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  matchWidth?: boolean;
  className?: string;
  children: ReactNode;
};

type FloatingPosition = { top: number; left: number; width?: number; maxHeight: number };

/** Kept clear between a menu and the edge of the window. */
const VIEWPORT_MARGIN = 8;

export function FloatingMenu({
  open,
  onClose,
  anchorRef,
  align = "end",
  matchWidth = false,
  className,
  children,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  // The menu's full height, measured before any cap applies, so a capped menu
  // does not flip sides as it is repositioned.
  const naturalHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const menuWidth = matchWidth ? anchorRect.width : (menu?.offsetWidth ?? 0);
      const gap = 4;
      if (!naturalHeightRef.current) naturalHeightRef.current = menu?.offsetHeight ?? 0;
      const menuHeight = naturalHeightRef.current;

      // A long menu takes whichever side has more room and is capped to it
      // (panels read --floating-max-height), instead of running off the window.
      const spaceBelow = window.innerHeight - anchorRect.bottom - gap - VIEWPORT_MARGIN;
      const spaceAbove = anchorRect.top - gap - VIEWPORT_MARGIN;
      const opensAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.max(0, opensAbove ? spaceAbove : spaceBelow);
      const shownHeight = Math.min(menuHeight, maxHeight);
      const top = opensAbove ? anchorRect.top - gap - shownHeight : anchorRect.bottom + gap;

      const left = matchWidth
        ? anchorRect.left
        : align === "end"
          ? Math.max(gap, anchorRect.right - menuWidth)
          : Math.min(anchorRect.left, window.innerWidth - menuWidth - gap);

      setPosition({ top, left, width: matchWidth ? anchorRect.width : undefined, maxHeight });
    }

    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      naturalHeightRef.current = 0;
    };
  }, [open, anchorRef, align, matchWidth]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        style={
          {
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            width: position?.width,
            visibility: position ? "visible" : "hidden",
            "--floating-max-height": position ? `${position.maxHeight}px` : undefined,
          } as CSSProperties
        }
        className={cn("z-50", className)}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
