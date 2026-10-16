export default function Loading({ label = "Loading..." }) {
  return (
    <div aria-live="polite" className="mx-auto w-full max-w-5xl px-4 py-8" role="status">
      <div className="mb-5 flex items-center justify-center gap-3 text-sm font-semibold text-slate-500">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
        />
        {label}
      </div>
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div className="animate-pulse rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100" key={item}>
            <div className="aspect-[4/3] rounded-xl bg-orange-50" />
            <div className="mt-4 h-3 w-1/3 rounded bg-slate-100" />
            <div className="mt-3 h-4 w-2/3 rounded bg-slate-100" />
            <div className="mt-4 h-3 w-1/2 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
