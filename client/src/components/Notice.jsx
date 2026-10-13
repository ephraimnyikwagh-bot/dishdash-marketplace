export default function Notice({ kind = "error", children, className = "" }) {
  if (!children) return null;
  const styles =
    kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-red-200 bg-red-50 text-red-800";
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${styles} ${className}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
