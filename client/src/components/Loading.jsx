export default function Loading({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm font-medium text-slate-500">
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
      />
      {label}
    </div>
  );
}
