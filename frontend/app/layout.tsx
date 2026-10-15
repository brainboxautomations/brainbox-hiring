import type { Metadata } from "next";
import { ApplicationLayout } from "@/components/templates/application-layout";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrainBox ATS",
  description: "Applicant tracking system.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ApplicationLayout>{children}</ApplicationLayout>;
}
