import { Suspense } from "react";

import { InboxScreen } from "@/components/organisms/inbox/inbox-screen";

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;

  return (
    <Suspense fallback={<div className="h-full bg-slate-50" />}>
      <InboxScreen threadId={threadId} />
    </Suspense>
  );
}
