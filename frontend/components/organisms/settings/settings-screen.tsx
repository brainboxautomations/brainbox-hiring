"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/utilities/cn";
import { DepartmentsSection } from "@/components/organisms/settings/departments-section";
import { EmailSection } from "@/components/organisms/settings/email-section";
import { EmailTimingSection } from "@/components/organisms/settings/email-timing-section";
import { QuestionnaireEmailsSection } from "@/components/organisms/settings/questionnaire-emails-section";
import { SlackSection } from "@/components/organisms/settings/slack-section";
import { UsersSection } from "@/components/organisms/settings/users-section";
import { Building2, ClipboardList, Mail, Timer, Users, Workflow } from "lucide-react";

type SectionId =
  | "users"
  | "departments"
  | "slack"
  | "email"
  | "email-timing"
  | "questionnaire-emails";

function UsersIcon() {
  return <Users size={16} aria-hidden="true" />;
}

function DepartmentsIcon() {
  return <Building2 size={16} aria-hidden="true" />;
}

function SlackIcon() {
  return <Workflow size={16} aria-hidden="true" />;
}

function EmailTimingIcon() {
  return <Timer size={16} aria-hidden="true" />;
}

function QuestionnaireEmailsIcon() {
  return <ClipboardList size={16} aria-hidden="true" />;
}

function EmailIcon() {
  return <Mail size={16} aria-hidden="true" />;
}

const sections: { id: SectionId; name: string; icon: ReactNode }[] = [
  { id: "users", name: "Users", icon: <UsersIcon /> },
  { id: "departments", name: "Departments", icon: <DepartmentsIcon /> },
  { id: "slack", name: "Slack", icon: <SlackIcon /> },
  { id: "email", name: "Email", icon: <EmailIcon /> },
  { id: "email-timing", name: "Email timing", icon: <EmailTimingIcon /> },
  { id: "questionnaire-emails", name: "Questionnaire emails", icon: <QuestionnaireEmailsIcon /> },
];

export function SettingsScreen() {
  const [section, setSection] = useState<SectionId>("users");

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[232px] flex-shrink-0 border-r border-slate-200 bg-white px-3.5 py-6">
        <div className="px-2 pb-4 text-xl font-semibold tracking-[-0.02em]">Settings</div>
        <nav className="flex flex-col gap-0.5">
          {sections.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                  active ? "bg-accent-3 text-accent-11" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span className={cn("flex", active ? "text-accent-11" : "text-slate-500")}>
                  {item.icon}
                </span>
                {item.name}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-10 pb-16 pt-8">
          {section === "users" && <UsersSection />}
          {section === "departments" && <DepartmentsSection />}
          {section === "slack" && <SlackSection />}
          {section === "email" && <EmailSection />}
          {section === "email-timing" && <EmailTimingSection />}
          {section === "questionnaire-emails" && <QuestionnaireEmailsSection />}
        </div>
      </div>
    </div>
  );
}
