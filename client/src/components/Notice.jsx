export default function Notice({ kind = "error", children, className = "" }) {
  if (!children) return null;
  const styles =
    kind === "success"
      ? "border-emerald-200/70 bg-white/80 text-emerald-800"
      : "border-red-200/70 bg-white/85 text-red-800";
  return (
    <div
      className={`glass-strong border px-4 py-3 text-sm font-medium ${styles} ${className}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
