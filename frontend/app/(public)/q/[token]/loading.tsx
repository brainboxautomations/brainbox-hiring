export default function HostedQuestionnaireLoading() {
  return (
    <div className="mx-auto w-full max-w-170 px-8 pb-20 pt-10">
      <div className="mb-2 h-3 w-24 animate-pulse rounded bg-slate-100" />
      <div className="mb-2 h-7 w-64 animate-pulse rounded bg-slate-100" />
      <div className="mb-7.5 h-4 w-80 animate-pulse rounded bg-slate-100" />
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded-[14px] border border-slate-200 bg-white px-6 py-5.5">
            <div className="mb-4 h-4 w-3/5 animate-pulse rounded bg-slate-100" />
            <div className="h-10.5 w-full animate-pulse rounded-lg bg-slate-50" />
          </div>
        ))}
      </div>
    </div>
  );
}
