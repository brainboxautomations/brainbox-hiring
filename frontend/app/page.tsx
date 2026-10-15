import { redirect } from "next/navigation";

// The bare domain is what candidates are given, so it opens on the open roles.
// Staff sign in at /admin.
export default function RootPage() {
  redirect("/careers");
}
