import { redirect } from "next/navigation";

// Sign-in moved to /admin; old links and bookmarks still land there.
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  redirect(typeof next === "string" ? `/admin?next=${encodeURIComponent(next)}` : "/admin");
}
