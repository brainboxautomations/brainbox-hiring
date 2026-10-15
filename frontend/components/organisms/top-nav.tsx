"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/utilities/cn";
import { Logo } from "@/components/atoms/logo";
import { UserMenu } from "@/components/organisms/user-menu";

const navItems = [
  { label: "Positions", href: "/positions", match: ["/positions", "/candidates"] },
  { label: "Inbox", href: "/inbox", match: ["/inbox"] },
  { label: "Questionnaires", href: "/questionnaires", match: ["/questionnaires"] },
  { label: "Email templates", href: "/templates", match: ["/templates"] },
  { label: "Pipeline templates", href: "/pipelines", match: ["/pipelines"] },
  { label: "Reports", href: "/reports", match: ["/reports"] },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center gap-4.5 border-b border-slate-200 bg-white px-4">
      <Logo size={17} />

      <nav className="ml-1.5 flex items-center gap-0.5">
        {navItems.map((item) => {
          const active = item.match.some((m) => pathname.startsWith(m));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2.75 py-1.5 text-[13px] transition-colors",
                active
                  ? "bg-accent-3 font-medium text-accent-11"
                  : "font-normal text-slate-500 hover:bg-slate-100",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <UserMenu />
    </header>
  );
}
