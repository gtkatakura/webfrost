export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs py-0.5 px-2 rounded-full font-semibold ${
        status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {status}
    </span>
  );
}
