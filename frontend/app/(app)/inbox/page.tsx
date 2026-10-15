import { Suspense } from "react";

import { InboxScreen } from "@/components/organisms/inbox/inbox-screen";

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="h-full bg-slate-50" />}>
      <InboxScreen threadId={null} />
    </Suspense>
  );
}
